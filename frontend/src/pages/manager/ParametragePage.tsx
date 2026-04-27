import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import { useAuthStore } from '../../stores/auth.store';
import { commissionRuleApiService, type CommissionRuleWithCount } from '../../services/commissionRule.service';
import { contestApiService } from '../../services/contest.service';
import { api } from '../../services/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import type { CommissionRuleConfig, Contest, ContestLeaderboardEntry, PublicUser, Objective, ObjectivePeriodType, ObjectiveBonus } from '@shared/types';
import { CommissionRuleType, ContestMetric, ContestStatus, RuleScope, UserRole } from '@shared/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// ============================================================
// Types & Tab
// ============================================================

type Tab = 'commissions' | 'objectifs' | 'concours';
type FilterTab = 'all' | 'active' | 'archived';

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
    case 'annual':    return `Année ${obj.year ?? currentYear}`;
    case 'custom':
      if (obj.startDate && obj.endDate) {
        return `${format(new Date(obj.startDate), 'dd/MM/yy')} → ${format(new Date(obj.endDate), 'dd/MM/yy')}`;
      }
      return 'Période perso.';
    default: return '';
  }
}

function collectTemplateObjectives(members: PublicUser[]): Objective[] {
  const seen = new Set<string>();
  const result: Objective[] = [];
  for (const m of members) {
    const objs = Array.isArray(m.objectives) ? (m.objectives as Objective[]) : [];
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
  return metric === ContestMetric.REVENUE ? 'CA (€)' : 'Deals signés';
}

function getMedalColor(rank: number): string {
  if (rank === 1) return 'text-yellow-500';
  if (rank === 2) return 'text-gray-400';
  if (rank === 3) return 'text-amber-600';
  return 'text-gray-400';
}

// ============================================================
// Schemas Zod
// ============================================================

const ruleSchema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  dealType: z.string().max(50).optional(),
  description: z.string().min(10, 'Décrivez la règle en au moins 10 caractères').max(1000),
});
type RuleFormData = z.infer<typeof ruleSchema>;

const contestSchema = z.object({
  name: z.string().min(1, 'Le nom est requis'),
  description: z.string().max(500).optional(),
  prize: z.string().min(1, 'Décrivez le lot / la récompense'),
  metric: z.nativeEnum(ContestMetric),
  scope: z.nativeEnum(RuleScope).default(RuleScope.GLOBAL),
  teamName: z.string().optional(),
  periodStart: z.string().min(1, 'Date de début requise'),
  periodEnd: z.string().min(1, 'Date de fin requise'),
});
type ContestFormData = z.infer<typeof contestSchema>;

// ============================================================
// Page principale
// ============================================================

