import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { commissionRuleApiService, type CommissionRuleWithCount } from '../../services/commissionRule.service';
import { contestApiService } from '../../services/contest.service';
import { api } from '../../services/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import type { CommissionRuleConfig, Contest, ContestLeaderboardEntry, PublicUser, Objective } from '@shared/types';
import { CommissionRuleType, ContestMetric, ContestStatus, RuleScope, UserRole } from '@shared/types';
import { ObjectiveWizard } from '../../components/ObjectiveWizard';
import { ParametrageNavCards, type ParametrageTab } from '../../components/parametrage/ParametrageNavCards';
import { CommissionWizard } from '../../components/commissions/CommissionWizard';
import { ContestWizard } from '../../components/contests/ContestWizard';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// ============================================================
// Types & Tab
// ============================================================

type FilterTab = 'active' | 'archived';

// ============================================================
// Helpers communs
// ============================================================

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

// ============================================================
// Helpers Commissions
// ============================================================

function ruleTypeBadge(type: string) {
  const map: Record<string, { label: string; variant: 'blue' | 'indigo' | 'purple' }> = {
    PERCENTAGE: { label: 'Pourcentage', variant: 'blue' },
    FIXED: { label: 'Fixe', variant: 'indigo' },
    TIERED: { label: 'Paliers', variant: 'purple' },
  };
  const c = map[type] ?? { label: type, variant: 'blue' as const };
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function RuleConfigDisplay({ config }: { config: CommissionRuleConfig }) {
  return (
    <div className="mt-2 space-y-2">
      <p className="text-sm text-gray-500">{config.description}</p>
      {config.type === CommissionRuleType.PERCENTAGE && config.rate !== undefined && (
        <p className="text-sm font-semibold text-primary-700">{(config.rate * 100).toFixed(0)}% du montant</p>
      )}
      {config.type === CommissionRuleType.FIXED && config.fixedAmount !== undefined && (
        <p className="text-sm font-semibold text-primary-700">{formatEur(config.fixedAmount)} fixe</p>
      )}
      {config.tiers && config.tiers.length > 0 && (
        <div className="space-y-1">
          {config.tiers.map((tier, i) => (
            <div key={i} className="flex items-center gap-2 text-xs bg-gray-50 rounded px-2 py-1">
              <span className="text-gray-500">{formatEur(tier.min)} → {tier.max ? formatEur(tier.max) : '∞'}</span>
              <span className="font-semibold text-primary-700">{(tier.rate * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
      )}
      {config.examples && config.examples.length > 0 && (
        <p className="text-xs text-gray-400 italic">{config.examples[0].explanation}</p>
      )}
    </div>
  );
}

// ============================================================
// Helpers Objectifs
// ============================================================

export const UNIT_OPTIONS = [
  { value: '€', label: '€ (euros)' },
  { value: 'marge', label: 'Marge (€)' },
  { value: 'deals', label: 'Deals signés' },
  { value: '%', label: '% (pourcentage)' },
];

export const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const currentYear = new Date().getFullYear();
export const YEARS = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

function makeDefaultObjective(): Objective {
  return {
    id: generateId(),
    label: '',
    target: 0,
    unit: '€',
    periodType: 'quarterly',
    quarter: Math.ceil((new Date().getMonth() + 1) / 3),
    year: currentYear,
    bonus: { enabled: false, type: 'percentage', value: 10 },
  };
}

function formatObjectivePeriod(obj: Objective): string {
  switch (obj.periodType) {
    case 'monthly':   return `${MONTHS[(obj.month ?? 1) - 1]} ${obj.year ?? currentYear}`;
    case 'quarterly': return `T${obj.quarter ?? 1} ${obj.year ?? currentYear}`;
    case 'semester':  return `S${obj.semester ?? 1} ${obj.year ?? currentYear}`;
    case 'annual':    return `Année ${obj.year ?? currentYear}`;
    case 'custom':
      if (obj.startDate && obj.endDate) {
        return `${format(new Date(obj.startDate), 'dd/MM/yy')} → ${format(new Date(obj.endDate), 'dd/MM/yy')}`;
      }
      return 'Période perso.';
    default: return '';
  }
}

/**
 * Filtre les objectifs pour ne garder que ceux à afficher :
 * - Masque les templates récurrents si des occurrences existent
 * - Ne garde que l'occurrence la plus récente par template (pas Jan+Fév+Mar+…)
 * - Garde les objectifs non-récurrents tels quels
 */
function filterVisibleObjectives(objectives: Objective[]): Objective[] {
  const occurrencesByParent = new Map<string, Objective[]>();
  for (const o of objectives) {
    if (o.parentObjectiveId) {
      const list = occurrencesByParent.get(o.parentObjectiveId) ?? [];
      list.push(o);
      occurrencesByParent.set(o.parentObjectiveId, list);
    }
  }

  const result: Objective[] = [];
  const handledParentIds = new Set<string>();

  for (const o of objectives) {
    const isTemplate = o.recurrence && o.recurrence !== 'none' && !o.parentObjectiveId;

    if (isTemplate) {
      const occurrences = occurrencesByParent.get(o.id);
      if (occurrences && occurrences.length > 0) {
        // Template masqué → on prend la meilleure occurrence
        if (!handledParentIds.has(o.id)) {
          handledParentIds.add(o.id);
          // Priorité : mois courant > futur le plus proche > passé le plus récent
          const now = new Date();
          const withRange = occurrences.map((occ) => {
            const y = occ.year ?? now.getFullYear();
            let startMonth = 0;
            if (occ.periodType === 'monthly' && occ.month) startMonth = occ.month - 1;
            else if (occ.periodType === 'quarterly' && occ.quarter) startMonth = (occ.quarter - 1) * 3;
            else if (occ.periodType === 'semester' && occ.semester) startMonth = (occ.semester - 1) * 6;
            // annual → startMonth = 0 (default)
            return { occ, start: new Date(y, startMonth, 1) };
          });
          const current = withRange.find((w) => {
            let endMonth = w.start.getMonth() + 1; // default: 1 month
            if (w.occ.periodType === 'quarterly') endMonth = w.start.getMonth() + 3;
            else if (w.occ.periodType === 'semester') endMonth = w.start.getMonth() + 6;
            else if (w.occ.periodType === 'annual') endMonth = 12;
            const end = new Date(w.start.getFullYear(), endMonth, 0, 23, 59, 59);
            return now >= w.start && now <= end;
          });
          result.push(current?.occ ?? withRange.sort((a, b) => b.start.getTime() - a.start.getTime())[0].occ);
        }
      } else {
        // Template sans occurrence → on l'affiche tel quel
        result.push(o);
      }
    } else if (o.parentObjectiveId) {
      // Occurrence → déjà gérée via le template, on skip
    } else {
      // Objectif non-récurrent → on l'affiche
      result.push(o);
    }
  }

  return result;
}

function collectTemplateObjectives(members: PublicUser[]): Objective[] {
  const seen = new Set<string>();
  const result: Objective[] = [];
  for (const m of members) {
    const allObjs = Array.isArray(m.objectives) ? (m.objectives as Objective[]) : [];
    const objs = filterVisibleObjectives(allObjs);
    for (const obj of objs) {
      const key = `${obj.label}|${obj.periodType}|${obj.year ?? ''}|${obj.quarter ?? ''}|${obj.month ?? ''}`;
      if (!seen.has(key) && obj.label) {
        seen.add(key);
        result.push(obj);
      }
    }
  }
  return result;
}

// ============================================================
// Helpers Concours
// ============================================================

function contestStatusBadge(status: ContestStatus) {
  const map: Record<ContestStatus, { label: string; variant: 'green' | 'gray' | 'yellow' }> = {
    ACTIVE:    { label: 'En cours',  variant: 'green' },
    ENDED:     { label: 'Terminé',   variant: 'gray' },
    CANCELLED: { label: 'Annulé',    variant: 'yellow' },
  };
  const c = map[status];
  return <Badge variant={c.variant}>{c.label}</Badge>;
}

function metricLabel(metric: ContestMetric): string {
  if (metric === ContestMetric.REVENUE) return 'CA (€)';
  if (metric === ContestMetric.MARGIN) return 'Marge (€)';
  return 'Deals signés';
}

function formatContestValue(metric: ContestMetric, value: number): string {
  if (metric === ContestMetric.REVENUE || metric === ContestMetric.MARGIN) return formatEur(value);
  return `${value} deal${value > 1 ? 's' : ''}`;
}

function unitSymbol(unit: string): string {
  if (unit === 'marge') return '€ (marge)';
  return unit;
}

function getMedalColor(rank: number): string {
  if (rank === 1) return 'text-yellow-500';
  if (rank === 2) return 'text-gray-400';
  if (rank === 3) return 'text-amber-600';
  return 'text-gray-400';
}

// ============================================================
// Page principale
// ============================================================

export function ParametragePage() {
  const { user } = useAuthStore();
  const isTeamLead = user?.role === UserRole.TEAM_LEAD;
  const [activeTab, setActiveTab] = useState<ParametrageTab>('commissions');

  // Compteurs pour les cartes de navigation
  const [counts, setCounts] = useState({ commissions: 0, objectifs: 0, concours: 0 });

  useEffect(() => {
    const loadCounts = async () => {
      try {
        const [rules, contests, teamRes] = await Promise.all([
          commissionRuleApiService.getAll(),
          contestApiService.getAll(),
          api.get<{ success: true; data: PublicUser[] }>('/auth/team'),
        ]);
        const activeRules = rules.filter((r) => !r.isArchived).length;
        const activeContests = contests.filter((c) => c.status === ContestStatus.ACTIVE).length;
        const commerciaux = teamRes.data.data.filter((m) => m.role !== 'MANAGER');
        const withObjectives = commerciaux.filter((m) => {
          const objs = Array.isArray(m.objectives) ? m.objectives : [];
          return objs.length > 0;
        }).length;
        setCounts({ commissions: activeRules, objectifs: withObjectives, concours: activeContests });
      } catch {
        // Compteurs non critiques — on les laisse à 0
      }
    };
    void loadCounts();
  }, []);

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Paramétrage</h1>
        <p className="text-gray-500 mt-1">Gérez les commissions, objectifs et concours de votre équipe</p>
      </div>

      {/* Cartes de navigation */}
      <ParametrageNavCards
        activeTab={activeTab}
        onTabChange={setActiveTab}
        commissionsCount={counts.commissions}
        objectifsCount={counts.objectifs}
        concoursCount={counts.concours}
      />

      {/* Contenu */}
      {activeTab === 'commissions' && <CommissionsTab />}
      {activeTab === 'objectifs' && <ObjectifsTab />}
      {activeTab === 'concours' && <ConcoursTab isTeamLead={isTeamLead} />}
    </div>
  );
}

// ============================================================
// Onglet Commissions
// ============================================================

function CommissionsTab() {
  const [rules, setRules] = useState<CommissionRuleWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('active');
  const [showWizardModal, setShowWizardModal] = useState(false);
  const [editingRule, setEditingRule] = useState<CommissionRuleWithCount | null>(null);
  const [successRule, setSuccessRule] = useState<CommissionRuleWithCount | null>(null);

  const loadRules = async () => {
    try {
      const data = await commissionRuleApiService.getAll();
      setRules(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRules(); }, []);

  const openCreate = () => {
    setEditingRule(null);
    setShowWizardModal(true);
  };

  const openEdit = (rule: CommissionRuleWithCount) => {
    setEditingRule(rule);
    setShowWizardModal(true);
  };

  const handleWizardSuccess = async (rule: CommissionRuleWithCount) => {
    setShowWizardModal(false);
    setEditingRule(null);
    setSuccessRule(rule);
    await loadRules();
  };

  const handleArchive = async (ruleId: string) => {
    setArchivingId(ruleId);
    try {
      await commissionRuleApiService.archive(ruleId);
      await loadRules();
      if (successRule?.id === ruleId) setSuccessRule(null);
    } finally {
      setArchivingId(null);
    }
  };

  const handleUnarchive = async (ruleId: string) => {
    setArchivingId(ruleId);
    try {
      await commissionRuleApiService.unarchive(ruleId);
      await loadRules();
    } finally {
      setArchivingId(null);
    }
  };

  const handleDeleteRule = async (ruleId: string) => {
    if (!window.confirm('Supprimer definitivement cette regle ? Cette action est irreversible.')) return;
    setArchivingId(ruleId);
    try {
      await commissionRuleApiService.delete(ruleId);
      await loadRules();
    } finally {
      setArchivingId(null);
    }
  };

  const filteredRules = rules.filter((r) =>
    filterTab === 'active' ? !r.isArchived : r.isArchived,
  );

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {([['active', 'Actives'], ['archived', 'Archivées']] as [FilterTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`text-xs font-medium py-1.5 px-3 rounded-md transition-colors ${filterTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
              <span className="ml-1 text-gray-400">
                ({tab === 'active' ? rules.filter((r) => !r.isArchived).length : rules.filter((r) => r.isArchived).length})
              </span>
            </button>
          ))}
        </div>
        <Button onClick={openCreate}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Créer une règle
        </Button>
      </div>

      {/* Bannière succès */}
      {successRule && (
        <Card className="border-green-200 bg-green-50">
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <h3 className="font-semibold text-green-800">Règle ajoutée à votre bibliothèque</h3>
            <button type="button" onClick={() => setSuccessRule(null)} className="ml-auto text-green-500 hover:text-green-700">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="bg-white rounded-lg p-3 border border-green-100">
            <div className="flex items-center gap-2 mb-1">
              <p className="font-medium text-gray-900">{successRule.name}</p>
              {ruleTypeBadge(successRule.type)}
              {successRule.dealType && <Badge variant="yellow">{successRule.dealType}</Badge>}
            </div>
            <RuleConfigDisplay config={successRule.config as unknown as CommissionRuleConfig} />
          </div>
          <p className="text-xs text-green-700 mt-3">
            La règle est disponible dans votre bibliothèque. Assignez-la à vos commerciaux depuis la page <strong>Mon équipe</strong>.
          </p>
        </Card>
      )}

      {/* Liste des règles */}
      {filteredRules.length === 0 ? (
        <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
          <p className="text-sm text-gray-400">{filterTab === 'archived' ? 'Aucune règle archivée' : 'Aucune règle créée'}</p>
          {filterTab !== 'archived' && <p className="text-xs text-gray-300 mt-1">Cliquez sur "Créer une règle" pour générer votre première règle</p>}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredRules.map((rule) => (
            <Card key={rule.id} padding="sm" className={rule.isArchived ? 'opacity-60' : ''}>
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 text-sm truncate">{rule.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{format(new Date(rule.createdAt), 'dd MMM yyyy', { locale: fr })}</p>
                  </div>
                  {rule.isArchived && <Badge variant="gray">Archivée</Badge>}
                </div>
                <div className="flex flex-wrap gap-1">
                  {ruleTypeBadge(rule.type)}
                  {rule.dealType && <Badge variant="yellow">{rule.dealType}</Badge>}
                </div>
                {!rule.isArchived && (
                  <p className="text-xs text-gray-400">
                    {rule.assignmentCount > 0
                      ? `${rule.assignmentCount} assignation${rule.assignmentCount > 1 ? 's' : ''} active${rule.assignmentCount > 1 ? 's' : ''}`
                      : 'Aucune assignation'}
                  </p>
                )}
                <RuleConfigDisplay config={rule.config as unknown as CommissionRuleConfig} />
                <div className="flex gap-2 pt-1">
                  {rule.isArchived ? (
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => void handleUnarchive(rule.id)} loading={archivingId === rule.id}>Restaurer</Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleDeleteRule(rule.id)} loading={archivingId === rule.id} className="text-red-500 hover:text-red-600 hover:bg-red-50" title="Supprimer definitivement">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Button variant="ghost" size="sm" onClick={() => openEdit(rule)}>Modifier</Button>
                      <Button variant="ghost" size="sm" onClick={() => void handleArchive(rule.id)} loading={archivingId === rule.id} className="text-red-500 hover:text-red-600 hover:bg-red-50">Archiver</Button>
                    </>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Modal wizard */}
      <Modal
        isOpen={showWizardModal}
        onClose={() => { setShowWizardModal(false); setEditingRule(null); }}
        title={editingRule ? `Modifier « ${editingRule.name} »` : 'Créer une règle de commission'}
        size="lg"
      >
        <CommissionWizard
          existingRule={editingRule ?? undefined}
          onSuccess={(rule) => void handleWizardSuccess(rule)}
          onCancel={() => { setShowWizardModal(false); setEditingRule(null); }}
        />
      </Modal>
    </div>
  );
}

// ============================================================
// Onglet Objectifs
// ============================================================

function ObjectifsTab() {
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [bulkObjective, setBulkObjective] = useState<Objective>(makeDefaultObjective());
  const [bulkSelectedIds, setBulkSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkSuccess, setBulkSuccess] = useState<string | null>(null);
  const [showBulkPicker, setShowBulkPicker] = useState(false);

  const loadTeam = async () => {
    try {
      const res = await api.get<{ success: true; data: PublicUser[] }>('/auth/team');
      setMembers(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadTeam(); }, []);

  const commerciaux = members.filter((m) => m.role !== 'MANAGER');

  const openBulkModal = () => {
    setBulkObjective(makeDefaultObjective());
    setBulkSelectedIds(new Set());
    setBulkError(null);
    setBulkSuccess(null);
    setShowBulkModal(true);
  };

  const toggleBulkMember = (id: string) => {
    setBulkSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const pickTemplateForBulk = (tpl: Objective) => {
    setBulkObjective({ ...tpl, id: generateId() });
    setShowBulkPicker(false);
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="space-y-6">
      {/* Carte récap équipe */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Objectifs d'équipe</h2>
            <p className="text-sm text-gray-400 mt-0.5">Créez un objectif et affectez-le à plusieurs commerciaux en un clic</p>
          </div>
          {commerciaux.length > 0 && (
            <Button onClick={openBulkModal}>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Créer un objectif commun
            </Button>
          )}
        </div>

        {commerciaux.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <p className="font-medium">Aucun commercial dans votre équipe</p>
            <p className="text-sm mt-1">Invitez des commerciaux depuis la page Mon équipe</p>
          </div>
        ) : (
          <div className="space-y-3">
            {commerciaux.map((m) => {
              const allObjectives = Array.isArray(m.objectives) ? (m.objectives as Objective[]) : [];
              const objectives = filterVisibleObjectives(allObjectives);
              return (
                <div key={m.id} className="flex items-start justify-between gap-4 p-4 bg-gray-50 rounded-xl border border-gray-100">
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                      <span className="text-primary-700 font-semibold text-xs">{m.firstName[0]}{m.lastName[0]}</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{m.firstName} {m.lastName}</p>
                      <p className="text-xs text-gray-400">{m.email}</p>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    {objectives.length === 0 ? (
                      <span className="text-xs text-gray-400">Aucun objectif défini</span>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {objectives.map((obj) => (
                          <span key={obj.id} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                            {obj.label || 'Objectif'} · {obj.target.toLocaleString('fr-FR')} {unitSymbol(obj.unit)} · {formatObjectivePeriod(obj)}
                            {obj.recurrence && obj.recurrence !== 'none' && <span className="ml-1 text-blue-500">🔁</span>}
                            {obj.bonus?.enabled && <span className="ml-1 text-green-600 font-bold">+{obj.bonus.value}{obj.bonus.type === 'percentage' ? '%' : '€'}</span>}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-gray-400 flex-shrink-0">{objectives.length} obj.</span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Modal Objectif commun */}
      <Modal isOpen={showBulkModal} onClose={() => setShowBulkModal(false)} title="Créer un objectif commun">
        {bulkSuccess
          ? (
            <div className="text-center py-8">
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              </div>
              <p className="font-medium text-gray-900">{bulkSuccess}</p>
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-sm text-gray-500">Définissez un objectif puis cochez les commerciaux auxquels l'affecter.</p>

              {collectTemplateObjectives(members).length > 0 && (
                <div>
                  <button
                    type="button"
                    onClick={() => setShowBulkPicker((v) => !v)}
                    className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border-2 transition-colors text-sm font-medium ${showBulkPicker ? 'border-indigo-300 bg-indigo-50 text-indigo-700' : 'border-dashed border-gray-200 text-gray-500 hover:border-gray-300 hover:bg-gray-50'}`}
                  >
                    <span className="flex items-center gap-2">
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                      Partir d'un objectif existant de l'équipe
                    </span>
                    <svg className={`w-4 h-4 transition-transform ${showBulkPicker ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {showBulkPicker && (
                    <div className="mt-2 border border-indigo-200 rounded-xl bg-indigo-50/50 p-3 space-y-2">
                      <p className="text-xs font-semibold text-indigo-700 mb-1">Cliquez pour utiliser cet objectif</p>
                      <div className="space-y-1.5 max-h-52 overflow-y-auto">
                        {collectTemplateObjectives(members).map((obj) => (
                          <button key={`${obj.label}-${obj.periodType}-${obj.year}`} type="button" onClick={() => pickTemplateForBulk(obj)} className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg bg-white border border-indigo-100 hover:border-indigo-300 hover:bg-indigo-50 transition-colors text-left group">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-gray-800 truncate">{obj.label}</p>
                              <p className="text-xs text-gray-400">{obj.target.toLocaleString('fr-FR')} {unitSymbol(obj.unit)} · {formatObjectivePeriod(obj)}</p>
                            </div>
                            <span className="flex-shrink-0 text-xs font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">Copier →</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <ObjectiveWizard
                initialObjective={bulkObjective}
                loading={bulkLoading}
                submitLabel={bulkSelectedIds.size > 0 ? `Affecter à ${bulkSelectedIds.size} commercial${bulkSelectedIds.size > 1 ? 'x' : ''}` : 'Sélectionnez des commerciaux ci-dessous'}
                onCancel={() => setShowBulkModal(false)}
                onSubmit={async (objective) => {
                  if (bulkSelectedIds.size === 0) { setBulkError('Sélectionnez au moins un commercial'); return; }
                  setBulkLoading(true);
                  setBulkError(null);
                  try {
                    const targets = members.filter((m) => bulkSelectedIds.has(m.id));
                    await Promise.all(
                      targets.map((m) => {
                        const existing = Array.isArray(m.objectives) ? m.objectives : [];
                        const newObj = { ...objective, id: Math.random().toString(36).slice(2, 10) };
                        return api.patch(`/auth/team/${m.id}`, { objectives: [...existing, newObj] });
                      }),
                    );
                    setBulkSuccess(`Objectif ajouté pour ${targets.length} commercial${targets.length > 1 ? 'x' : ''}`);
                    await loadTeam();
                    setTimeout(() => { setShowBulkModal(false); setBulkSuccess(null); }, 1800);
                  } catch {
                    setBulkError("Une erreur est survenue lors de l'affectation");
                  } finally {
                    setBulkLoading(false);
                  }
                }}
                renderStep4Extra={() => (
                  <div className="border-t border-gray-200 pt-4">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Affecter cet objectif à :</label>
                      <button type="button" onClick={() => setBulkSelectedIds(bulkSelectedIds.size === commerciaux.length ? new Set() : new Set(commerciaux.map((m) => m.id)))} className="text-xs text-primary-600 hover:underline">
                        {bulkSelectedIds.size === commerciaux.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                      </button>
                    </div>
                    <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
                      {commerciaux.map((m) => (
                        <label key={m.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${bulkSelectedIds.has(m.id) ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                          <input type="checkbox" checked={bulkSelectedIds.has(m.id)} onChange={() => toggleBulkMember(m.id)} className="w-4 h-4 rounded text-primary-600 border-gray-300 focus:ring-primary-400" />
                          <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                            <span className="text-primary-700 font-semibold text-xs">{m.firstName[0]}{m.lastName[0]}</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900">{m.firstName} {m.lastName}</p>
                            <p className="text-xs text-gray-400 truncate">{m.email}</p>
                          </div>
                          <span className="text-xs text-gray-400">{filterVisibleObjectives(Array.isArray(m.objectives) ? (m.objectives as Objective[]) : []).length} obj.</span>
                        </label>
                      ))}
                    </div>
                    {bulkSelectedIds.size > 0 && (
                      <p className="text-xs text-primary-600 mt-1.5 font-medium">{bulkSelectedIds.size} commercial{bulkSelectedIds.size > 1 ? 'x' : ''} sélectionné{bulkSelectedIds.size > 1 ? 's' : ''}</p>
                    )}
                  </div>
                )}
              />

              {bulkError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-600">{bulkError}</p></div>}
            </div>
          )}
      </Modal>
    </div>
  );
}

// ============================================================
// Onglet Concours
// ============================================================

function ConcoursTab({ isTeamLead = false }: { isTeamLead?: boolean }) {
  const [contests, setContests] = useState<Contest[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Membres de l'équipe et groupes (pour le wizard)
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [groups, setGroups] = useState<Array<{ id: string; name: string; color: string; members: PublicUser[] }>>([]);

  // Classement
  const [leaderboardContest, setLeaderboardContest] = useState<Contest | null>(null);
  const [leaderboard, setLeaderboard] = useState<ContestLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const loadContests = async () => {
    try {
      const data = await contestApiService.getAll();
      setContests(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadContests(); }, []);

  const openCreateModal = async () => {
    setShowCreateModal(true);
    try {
      const [teamRes, groupsRes] = await Promise.all([
        api.get<{ success: true; data: PublicUser[] }>('/auth/team'),
        api.get<{ success: true; data: Array<{ id: string; name: string; color: string; members: PublicUser[] }> }>('/groups').catch(() => ({ data: { data: [] } })),
      ]);
      setMembers(teamRes.data.data.filter((m) => m.role !== 'MANAGER'));
      setGroups(groupsRes.data.data);
    } catch {
      setMembers([]);
      setGroups([]);
    }
  };

  const handleWizardSuccess = async () => {
    setShowCreateModal(false);
    await loadContests();
  };

  const handleEnd = async (id: string) => {
    setActionLoading(id);
    try {
      await contestApiService.end(id);
      await loadContests();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCancel = async (id: string) => {
    setActionLoading(id);
    try {
      await contestApiService.cancel(id);
      await loadContests();
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeleteContest = async (id: string) => {
    if (!window.confirm('Supprimer definitivement ce concours ? Cette action est irreversible.')) return;
    setActionLoading(id);
    try {
      await contestApiService.delete(id);
      await loadContests();
    } finally {
      setActionLoading(null);
    }
  };

  const openLeaderboard = async (contest: Contest) => {
    setLeaderboardContest(contest);
    setLeaderboard([]);
    setLeaderboardLoading(true);
    try {
      const data = await contestApiService.getLeaderboard(contest.id);
      // Les managers reçoivent toujours le classement complet (jamais anonyme)
      if (Array.isArray(data)) {
        setLeaderboard(data);
      }
    } finally {
      setLeaderboardLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  const activeContests = contests.filter((c) => c.status === ContestStatus.ACTIVE);
  const pastContests = contests.filter((c) => c.status !== ContestStatus.ACTIVE);

  return (
    <div className="space-y-6">
      {/* Actions */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          {activeContests.length > 0
            ? `${activeContests.length} concours en cours`
            : 'Aucun concours actif'}
        </p>
        <Button onClick={() => void openCreateModal()}>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Créer un concours
        </Button>
      </div>

      {contests.length === 0 ? (
        <Card>
          <div className="text-center py-12">
            <div className="w-14 h-14 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-7 h-7 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
            </div>
            <p className="font-semibold text-gray-700">Aucun concours créé</p>
            <p className="text-sm text-gray-400 mt-1">Motivez votre équipe avec un concours et un lot à gagner</p>
          </div>
        </Card>
      ) : (
        <>
          {activeContests.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">En cours</h2>
              {activeContests.map((contest) => (
                <ContestCard key={contest.id} contest={contest} actionLoading={actionLoading}
                  onLeaderboard={() => void openLeaderboard(contest)}
                  onEnd={() => void handleEnd(contest.id)}
                  onCancel={() => void handleCancel(contest.id)}
                />
              ))}
            </div>
          )}
          {pastContests.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Historique</h2>
              {pastContests.map((contest) => (
                <ContestCard key={contest.id} contest={contest} actionLoading={actionLoading}
                  onLeaderboard={() => void openLeaderboard(contest)}
                  onEnd={() => void handleEnd(contest.id)}
                  onCancel={() => void handleCancel(contest.id)}
                  onDelete={() => void handleDeleteContest(contest.id)}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal création concours (wizard) */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Créer un concours" size="lg">
        <ContestWizard
          teamMembers={members}
          groups={groups}
          isTeamLead={isTeamLead}
          onSuccess={() => void handleWizardSuccess()}
          onCancel={() => setShowCreateModal(false)}
        />
      </Modal>

      {/* Modal classement */}
      <Modal isOpen={!!leaderboardContest} onClose={() => { setLeaderboardContest(null); setExpandedUserId(null); }} title={`Classement — ${leaderboardContest?.name ?? ''}`} size="lg">
        {leaderboardContest && (
          <div className="space-y-4">
            {leaderboardContest.anonymousLeaderboard && (
              <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-xl border border-blue-200">
                <svg className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-xs text-blue-700">Classement anonyme actif : les commerciaux ne voient que leur position</p>
              </div>
            )}
            <div className="flex items-center gap-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
              <div className="text-2xl">🏆</div>
              <div>
                <p className="text-sm font-semibold text-amber-800">Lot en jeu</p>
                <p className="text-base font-bold text-amber-900">{leaderboardContest.prize}</p>
              </div>
            </div>

            {leaderboardLoading ? (
              <div className="flex justify-center py-8">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <p>Aucune donnée disponible pour cette période</p>
              </div>
            ) : (
              <div className="space-y-2">
                {leaderboard.map((entry) => (
                  <div key={entry.user.id}>
                    <div
                      className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer transition-colors ${entry.rank === 1 ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50 hover:bg-gray-100'}`}
                      onClick={() => setExpandedUserId(expandedUserId === entry.user.id ? null : entry.user.id)}
                    >
                      <span className={`font-bold text-lg w-8 text-center flex-shrink-0 ${getMedalColor(entry.rank)}`}>
                        {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : entry.rank}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900">{entry.user.firstName} {entry.user.lastName}</p>
                        <p className="text-xs text-gray-400">{entry.user.email}</p>
                      </div>
                      <span className="font-bold text-gray-800 text-sm flex-shrink-0">
                        {formatContestValue(leaderboardContest.metric, entry.value)}
                      </span>
                      <svg className={`w-4 h-4 text-gray-400 transition-transform ${expandedUserId === entry.user.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                      </svg>
                    </div>

                    {/* Détails des deals */}
                    {expandedUserId === entry.user.id && entry.details && entry.details.length > 0 && (
                      <div className="ml-11 mt-1 mb-2 space-y-1">
                        <div className="text-xs font-semibold text-gray-500 px-3 py-1 grid grid-cols-12 gap-1">
                          <span className="col-span-3">Deal</span>
                          <span className="col-span-2">Client</span>
                          <span className="col-span-2 text-right">Montant</span>
                          <span className="col-span-2 text-right">Valeur utilisée</span>
                          <span className="col-span-1 text-right">Part</span>
                          <span className="col-span-2 text-right">Contribution</span>
                        </div>
                        {entry.details.map((d) => (
                          <div key={d.dealId} className="text-xs text-gray-700 px-3 py-1.5 bg-white rounded border border-gray-100 grid grid-cols-12 gap-1 items-center">
                            <span className="col-span-3 truncate font-medium" title={d.dealTitle}>{d.dealTitle}</span>
                            <span className="col-span-2 truncate text-gray-500" title={d.clientName ?? '-'}>{d.clientName ?? '-'}</span>
                            <span className="col-span-2 text-right">{formatEur(d.amount)}</span>
                            <span className="col-span-2 text-right">
                              {formatEur(d.valueUsed)}
                              <span className="text-gray-400 ml-0.5" title={d.source}>({d.source === 'marginAmount' ? 'marge' : d.source === 'amount - costAmount' ? 'calc' : 'CA'})</span>
                            </span>
                            <span className="col-span-1 text-right">{Math.round(d.share * 100)}%</span>
                            <span className="col-span-2 text-right font-semibold text-green-700">{formatEur(d.contribution)}</span>
                          </div>
                        ))}
                        <div className="text-xs text-gray-500 px-3 py-1 border-t border-gray-200 flex justify-between">
                          <span>{entry.details.length} deal{entry.details.length > 1 ? 's' : ''} pris en compte</span>
                          <span className="font-semibold">Total : {formatEur(entry.details.reduce((s, d) => s + d.contribution, 0))}</span>
                        </div>
                      </div>
                    )}

                    {expandedUserId === entry.user.id && (!entry.details || entry.details.length === 0) && (
                      <div className="ml-11 mt-1 mb-2 px-3 py-2 text-xs text-gray-400 bg-white rounded border border-gray-100">
                        Aucun deal comptabilisé pour cette période
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Button variant="secondary" onClick={() => { setLeaderboardContest(null); setExpandedUserId(null); }} className="w-full">Fermer</Button>
          </div>
        )}
      </Modal>
    </div>
  );
}

// ============================================================
// Carte concours
// ============================================================

interface ContestCardProps {
  contest: Contest;
  actionLoading: string | null;
  onLeaderboard: () => void;
  onEnd: () => void;
  onCancel: () => void;
  onDelete?: () => void;
}

function ContestCard({ contest, actionLoading, onLeaderboard, onEnd, onCancel, onDelete }: ContestCardProps) {
  const isActive = contest.status === ContestStatus.ACTIVE;
  const loading = actionLoading === contest.id;

  return (
    <Card padding="sm" className={!isActive ? 'opacity-70' : ''}>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
          <span className="text-xl">🏆</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <p className="font-semibold text-gray-900">{contest.name}</p>
            {contestStatusBadge(contest.status)}
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 flex-wrap mb-2">
            <span>🎁 {contest.prize}</span>
            <span>📊 {metricLabel(contest.metric)}</span>
            <span>
              👥 {contest.scope === RuleScope.GLOBAL
                ? 'Toute l\'équipe'
                : contest.scope === RuleScope.TEAM
                  ? `Équipe : ${contest.teamName ?? '—'}`
                  : `${(contest.participantIds as string[]).length} participant${(contest.participantIds as string[]).length > 1 ? 's' : ''}`}
            </span>
            <span>📅 {format(new Date(contest.periodStart), 'dd MMM yyyy', { locale: fr })} → {format(new Date(contest.periodEnd), 'dd MMM yyyy', { locale: fr })}</span>
          </div>
          {contest.description && <p className="text-xs text-gray-400">{contest.description}</p>}
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Button variant="secondary" size="sm" onClick={onLeaderboard}>Classement</Button>
          {isActive ? (
            <>
              <Button
                variant="secondary"
                size="sm"
                loading={loading}
                onClick={onEnd}
                className="text-gray-600"
              >
                Terminer
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={loading}
                onClick={onCancel}
                className="text-red-500 hover:text-red-600 hover:bg-red-50"
              >
                Annuler
              </Button>
            </>
          ) : onDelete ? (
            <Button
              variant="ghost"
              size="sm"
              loading={loading}
              onClick={onDelete}
              className="text-red-500 hover:text-red-600 hover:bg-red-50"
              title="Supprimer definitivement"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </Button>
          ) : null}
        </div>
      </div>
    </Card>
  );
}


