import { useEffect, useState } from 'react';
import { useAuthStore } from '../../stores/auth.store';
import { commissionRuleApiService } from '../../services/commissionRule.service';
import { contestApiService } from '../../services/contest.service';
import { api } from '../../services/api';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { TruncatedText } from '../../components/ui/TruncatedText';
import type { Contest, ContestLeaderboardEntry, PublicUser } from '@shared/types';
import { ContestMetric, ContestStatus, RuleScope, UserRole } from '@shared/types';
import { ParametrageNavCards, type ParametrageTab } from '../../components/parametrage/ParametrageNavCards';
import { VariablePlanTab } from '../../components/variable-plan/VariablePlanTab';
import { PlanList } from '../../components/variable-plan/PlanList';
import { ContestWizard } from '../../components/contests/ContestWizard';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// ============================================================
// Helpers communs
// ============================================================

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
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
  const [activeTab, setActiveTab] = useState<ParametrageTab>('plan');

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
      {activeTab === 'plan' && (
        <div className="space-y-6">
          {/* Création par IA + dashboard de simulation */}
          <VariablePlanTab />

          {/* Bibliothèque des plans modèles (junior, senior, responsable…) */}
          <PlanList />
        </div>
      )}
      {activeTab === 'concours' && <ConcoursTab isTeamLead={isTeamLead} />}
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
                            <TruncatedText text={d.dealTitle} className="col-span-3 font-medium" as="span" />
                            <TruncatedText text={d.clientName ?? '-'} className="col-span-2 text-gray-500" as="span" />
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