export function ParametragePage() {
  const { user } = useAuthStore();
  const isTeamLead = user?.role === UserRole.TEAM_LEAD;
  const [activeTab, setActiveTab] = useState<Tab>('commissions');

  const allTabs: [Tab, string, string][] = [
    ['commissions', 'Commissions', 'M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z'],
    ['objectifs', 'Objectifs', 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z'],
    ['concours', 'Concours', 'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z'],
  ];

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Paramétrage</h1>
        <p className="text-gray-500 mt-1">Gérez les commissions, objectifs et concours de votre équipe</p>
      </div>

      {/* Onglets */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {allTabs.map(([tab, label, iconPath]) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 pb-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary-600 text-primary-700'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d={iconPath} />
              </svg>
              {label}
            </button>
          ))}
        </nav>
      </div>

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
  const [generating, setGenerating] = useState(false);
  const [archivingId, setArchivingId] = useState<string | null>(null);
  const [generatedRule, setGeneratedRule] = useState<CommissionRuleWithCount | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filterTab, setFilterTab] = useState<FilterTab>('active');

  const { register, handleSubmit, reset, formState: { errors } } = useForm<RuleFormData>({
    resolver: zodResolver(ruleSchema),
  });

  const loadRules = async () => {
    try {
      const data = await commissionRuleApiService.getAll();
      setRules(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRules(); }, []);

  const onSubmit = async (data: RuleFormData) => {
    setError(null);
    setGenerating(true);
    setGeneratedRule(null);
    try {
      const rule = await commissionRuleApiService.generate({
        name: data.name,
        description: data.description,
        dealType: data.dealType || null,
      });
      setGeneratedRule({ ...rule, assignmentCount: 0 });
      await loadRules();
      reset();
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const apiMsg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        setError(`[${status ?? '?'}] ${apiMsg ?? err.message}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Erreur inconnue');
      }
    } finally {
      setGenerating(false);
    }
  };

  const handleArchive = async (ruleId: string) => {
    setArchivingId(ruleId);
    try {
      await commissionRuleApiService.archive(ruleId);
      await loadRules();
      if (generatedRule?.id === ruleId) setGeneratedRule(null);
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

  const filteredRules = rules.filter((r) => {
    if (filterTab === 'active') return !r.isArchived;
    if (filterTab === 'archived') return r.isArchived;
    return true;
  });

  if (loading) {
    return <div className="flex items-center justify-center h-40"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
      {/* Bibliothèque */}
      <div className="lg:col-span-2 space-y-4">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {([['all', 'Toutes'], ['active', 'Actives'], ['archived', 'Archivées']] as [FilterTab, string][]).map(([tab, label]) => (
            <button
              key={tab}
              onClick={() => setFilterTab(tab)}
              className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${filterTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              {label}
              {tab !== 'archived' && (
                <span className="ml-1 text-gray-400">({tab === 'all' ? rules.length : rules.filter((r) => !r.isArchived).length})</span>
              )}
            </button>
          ))}
        </div>

        {filteredRules.length === 0 ? (
          <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 text-center">
            <p className="text-sm text-gray-400">{filterTab === 'archived' ? 'Aucune règle archivée' : 'Aucune règle créée'}</p>
            {filterTab !== 'archived' && <p className="text-xs text-gray-300 mt-1">Utilisez le formulaire pour générer votre première règle</p>}
          </div>
        ) : (
          <div className="space-y-3">
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
                      <Button variant="ghost" size="sm" onClick={() => void handleUnarchive(rule.id)} loading={archivingId === rule.id}>Restaurer</Button>
                    ) : (
                      <Button variant="ghost" size="sm" onClick={() => void handleArchive(rule.id)} loading={archivingId === rule.id} className="text-red-500 hover:text-red-600 hover:bg-red-50">Archiver</Button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Formulaire IA */}
      <div className="lg:col-span-3 space-y-4">
        <Card>
          <div className="flex items-center gap-2 mb-5">
            <div className="w-7 h-7 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
              <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h2 className="text-base font-semibold text-gray-900">Créer une nouvelle règle</h2>
          </div>
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
            <Input label="Nom de la règle" placeholder="Ex : Commission CDI Senior" error={errors.name?.message} {...register('name')} />
            <Input label="Type de deal concerné (optionnel)" placeholder="Ex : CDI, CDD, Intérim, Placement..." error={errors.dealType?.message} hint="Laissez vide pour une règle applicable à tous les deals" {...register('dealType')} />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Décrivez votre règle de commission</label>
              <textarea
                className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                rows={5}
                placeholder="Ex : 10% sur toutes les ventes, 15% au-dessus de 10 000€ de CA mensuel, avec un palier à 20% au-dessus de 25 000€..."
                {...register('description')}
              />
              {errors.description && <p className="mt-1 text-xs text-red-600">{errors.description.message}</p>}
            </div>
            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
                <p className="text-sm text-red-600">{error}</p>
              </div>
            )}
            <Button type="submit" loading={generating} className="w-full">
              {generating ? 'Génération en cours...' : "Générer avec l'IA"}
            </Button>
          </form>
        </Card>

        {generatedRule && (
          <Card className="border-green-200 bg-green-50">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <h3 className="font-semibold text-green-800">Règle ajoutée à votre bibliothèque</h3>
            </div>
            <div className="bg-white rounded-lg p-3 border border-green-100">
              <div className="flex items-center gap-2 mb-1">
                <p className="font-medium text-gray-900">{generatedRule.name}</p>
                {ruleTypeBadge(generatedRule.type)}
                {generatedRule.dealType && <Badge variant="yellow">{generatedRule.dealType}</Badge>}
              </div>
              <RuleConfigDisplay config={generatedRule.config as unknown as CommissionRuleConfig} />
            </div>
            <p className="text-xs text-green-700 mt-3">
              La règle est disponible dans votre bibliothèque. Assignez-la à vos commerciaux depuis la page <strong>Mon équipe</strong>.
            </p>
          </Card>
        )}
      </div>
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

  const updateBulkObjective = <K extends keyof Objective>(_id: string, field: K, value: Objective[K]) => {
    setBulkObjective((prev) => {
      const updated = { ...prev, [field]: value };
      if (field === 'periodType') {
        delete updated.month; delete updated.quarter; delete updated.startDate; delete updated.endDate;
        const pt = value as ObjectivePeriodType;
        if (pt === 'monthly')   { updated.month = new Date().getMonth() + 1; updated.year = currentYear; }
        if (pt === 'quarterly') { updated.quarter = Math.ceil((new Date().getMonth() + 1) / 3); updated.year = currentYear; }
        if (pt === 'annual')    { updated.year = currentYear; }
      }
      return updated;
    });
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

  const onApplyBulkObjective = async () => {
    if (bulkSelectedIds.size === 0) { setBulkError('Sélectionnez au moins un commercial'); return; }
    if (!bulkObjective.label.trim()) { setBulkError("Donnez un intitulé à l'objectif"); return; }
    setBulkLoading(true);
    setBulkError(null);
    try {
      const targets = members.filter((m) => bulkSelectedIds.has(m.id));
      await Promise.all(
        targets.map((m) => {
          const existing = Array.isArray(m.objectives) ? m.objectives : [];
          const newObj = { ...bulkObjective, id: generateId() };
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
              const objectives = Array.isArray(m.objectives) ? (m.objectives as Objective[]) : [];
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
                            {obj.label || 'Objectif'} · {obj.target.toLocaleString('fr-FR')} {obj.unit} · {formatObjectivePeriod(obj)}
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
                              <p className="text-xs text-gray-400">{obj.target.toLocaleString('fr-FR')} {obj.unit} · {formatObjectivePeriod(obj)}</p>
                            </div>
                            <span className="flex-shrink-0 text-xs font-medium text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity">Copier →</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <ObjectiveEditor obj={bulkObjective} index={0} onChange={updateBulkObjective} onRemove={() => { /* pas de suppression */ }} hiddenRemove />

              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Affecter à</label>
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
                      <span className="text-xs text-gray-400">{(Array.isArray(m.objectives) ? m.objectives : []).length} obj.</span>
                    </label>
                  ))}
                </div>
                {bulkSelectedIds.size > 0 && (
                  <p className="text-xs text-primary-600 mt-1.5 font-medium">{bulkSelectedIds.size} commercial{bulkSelectedIds.size > 1 ? 'x' : ''} sélectionné{bulkSelectedIds.size > 1 ? 's' : ''}</p>
                )}
              </div>

              {bulkError && <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3"><p className="text-sm text-red-600">{bulkError}</p></div>}

              <div className="flex gap-3">
                <Button loading={bulkLoading} onClick={() => void onApplyBulkObjective()} className="flex-1">Affecter l'objectif</Button>
                <Button type="button" variant="secondary" onClick={() => setShowBulkModal(false)}>Annuler</Button>
              </div>
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
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Membres de l'équipe (pour scope INDIVIDUAL / TEAM)
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  // TEAM_LEAD : scope forcé à INDIVIDUAL (ses participants uniquement)
  const [selectedScope, setSelectedScope] = useState<RuleScope>(isTeamLead ? RuleScope.INDIVIDUAL : RuleScope.GLOBAL);
  const [selectedParticipantIds, setSelectedParticipantIds] = useState<Set<string>>(new Set());

  // Classement
  const [leaderboardContest, setLeaderboardContest] = useState<Contest | null>(null);
  const [leaderboard, setLeaderboard] = useState<ContestLeaderboardEntry[]>([]);
  const [leaderboardLoading, setLeaderboardLoading] = useState(false);

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ContestFormData>({
    resolver: zodResolver(contestSchema),
    defaultValues: { metric: ContestMetric.REVENUE, scope: RuleScope.GLOBAL },
  });

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
    setCreateError(null);
    setSelectedScope(isTeamLead ? RuleScope.INDIVIDUAL : RuleScope.GLOBAL);
    setSelectedParticipantIds(new Set());
    reset({ metric: ContestMetric.REVENUE, scope: isTeamLead ? RuleScope.INDIVIDUAL : RuleScope.GLOBAL });
    setShowCreateModal(true);
    // Charger l'équipe et les groupes pour la sélection
    try {
      const [teamRes, groupsRes] = await Promise.all([
        api.get<{ success: true; data: PublicUser[] }>('/auth/team'),
        api.get<{ success: true; data: { id: string; name: string }[] }>('/groups').catch(() => ({ data: { data: [] } })),
      ]);
      setMembers(teamRes.data.data.filter((m) => m.role !== 'MANAGER'));
      setGroups(groupsRes.data.data);
    } catch {
      setMembers([]);
      setGroups([]);
    }
  };

  const onCreateContest = async (data: ContestFormData) => {
    setCreateError(null);
    setCreating(true);
    try {
      await contestApiService.create({
        name: data.name,
        description: data.description ?? '',
        prize: data.prize,
        metric: data.metric,
        scope: selectedScope,
        teamName: selectedScope === RuleScope.TEAM ? (data.teamName ?? null) : null,
        participantIds: selectedScope === RuleScope.INDIVIDUAL ? Array.from(selectedParticipantIds) : [],
        periodStart: new Date(data.periodStart).toISOString(),
        periodEnd: new Date(data.periodEnd).toISOString(),
      });
      await loadContests();
      reset();
      setShowCreateModal(false);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const apiMsg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        setCreateError(apiMsg ?? err.message);
      } else if (err instanceof Error) {
        setCreateError(err.message);
      } else {
        setCreateError('Erreur inconnue');
      }
    } finally {
      setCreating(false);
    }
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

  const openLeaderboard = async (contest: Contest) => {
    setLeaderboardContest(contest);
    setLeaderboard([]);
    setLeaderboardLoading(true);
    try {
      const data = await contestApiService.getLeaderboard(contest.id);
      setLeaderboard(data);
    } finally {
      setLeaderboardLoading(false);
    }
  };

  const toggleParticipant = (id: string) => {
    setSelectedParticipantIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
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
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* Modal création concours */}
      <Modal isOpen={showCreateModal} onClose={() => setShowCreateModal(false)} title="Créer un concours" size="md">
        <form onSubmit={(e) => void handleSubmit(onCreateContest)(e)} className="space-y-4">
          <Input label="Nom du concours" placeholder="Ex : Meilleur commercial du mois" error={errors.name?.message} {...register('name')} />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Lot / Récompense</label>
            <input type="text" placeholder="Ex : iPhone 16, Bon cadeau 500€, Weekend à Paris..." className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500" {...register('prize')} />
            {errors.prize && <p className="mt-1 text-xs text-red-600">{errors.prize.message}</p>}
          </div>

          {/* Métrique */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Métrique de classement</label>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition-colors has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50 border-gray-200">
                <input type="radio" value={ContestMetric.REVENUE} {...register('metric')} className="sr-only" />
                <div><p className="text-sm font-semibold text-gray-800">CA réalisé</p><p className="text-xs text-gray-400">Montant total des deals gagnés</p></div>
              </label>
              <label className="flex items-center gap-3 p-3 border-2 rounded-xl cursor-pointer transition-colors has-[:checked]:border-primary-400 has-[:checked]:bg-primary-50 border-gray-200">
                <input type="radio" value={ContestMetric.DEAL_COUNT} {...register('metric')} className="sr-only" />
                <div><p className="text-sm font-semibold text-gray-800">Deals signés</p><p className="text-xs text-gray-400">Nombre de deals gagnés</p></div>
              </label>
            </div>
          </div>

          {/* Périmètre des participants */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Participants</label>
            {isTeamLead ? (
              // TEAM_LEAD : scope forcé à INDIVIDUAL, sélection parmi son équipe uniquement
              <p className="text-xs text-gray-400 mb-2 italic">Vous pouvez sélectionner uniquement les membres de votre équipe.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {([
                  [RuleScope.GLOBAL, 'Toute l\'équipe', 'Tous les commerciaux'],
                  [RuleScope.TEAM, 'Une équipe', 'Un groupe spécifique'],
                  [RuleScope.INDIVIDUAL, 'Personnes', 'Sélection manuelle'],
                ] as [RuleScope, string, string][]).map(([scope, label, desc]) => (
                  <button
                    key={scope}
                    type="button"
                    onClick={() => { setSelectedScope(scope); setSelectedParticipantIds(new Set()); }}
                    className={`p-3 border-2 rounded-xl text-left transition-colors ${selectedScope === scope ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <p className="text-xs font-semibold text-gray-800">{label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Sélecteur d'équipe (MANAGER uniquement) */}
            {!isTeamLead && selectedScope === RuleScope.TEAM && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 mb-1">Choisir l'équipe</label>
                {groups.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Aucune équipe configurée — créez des groupes dans "Mon équipe"</p>
                ) : (
                  <select {...register('teamName')} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400">
                    <option value="">-- Sélectionner une équipe --</option>
                    {groups.map((g) => (
                      <option key={g.id} value={g.name}>{g.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}

            {/* Sélection individuelle — toujours visible pour TEAM_LEAD */}
            {(isTeamLead || selectedScope === RuleScope.INDIVIDUAL) && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">Sélectionner les participants</label>
                  <button type="button" onClick={() => setSelectedParticipantIds(selectedParticipantIds.size === members.length ? new Set() : new Set(members.map((m) => m.id)))} className="text-xs text-primary-600 hover:underline">
                    {selectedParticipantIds.size === members.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </button>
                </div>
                {members.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Aucun commercial dans votre équipe</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {members.map((m) => (
                      <label key={m.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${selectedParticipantIds.has(m.id) ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                        <input type="checkbox" checked={selectedParticipantIds.has(m.id)} onChange={() => toggleParticipant(m.id)} className="w-4 h-4 rounded text-primary-600 border-gray-300 focus:ring-primary-400" />
                        <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-primary-700 font-semibold text-xs">{m.firstName[0]}{m.lastName[0]}</span>
                        </div>
                        <p className="text-sm text-gray-800">{m.firstName} {m.lastName}</p>
                      </label>
                    ))}
                  </div>
                )}
                {selectedParticipantIds.size > 0 && (
                  <p className="text-xs text-primary-600 mt-1.5 font-medium">{selectedParticipantIds.size} participant{selectedParticipantIds.size > 1 ? 's' : ''} sélectionné{selectedParticipantIds.size > 1 ? 's' : ''}</p>
                )}
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de début</label>
              <input type="date" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" {...register('periodStart')} />
              {errors.periodStart && <p className="mt-1 text-xs text-red-600">{errors.periodStart.message}</p>}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Date de fin</label>
              <input type="date" className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" {...register('periodEnd')} />
              {errors.periodEnd && <p className="mt-1 text-xs text-red-600">{errors.periodEnd.message}</p>}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description (optionnel)</label>
            <textarea rows={2} placeholder="Détails supplémentaires sur le concours..." className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none" {...register('description')} />
          </div>

          {createError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{createError}</p>
            </div>
          )}

          <div className="flex gap-3">
            <Button type="submit" loading={creating} className="flex-1">Lancer le concours</Button>
            <Button type="button" variant="secondary" onClick={() => setShowCreateModal(false)}>Annuler</Button>
          </div>
        </form>
      </Modal>

      {/* Modal classement */}
      <Modal isOpen={!!leaderboardContest} onClose={() => setLeaderboardContest(null)} title={`Classement — ${leaderboardContest?.name ?? ''}`} size="md">
        {leaderboardContest && (
          <div className="space-y-4">
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
                  <div key={entry.user.id} className={`flex items-center gap-3 p-3 rounded-xl ${entry.rank === 1 ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'}`}>
                    <span className={`font-bold text-lg w-8 text-center flex-shrink-0 ${getMedalColor(entry.rank)}`}>
                      {entry.rank <= 3 ? ['🥇', '🥈', '🥉'][entry.rank - 1] : entry.rank}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900">{entry.user.firstName} {entry.user.lastName}</p>
                      <p className="text-xs text-gray-400">{entry.user.email}</p>
                    </div>
                    <span className="font-bold text-gray-800 text-sm flex-shrink-0">
                      {leaderboardContest.metric === ContestMetric.REVENUE
                        ? formatEur(entry.value)
                        : `${entry.value} deal${entry.value > 1 ? 's' : ''}`}
                    </span>
                  </div>
                ))}
              </div>
            )}

            <Button variant="secondary" onClick={() => setLeaderboardContest(null)} className="w-full">Fermer</Button>
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
}

function ContestCard({ contest, actionLoading, onLeaderboard, onEnd, onCancel }: ContestCardProps) {
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
          {isActive && (
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
          )}
        </div>
      </div>
    </Card>
  );
}

// ============================================================
// ObjectiveEditor (copié depuis TeamPage pour l'onglet Objectifs)
// ============================================================

const PERIOD_TYPE_OPTIONS: { value: ObjectivePeriodType; label: string; description: string }[] = [
  { value: 'monthly',   label: 'Mensuel',     description: 'Un mois précis' },
  { value: 'quarterly', label: 'Trimestriel', description: 'T1, T2, T3 ou T4' },
  { value: 'annual',    label: 'Annuel',       description: 'Toute une année' },
  { value: 'custom',    label: 'Personnalisé', description: 'Plage de dates libre' },
];

interface ObjectiveEditorProps {
  obj: Objective;
  index: number;
  onChange: <K extends keyof Objective>(id: string, field: K, value: Objective[K]) => void;
  onRemove: (id: string) => void;
  hiddenRemove?: boolean;
}

function ObjectiveEditor({ obj, index, onChange, onRemove, hiddenRemove }: ObjectiveEditorProps) {
  const bonus = obj.bonus ?? { enabled: false, type: 'percentage' as const, value: 10 };

  const setBonus = (patch: Partial<ObjectiveBonus>) => {
    onChange(obj.id, 'bonus', { ...bonus, ...patch });
  };

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Objectif {index + 1}</span>
        {!hiddenRemove && (
          <button type="button" onClick={() => onRemove(obj.id)} className="text-gray-300 hover:text-red-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Intitulé</label>
        <input type="text" placeholder="ex : CA T1, Deals signés janvier…" value={obj.label} onChange={(e) => onChange(obj.id, 'label', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cible</label>
          <input type="number" min="0" placeholder="50 000" value={obj.target} onChange={(e) => onChange(obj.id, 'target', parseFloat(e.target.value) || 0)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Unité</label>
          <select value={obj.unit} onChange={(e) => onChange(obj.id, 'unit', e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Période</label>
        <div className="grid grid-cols-2 gap-2">
          {PERIOD_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-colors ${obj.periodType === opt.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
              <input type="radio" className="sr-only" checked={obj.periodType === opt.value} onChange={() => onChange(obj.id, 'periodType', opt.value)} />
              <div><p className="text-xs font-semibold text-gray-800">{opt.label}</p><p className="text-xs text-gray-400">{opt.description}</p></div>
            </label>
          ))}
        </div>
      </div>

      <PeriodFields obj={obj} onChange={onChange} />

      <div className="border-t border-gray-200 pt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-semibold text-gray-700">Prime de dépassement</p>
            <p className="text-xs text-gray-400">Récompense si le commercial dépasse la cible</p>
          </div>
          <button type="button" onClick={() => setBonus({ enabled: !bonus.enabled })} className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${bonus.enabled ? 'bg-primary-500' : 'bg-gray-200'}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${bonus.enabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {bonus.enabled && (
          <div className="space-y-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Type de prime</label>
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer ${bonus.type === 'percentage' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                  <input type="radio" className="sr-only" checked={bonus.type === 'percentage'} onChange={() => setBonus({ type: 'percentage' })} />
                  <div><p className="text-xs font-semibold text-gray-800">% des ventes</p><p className="text-xs text-gray-400">Au-dessus de la cible</p></div>
                </label>
                <label className={`flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer ${bonus.type === 'fixed' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                  <input type="radio" className="sr-only" checked={bonus.type === 'fixed'} onChange={() => setBonus({ type: 'fixed' })} />
                  <div><p className="text-xs font-semibold text-gray-800">Montant fixe</p><p className="text-xs text-gray-400">Dès l'objectif atteint</p></div>
                </label>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{bonus.type === 'percentage' ? 'Taux (%)' : 'Montant (€)'}</label>
              <div className="relative">
                <input type="number" min="0" step={bonus.type === 'percentage' ? '0.5' : '50'} value={bonus.value} onChange={(e) => setBonus({ value: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">{bonus.type === 'percentage' ? '%' : '€'}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Champs de période dynamiques
interface PeriodFieldsProps {
  obj: Objective;
  onChange: <K extends keyof Objective>(id: string, field: K, value: Objective[K]) => void;
}

function PeriodFields({ obj, onChange }: PeriodFieldsProps) {
  if (obj.periodType === 'monthly') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mois</label>
          <select value={obj.month ?? 1} onChange={(e) => onChange(obj.id, 'month', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
          <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
    );
  }
  if (obj.periodType === 'quarterly') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Trimestre</label>
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((q) => (
              <button key={q} type="button" onClick={() => onChange(obj.id, 'quarter', q)} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${obj.quarter === q ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>T{q}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
          <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
    );
  }
  if (obj.periodType === 'annual') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
        <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    );
  }
  if (obj.periodType === 'custom') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date de début</label>
          <input type="date" value={obj.startDate ?? ''} onChange={(e) => onChange(obj.id, 'startDate', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date de fin</label>
          <input type="date" value={obj.endDate ?? ''} min={obj.startDate ?? undefined} onChange={(e) => onChange(obj.id, 'endDate', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
      </div>
    );
  }
  return null;
}
