import { useEffect, useState } from 'react';
import { commissionApiService } from '../../services/commission.service';
import { commissionDisputeService } from '../../services/commissionDispute.service';
import { authApiService } from '../../services/auth.service';
import { contestApiService } from '../../services/contest.service';
import { Card } from '../../components/ui/Card';
import { Badge, CommissionStatusBadge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { CommissionWithDetails, Objective, PublicUser, Contest, ContestLeaderboardEntry, AnonymousLeaderboardResult } from '@shared/types';
import { ContestMetric } from '@shared/types';
import type { LeaderboardResponse } from '../../services/contest.service';
import { format } from 'date-fns';
import {
  isObjectiveCurrent, isObjectiveFuture, getObjectiveDateRange,
  formatObjectivePeriod, computeProgress, computeBonus, countDealsWithoutMargin,
} from '../../utils/objectives';
import { fr } from 'date-fns/locale';

// ─── Modal de contestation ────────────────────────────────────────────────────
function RaiseDisputeModal({
  commission,
  onClose,
  onRaised,
}: {
  commission: CommissionWithDetails;
  onClose: () => void;
  onRaised: () => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (reason.trim().length < 10) {
      setError('Le motif doit contenir au moins 10 caractères.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await commissionDisputeService.raise(commission.id, reason.trim());
      onRaised();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message ?? 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        <h3 className="text-base font-semibold text-gray-900 mb-1">Contester une commission</h3>
        <p className="text-sm text-gray-500 mb-4">
          Deal : <span className="font-medium text-gray-800">{commission.deal.title}</span>
          {' — '}<span className="font-semibold text-gray-900">{new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(commission.amount)}</span>
        </p>

        <label className="block text-sm font-medium text-gray-700 mb-1">
          Motif de la contestation <span className="text-red-500">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={4}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          placeholder="Expliquez pourquoi vous contestez ce montant (min. 10 caractères)…"
        />
        <p className="text-xs text-gray-400 mt-1">{reason.trim().length} / 10 caractères minimum</p>

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex gap-3 justify-end mt-5">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button size="sm" loading={loading} onClick={() => void handleSubmit()}>
            Soumettre la contestation
          </Button>
        </div>
      </div>
    </div>
  );
}

// Commission différée (étendue avec scheduledPaymentAt)
interface DeferredCommission extends CommissionWithDetails {
  scheduledPaymentAt: string | null;
}

interface WonDealSummary {
  id: string;
  title: string;
  clientName: string | null;
  amount: number;
  marginAmount: number | null;
  userShare: number;
  closedAt: string | null;
  syncedAt: string | null;
}

interface AdjustmentItem {
  id: string;
  amount: number;
  reason: string;
  status: string;
  createdBy: string;
  createdAt: string;
  paidAt: string | null;
}

interface DashboardData {
  fixedSalary: number;
  totalMonthRevenue: number;
  totalEarnedThisMonth: number;
  totalPendingValidation: number;
  totalDeferredCommissions: number;
  projectedCommissions: number;
  commissions: CommissionWithDetails[];
  deferredCommissions: DeferredCommission[];
  wonDeals: WonDealSummary[];
  adjustments: AdjustmentItem[];
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function contestMetricLabel(metric: ContestMetric): string {
  if (metric === ContestMetric.MARGIN) return 'Marge réalisée';
  if (metric === ContestMetric.DEAL_COUNT) return 'Deals signés';
  return 'CA réalisé';
}

function formatContestValue(metric: ContestMetric, value: number): string {
  if (metric === ContestMetric.DEAL_COUNT) return `${value} deal${value > 1 ? 's' : ''}`;
  return formatEur(value);
}

// Les fonctions utilitaires (getObjectiveDateRange, computeProgress, computeBonus,
// formatObjectivePeriod, isObjectiveCurrent, isObjectiveFuture) sont dans utils/objectives.ts

// ============================================================
// Composant barre de progression d'un objectif
// ============================================================
function ObjectiveProgressCard({ obj, wonDeals, pendingCommissionCount }: { obj: Objective; wonDeals: WonDealSummary[]; pendingCommissionCount?: number }) {
  const current = computeProgress(obj, wonDeals);
  const pct = obj.target > 0 ? (current / obj.target) * 100 : 0;
  const isCurrent = isObjectiveCurrent(obj);
  const isFuture = isObjectiveFuture(obj);
  const isDone = pct >= 100;
  const { amount: bonusEarned } = computeBonus(obj, current);
  const effectiveBonusMode = obj.bonusMode ?? (obj.bonus?.enabled ? 'simple' : 'none');
  const hasBonusRule = effectiveBonusMode !== 'none';
  const isTiered = effectiveBonusMode === 'tiered';
  const isRecurrent = !!obj.parentObjectiveId;
  const missingMarginCount = countDealsWithoutMargin(obj, wonDeals);

  const formatValue = (v: number) => {
    if (obj.unit === '€' || obj.unit === 'marge') return formatEur(v);
    if (obj.unit === '%') return `${v.toFixed(1)} %`;
    return `${v} deal${v > 1 ? 's' : ''}`;
  };

  const barColor = isDone ? 'bg-green-500' : isCurrent ? 'bg-primary-500' : isFuture ? 'bg-gray-300' : 'bg-gray-400';
  const badgeLabel = isDone ? 'Atteint !' : isCurrent ? 'En cours' : isFuture ? 'À venir' : 'Terminé';
  const badgeColor = isDone ? 'bg-green-100 text-green-700' : isCurrent ? 'bg-primary-100 text-primary-700' : isFuture ? 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-400';

  const sortedTiers = isTiered && obj.bonusTiers
    ? [...obj.bonusTiers].sort((a, b) => a.threshold - b.threshold)
    : [];
  // Échelle de la barre : s'étend jusqu'au palier max ou 100%, selon le plus grand
  const barScale = Math.max(100, ...sortedTiers.map((t) => t.threshold), pct);
  return (
    <div className={`bg-white rounded-xl border p-5 space-y-3 ${isDone && hasBonusRule ? 'border-green-300 ring-1 ring-green-200' : 'border-gray-200'}`}>
      {/* En-tête */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <p className="font-semibold text-gray-900 text-sm">{obj.label || 'Objectif'}</p>
            {isRecurrent && (
              <span
                className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-500 font-medium cursor-help"
                title={`Cet objectif se renouvelle automatiquement chaque ${obj.periodType === 'monthly' ? 'mois' : obj.periodType === 'quarterly' ? 'trimestre' : obj.periodType === 'semester' ? 'semestre' : 'année'}`}
              >
                🔁 {formatObjectivePeriod(obj)}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">{formatObjectivePeriod(obj)}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${badgeColor}`}>{badgeLabel}</span>
          {/* Chantier 4.3 — Tooltip explicatif */}
          <span
            className="text-gray-300 hover:text-gray-500 cursor-help text-xs"
            title="Le score se base sur toutes vos ventes validées (WON dans le CRM), y compris celles dont la commission n'est pas encore versée. Si une vente est annulée par votre manager (paiement client non reçu), elle sera retirée de ce score."
          >
            (?)
          </span>
        </div>
      </div>

      {/* Barre de progression */}
      <div>
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-lg font-bold text-gray-900">{formatValue(current)}</span>
          <span className="text-xs text-gray-400">sur {formatValue(obj.target)}</span>
        </div>
        {/* Barre avec jalons — l'échelle s'adapte aux paliers au-delà de 100% */}
        <div className="relative w-full">
          <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
            <div className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${Math.min(pct / barScale * 100, 100)}%` }} />
          </div>
          {/* Marqueur 100% si la barre va au-delà */}
          {barScale > 100 && (
            <div
              className="absolute top-0 w-0.5 h-2.5 bg-green-400 opacity-80"
              style={{ left: `${(100 / barScale) * 100}%` }}
              title="Objectif 100%"
            />
          )}
          {isTiered && sortedTiers.map((tier) => (
            <div
              key={tier.threshold}
              className="absolute top-0 w-0.5 h-2.5 bg-gray-400 opacity-60"
              style={{ left: `${(tier.threshold / barScale) * 100}%` }}
              title={`Palier à ${tier.threshold}%`}
            />
          ))}
        </div>
        <div className="flex justify-between mt-1">
          <span className={`text-xs font-medium ${pct > 100 ? 'text-green-600' : 'text-gray-400'}`}>{pct.toFixed(0)} % atteint</span>
          {!isDone && isCurrent && obj.target > 0 && (
            <span className="text-xs text-gray-400">{formatValue(Math.max(0, obj.target - current))} restant</span>
          )}
        </div>
      </div>

      {/* Paliers tiered */}
      {isTiered && sortedTiers.length > 0 && (() => {
        const reachedCount = sortedTiers.filter((t) => pct >= t.threshold).length;
        // Total potentiel si tous les paliers sont débloqués
        const totalPotential = sortedTiers.reduce((sum, t) => {
          return sum + (t.reward.type === 'fixed' ? t.reward.value : obj.target * (t.reward.value / 100));
        }, 0);
        return (
          <div className="space-y-1.5">
            {/* En-tête avec total potentiel */}
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-gray-600">Paliers de prime ({reachedCount}/{sortedTiers.length})</p>
              {bonusEarned > 0
                ? <p className="text-xs font-bold text-green-600">Gagné : +{formatEur(bonusEarned)}</p>
                : <p className="text-xs text-gray-400">Jusqu'à +{formatEur(totalPotential)}</p>
              }
            </div>

            {sortedTiers.map((tier) => {
              const reached = pct >= tier.threshold;
              const rewardAmount = tier.reward.type === 'fixed'
                ? tier.reward.value
                : current * (tier.reward.value / 100);
              const rewardLabel = tier.reward.type === 'fixed'
                ? formatEur(tier.reward.value)
                : `${tier.reward.value} % du CA`;
              const remaining = Math.max(0, (tier.threshold / 100) * obj.target - current);
              return (
                <div key={tier.threshold} className={`flex items-center justify-between text-xs px-3 py-2 rounded-lg ${reached ? 'bg-green-50 border border-green-200 text-green-700' : 'bg-gray-50 border border-gray-100 text-gray-500'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${reached ? 'text-green-500' : 'text-gray-300'}`}>{reached ? '✅' : '⬜'}</span>
                    <div>
                      <span className="font-medium">À {tier.threshold}% → {rewardLabel}</span>
                      {!reached && isCurrent && (
                        <p className="text-xs text-primary-500 font-medium mt-0.5">
                          Plus que {formatValue(remaining)} pour débloquer
                        </p>
                      )}
                    </div>
                  </div>
                  {reached
                    ? <span className="font-bold text-green-600">+{formatEur(rewardAmount)}</span>
                    : <span className="font-medium text-gray-400">+{rewardLabel}</span>
                  }
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Prime mode simple */}
      {!isTiered && hasBonusRule && obj.bonus?.enabled && (
        <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${bonusEarned > 0 ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
          <div className="flex items-center gap-2">
            <span className="text-base">{bonusEarned > 0 ? '🎉' : '🎯'}</span>
            <div>
              <p className="text-xs font-semibold text-gray-700">
                {bonusEarned > 0 ? 'Prime gagnée !' : 'Prime de dépassement'}
              </p>
              <p className="text-xs text-gray-500">
                {obj.bonus.type === 'percentage'
                  ? `${obj.bonus.value} % des ventes au-dessus de la cible`
                  : `${formatEur(obj.bonus.value)} dès l'objectif atteint`}
              </p>
            </div>
          </div>
          <span className={`text-sm font-bold ${bonusEarned > 0 ? 'text-green-600' : 'text-amber-600'}`}>
            {bonusEarned > 0
              ? `+${formatEur(bonusEarned)}`
              : `jusqu'à +${formatEur(obj.bonus.type === 'fixed' ? obj.bonus.value : 0)}`}
          </span>
        </div>
      )}

      {/* Warning marge inconnue (Chantier 1.4) */}
      {missingMarginCount > 0 && (
        <div className="rounded-lg px-3 py-2 bg-amber-50 border border-amber-100 flex items-center gap-2">
          <span className="text-amber-500 text-sm flex-shrink-0">⚠</span>
          <p className="text-xs text-amber-700">
            {missingMarginCount} vente{missingMarginCount > 1 ? 's' : ''} non comptée{missingMarginCount > 1 ? 's' : ''} (marge inconnue)
          </p>
        </div>
      )}

      {/* Lien projections (Chantier 4.1) */}
      {isCurrent && (pendingCommissionCount ?? 0) > 0 && (
        <a
          href="/dashboard/projections"
          className="block text-xs text-primary-600 hover:text-primary-700 px-1 pt-1"
        >
          Inclut {pendingCommissionCount} vente{(pendingCommissionCount ?? 0) > 1 ? 's' : ''} dont la commission est encore en attente.{' '}
          <span className="underline">Voir mes projections →</span>
        </a>
      )}
    </div>
  );
}

// ============================================================
// Dashboard principal
// ============================================================
export function CommercialDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contests, setContests] = useState<Contest[]>([]);
  const [contestsError, setContestsError] = useState<string | null>(null);
  const [leaderboards, setLeaderboards] = useState<Record<string, LeaderboardResponse>>({});
  const [disputeModal, setDisputeModal] = useState<CommissionWithDetails | null>(null);
  // Sélecteur de mois pour le détail des commissions
  const now = new Date();
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth()); // 0-indexed
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    setContestsError(null);
    try {
      const [stats, me] = await Promise.all([
        commissionApiService.getCommercialStats(),
        authApiService.me(),
      ]);
      setData(stats as unknown as DashboardData);
      setUser(me);

      // Charger les concours séparément pour voir l'erreur si besoin
      try {
        const activeContests = await contestApiService.getAll();
        setContests(activeContests);

        if (activeContests.length > 0) {
          const entries = await Promise.all(
            activeContests.map((c) =>
              contestApiService.getLeaderboard(c.id).catch(() => [] as ContestLeaderboardEntry[]),
            ),
          );
          const map: Record<string, LeaderboardResponse> = {};
          activeContests.forEach((c, i) => { map[c.id] = entries[i]; });
          setLeaderboards(map);
        }
      } catch (contestErr) {
        const msg = (contestErr as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
        setContestsError(msg ?? String(contestErr));
        setContests([]);
      }
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error?.message;
      setLoadError(msg ?? 'Impossible de charger le tableau de bord');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-4 text-center max-w-md">
          <p className="text-sm font-semibold text-red-700 mb-1">Erreur de chargement</p>
          <p className="text-xs text-red-600 font-mono">{loadError}</p>
        </div>
        <button onClick={() => void load()} className="text-sm text-primary-600 underline">Réessayer</button>
      </div>
    );
  }

  const fixedSalary = data?.fixedSalary ?? 0;
  const commissions = data?.totalEarnedThisMonth ?? 0;
  const allAdjustments = data?.adjustments ?? [];
  const paidBonuses = allAdjustments.filter((a) => a.status === 'PAID' && a.amount > 0);
  const totalBonuses = paidBonuses.reduce((sum, a) => sum + a.amount, 0);
  const total = (data?.totalMonthRevenue ?? 0) + totalBonuses;
  const allCommissions = data?.commissions ?? [];
  const wonDeals = data?.wonDeals ?? [];
  // Chantier 4.1 : nombre de commissions PENDING pour les cartes objectifs
  const pendingCommissionCount = allCommissions.filter((c) => c.status === 'PENDING').length;
  const objectives: Objective[] = Array.isArray(user?.objectives) ? (user!.objectives as Objective[]) : [];

  // Chantier 6.6 : masquer les templates récurrents si des occurrences existent.
  // Un template = recurrence !== 'none' && !parentObjectiveId
  // Une occurrence = parentObjectiveId défini
  const occurrenceParentIds = new Set(
    objectives.filter((o) => !!o.parentObjectiveId).map((o) => o.parentObjectiveId!),
  );

  // Pour chaque template récurrent, ne garder que l'occurrence la plus pertinente
  // (période en cours, sinon la plus récente). Évite d'afficher Jan, Fév, Mar, Avr…
  const bestOccurrenceIds = new Set<string>();
  for (const templateId of occurrenceParentIds) {
    const occurrences = objectives.filter((o) => o.parentObjectiveId === templateId);
    // Priorité 1 : occurrence de la période en cours
    const current = occurrences.find((o) => isObjectiveCurrent(o));
    if (current) {
      bestOccurrenceIds.add(current.id);
    } else {
      // Priorité 2 : occurrence future la plus proche
      const future = occurrences
        .filter((o) => isObjectiveFuture(o))
        .sort((a, b) => {
          const ra = getObjectiveDateRange(a);
          const rb = getObjectiveDateRange(b);
          return (ra?.[0].getTime() ?? 0) - (rb?.[0].getTime() ?? 0);
        })[0];
      if (future) {
        bestOccurrenceIds.add(future.id);
      } else if (occurrences.length > 0) {
        // Priorité 3 : occurrence la plus récente (passée)
        const sorted = [...occurrences].sort((a, b) => {
          const ra = getObjectiveDateRange(a);
          const rb = getObjectiveDateRange(b);
          return (rb?.[0].getTime() ?? 0) - (ra?.[0].getTime() ?? 0);
        });
        bestOccurrenceIds.add(sorted[0].id);
      }
    }
  }

  const visibleObjectives = objectives.filter((o) => {
    // Masquer les templates qui ont des occurrences
    if (o.recurrence && o.recurrence !== 'none' && !o.parentObjectiveId && occurrenceParentIds.has(o.id)) {
      return false;
    }
    // Pour les occurrences, ne garder que la meilleure par template
    if (o.parentObjectiveId && occurrenceParentIds.has(o.parentObjectiveId)) {
      return bestOccurrenceIds.has(o.id);
    }
    return true;
  });

  // Trier : en cours d'abord, puis à venir, puis passés
  const sortedObjectives = [...visibleObjectives].sort((a, b) => {
    const aScore = isObjectiveCurrent(a) ? 0 : isObjectiveFuture(a) ? 1 : 2;
    const bScore = isObjectiveCurrent(b) ? 0 : isObjectiveFuture(b) ? 1 : 2;
    return aScore - bScore;
  });

  // Primes confirmées : objectifs EN COURS déjà atteints → bonus garanti, versé en fin de période
  const confirmedBonuses = visibleObjectives
    .filter((o) => isObjectiveCurrent(o))
    .map((o) => {
      const current = computeProgress(o, wonDeals);
      const { amount } = computeBonus(o, current);
      return { objective: o, current, amount };
    })
    .filter((b) => b.amount > 0);
  const totalConfirmedBonuses = confirmedBonuses.reduce((sum, b) => sum + b.amount, 0);

  return (
    <div className="space-y-6">
      {/* En-tête */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
          <p className="text-gray-500 mt-1">Vos revenus, objectifs et concours en temps réel</p>
        </div>
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition-colors mt-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Actualiser
        </button>
      </div>

      {/* ====== Section Mes revenus ====== */}
      <div className="space-y-6">

      {/* Carte héro — Revenu total du mois */}
      <div className="bg-gradient-to-br from-primary-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg">
        <p className="text-primary-200 text-sm font-medium mb-1">Revenu total ce mois</p>
        <p className="text-4xl font-bold mb-4">{formatEur(total)}</p>
        <div className="flex gap-6">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-white/40" />
            <div>
              <p className="text-xs text-primary-200">Salaire fixe</p>
              <p className="text-base font-semibold">{formatEur(fixedSalary)}</p>
            </div>
          </div>
          <div className="w-px bg-white/20" />
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-green-300" />
            <div>
              <p className="text-xs text-primary-200">Commissions validées</p>
              <p className="text-base font-semibold">{formatEur(commissions)}</p>
            </div>
          </div>
          {totalBonuses > 0 && (
            <>
              <div className="w-px bg-white/20" />
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-amber-300" />
                <div>
                  <p className="text-xs text-primary-200">Primes d'objectifs</p>
                  <p className="text-base font-semibold">{formatEur(totalBonuses)}</p>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Stats secondaires */}
      <div className={`grid grid-cols-1 gap-5 ${totalConfirmedBonuses > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        <div className="bg-white rounded-xl border border-yellow-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-yellow-600 font-medium">En attente de validation</p>
            <p className="text-2xl font-bold text-gray-900">{formatEur(data?.totalPendingValidation ?? 0)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Sera ajouté une fois validé par votre manager</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-green-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-green-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-green-600 font-medium">Commissions validées ce mois</p>
            <p className="text-2xl font-bold text-gray-900">{formatEur(data?.totalEarnedThisMonth ?? 0)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Validées par votre manager sur le mois en cours</p>
          </div>
        </div>

        {totalConfirmedBonuses > 0 && (
          <div className="bg-white rounded-xl border border-emerald-200 p-5 flex items-center gap-4">
            <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center flex-shrink-0">
              <span className="text-lg">🎯</span>
            </div>
            <div>
              <p className="text-xs text-emerald-600 font-medium">Primes d'objectifs confirmées</p>
              <p className="text-2xl font-bold text-gray-900">{formatEur(totalConfirmedBonuses)}</p>
              <p className="text-xs text-gray-400 mt-0.5">Versement automatique le mois prochain</p>
            </div>
          </div>
        )}
      </div>

      {(data?.totalDeferredCommissions ?? 0) > 0 && (
        <div className="bg-orange-50 rounded-xl border border-orange-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-orange-600 font-medium">Ventes gagnées — paiement différé</p>
            <p className="text-xl font-bold text-gray-900">{formatEur(data?.totalDeferredCommissions ?? 0)}</p>
            <p className="text-xs text-orange-500 mt-0.5">Versé automatiquement à la date prévue</p>
          </div>
        </div>
      )}

      {/* Section commissions différées */}
      {(data?.deferredCommissions?.length ?? 0) > 0 && (
        <Card>
          <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Ventes gagnées — paiement différé
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Ces commissions seront automatiquement validées et apparaîtront dans vos gains le mois du versement prévu.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Deal</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Commission</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Paiement prévu le</th>
                </tr>
              </thead>
              <tbody>
                {data!.deferredCommissions.map((commission) => (
                  <tr key={commission.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2">
                      <p className="font-medium text-gray-900 max-w-[220px] truncate">{commission.deal.title}</p>
                      {commission.deal.clientName && (
                        <p className="text-xs text-gray-400">{commission.deal.clientName}</p>
                      )}
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900">
                      {formatEur(commission.amount)}
                    </td>
                    <td className="py-3 px-2">
                      <span className="inline-flex items-center gap-1.5 text-orange-700 font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {commission.scheduledPaymentAt
                          ? format(new Date(commission.scheduledPaymentAt), 'dd MMMM yyyy', { locale: fr })
                          : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Détail des ventes — filtre par mois */}
      <Card>
        {/* En-tête avec sélecteur de mois */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Détail de mes ventes</h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                if (selectedMonth === 0) { setSelectedMonth(11); setSelectedYear(selectedYear - 1); }
                else { setSelectedMonth(selectedMonth - 1); }
              }}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
              title="Mois précédent"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-sm font-medium text-gray-700 min-w-[130px] text-center capitalize">
              {format(new Date(selectedYear, selectedMonth, 1), 'MMMM yyyy', { locale: fr })}
            </span>
            <button
              onClick={() => {
                if (selectedMonth === 11) { setSelectedMonth(0); setSelectedYear(selectedYear + 1); }
                else { setSelectedMonth(selectedMonth + 1); }
              }}
              disabled={selectedYear === now.getFullYear() && selectedMonth === now.getMonth()}
              className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Mois suivant"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            </button>
            {(selectedMonth !== now.getMonth() || selectedYear !== now.getFullYear()) && (
              <button
                onClick={() => { setSelectedMonth(now.getMonth()); setSelectedYear(now.getFullYear()); }}
                className="ml-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
              >
                Aujourd'hui
              </button>
            )}
          </div>
        </div>

        {/* Filtrer les ventes et primes du mois sélectionné */}
        {(() => {
          const monthStart = new Date(selectedYear, selectedMonth, 1);
          const monthEnd = new Date(selectedYear, selectedMonth + 1, 0, 23, 59, 59);

          const isInMonth = (dateStr: string | null | undefined) => {
            if (!dateStr) return false;
            const d = new Date(dateStr);
            return d >= monthStart && d <= monthEnd;
          };
          const isCurrentMonth = selectedMonth === now.getMonth() && selectedYear === now.getFullYear();

          // Commissions filtrées par mois
          const monthCommissions = allCommissions.filter((c) => {
            if (c.awaitingClientPayment && c.status === 'PENDING') return isCurrentMonth;
            if (c.clientPaidAt && (c.status === 'PAID' || c.status === 'VALIDATED')) {
              return isInMonth(c.paidAt ?? c.validatedAt);
            }
            return isInMonth(c.deal.closedAt ?? c.validatedAt ?? c.calculatedAt);
          });

          // Ventes du mois sans aucune commission (pas de règle assignée)
          const dealIdsWithCommission = new Set(allCommissions.map((c) => c.dealId));
          const monthDealsWithoutCommission = wonDeals
            .filter((d) => !dealIdsWithCommission.has(d.id))
            .filter((d) => isInMonth(d.closedAt));

          const monthBonuses = paidBonuses.filter((a) => isInMonth(a.paidAt ?? a.createdAt));

          // Totaux du mois
          const totalSalesCount = monthCommissions.length + monthDealsWithoutCommission.length;
          const activeMonth = monthCommissions.filter((c) => c.status !== 'CANCELLED');
          const monthPaidTotal = activeMonth
            .filter((c) => c.status === 'PAID' || c.status === 'VALIDATED')
            .reduce((sum, c) => sum + c.amount, 0);
          const monthPendingTotal = activeMonth
            .filter((c) => c.status === 'PENDING')
            .reduce((sum, c) => sum + c.amount, 0);
          const monthBonusTotal = monthBonuses.reduce((sum, a) => sum + a.amount, 0);

          const hasRows = totalSalesCount > 0 || monthBonuses.length > 0;

          return (
            <>
              {/* Résumé du mois */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                <div className="bg-gray-50 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-xs text-gray-500 mb-0.5">Ventes du mois</p>
                  <p className="text-lg font-bold text-gray-900">{totalSalesCount}</p>
                </div>
                <div className="bg-green-50 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-xs text-green-600 mb-0.5">Commissions versées</p>
                  <p className="text-lg font-bold text-green-700">{formatEur(monthPaidTotal)}</p>
                </div>
                <div className="bg-yellow-50 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-xs text-yellow-600 mb-0.5">En attente</p>
                  <p className="text-lg font-bold text-yellow-700">{formatEur(monthPendingTotal)}</p>
                </div>
                <div className="bg-emerald-50 rounded-lg px-3 py-2.5 text-center">
                  <p className="text-xs text-emerald-600 mb-0.5">Primes</p>
                  <p className="text-lg font-bold text-emerald-700">{formatEur(monthBonusTotal)}</p>
                </div>
              </div>

              {!hasRows ? (
                <div className="text-center py-10 text-gray-400">
                  <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                  </svg>
                  <p className="font-medium">Aucune vente ce mois</p>
                  <p className="text-sm mt-1">
                    {isCurrentMonth
                      ? 'Vos ventes apparaîtront ici une fois que vos deals seront synchronisés'
                      : 'Aucune vente enregistrée sur cette période'}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left py-3 px-2 font-medium text-gray-500">Deal</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500">Client</th>
                        <th className="text-right py-3 px-2 font-medium text-gray-500">Montant vente</th>
                        <th className="text-right py-3 px-2 font-medium text-gray-500">Commission</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500">Détail</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500">Statut</th>
                        <th className="text-left py-3 px-2 font-medium text-gray-500">Date</th>
                        <th className="text-right py-3 px-2 font-medium text-gray-500">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {/* Primes d'objectifs du mois */}
                      {monthBonuses.map((adj) => (
                        <tr key={`adj-${adj.id}`} className="border-b border-gray-50 last:border-0 bg-emerald-50/30">
                          <td className="py-3 px-2" colSpan={2}>
                            <div className="flex items-center gap-2">
                              <span className="text-sm">🎯</span>
                              <p className="font-medium text-gray-900 max-w-[300px] truncate">{adj.reason}</p>
                            </div>
                          </td>
                          <td className="py-3 px-2 text-right text-gray-400 text-xs">—</td>
                          <td className="py-3 px-2 text-right font-semibold text-emerald-700">
                            +{formatEur(adj.amount)}
                          </td>
                          <td className="py-3 px-2 text-gray-500 text-xs">Prime d'objectif</td>
                          <td className="py-3 px-2">
                            <Badge variant="green">Validée</Badge>
                          </td>
                          <td className="py-3 px-2 text-gray-400 text-xs whitespace-nowrap">
                            {format(new Date(adj.paidAt ?? adj.createdAt), 'dd MMM yyyy', { locale: fr })}
                          </td>
                          <td className="py-3 px-2" />
                        </tr>
                      ))}

                      {/* Ventes avec commission */}
                      {monthCommissions.map((commission) => {
                        const isCancelled = commission.status === 'CANCELLED';
                        const hasOpenDispute = commission.dispute?.status === 'OPEN';
                        const hasResolvedDispute = commission.dispute && commission.dispute.status !== 'OPEN';
                        const isAccepted = commission.dispute?.status === 'RESOLVED_ACCEPTED';
                        const isRejected = commission.dispute?.status === 'RESOLVED_REJECTED';
                        return (
                        <tr key={commission.id} className={`border-b border-gray-50 last:border-0 ${isCancelled ? 'opacity-60' : ''}`}>
                          <td className="py-3 px-2">
                            <p className="font-medium text-gray-900 max-w-[180px] truncate">{commission.deal.title}</p>
                            {hasResolvedDispute && commission.dispute?.managerResponse && (
                              <div className={`mt-1.5 rounded-lg px-2.5 py-1.5 text-xs border ${
                                isAccepted
                                  ? 'bg-green-50 border-green-200 text-green-700'
                                  : 'bg-amber-50 border-amber-200 text-amber-700'
                              }`}>
                                <div className="flex items-center gap-1 mb-0.5">
                                  <span className="text-xs">{isAccepted ? '\u2705' : '\u270B'}</span>
                                  <span className="font-semibold">
                                    {isAccepted ? 'Contestation acceptée' : 'Contestation rejetée'}
                                  </span>
                                </div>
                                <p className="text-xs leading-relaxed">{commission.dispute.managerResponse}</p>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            {commission.deal.clientName
                              ? <p className="text-gray-700 text-sm max-w-[150px] truncate">{commission.deal.clientName}</p>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="py-3 px-2 text-right text-gray-600">{formatEur(commission.deal.amount)}</td>
                          <td className={`py-3 px-2 text-right font-semibold ${isCancelled ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                            {formatEur(commission.amount)}
                          </td>
                          <td className="py-3 px-2 text-gray-500 text-xs max-w-[200px]">
                            {commission.calculationDetail ?? commission.rule.name}
                          </td>
                          <td className="py-3 px-2">
                            {isCancelled
                              ? <Badge variant="red">Annulée</Badge>
                              : commission.awaitingClientPayment
                              ? (
                                <div>
                                  <Badge variant="orange">En attente paiement client</Badge>
                                  <p className="text-xs text-gray-400 mt-0.5">Sera versée une fois que le client aura réglé la prestation</p>
                                </div>
                              )
                              : <CommissionStatusBadge status={commission.status} scheduledPaymentAt={(commission as DeferredCommission).scheduledPaymentAt} />
                            }
                            {hasOpenDispute && (
                              <div className="mt-1">
                                <Badge variant="yellow">Contestation en cours</Badge>
                              </div>
                            )}
                            {isRejected && (
                              <div className="mt-1">
                                <Badge variant="red">Contestation rejetée</Badge>
                              </div>
                            )}
                            {isAccepted && (
                              <div className="mt-1">
                                <Badge variant="green">Contestation acceptée</Badge>
                              </div>
                            )}
                          </td>
                          <td className="py-3 px-2 text-xs whitespace-nowrap">
                            <p className="text-gray-400">
                              <span className="text-gray-500 font-medium">Signé </span>
                              {format(
                                new Date(commission.deal.closedAt ?? commission.calculatedAt),
                                'dd MMM yyyy',
                                { locale: fr }
                              )}
                            </p>
                            {commission.clientPaidAt && (commission.status === 'PAID' || commission.status === 'VALIDATED') && (commission.paidAt ?? commission.validatedAt) && (
                              <p className="text-green-600 mt-0.5">
                                <span className="font-medium">Validé </span>
                                {format(
                                  new Date((commission.paidAt ?? commission.validatedAt)!),
                                  'dd MMM yyyy',
                                  { locale: fr }
                                )}
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-2 text-right">
                            {!isCancelled && !hasOpenDispute && !hasResolvedDispute && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setDisputeModal(commission)}
                                title="Contester cette commission"
                              >
                                Contester
                              </Button>
                            )}
                          </td>
                        </tr>
                        );
                      })}

                      {/* Ventes sans règle de commission */}
                      {monthDealsWithoutCommission.map((deal) => (
                        <tr key={`deal-${deal.id}`} className="border-b border-gray-50 last:border-0">
                          <td className="py-3 px-2">
                            <p className="font-medium text-gray-900 max-w-[180px] truncate">{deal.title}</p>
                            {deal.userShare < 1 && (
                              <p className="text-xs text-gray-400">Part : {(deal.userShare * 100).toFixed(0)}%</p>
                            )}
                          </td>
                          <td className="py-3 px-2">
                            {deal.clientName
                              ? <p className="text-gray-700 text-sm max-w-[150px] truncate">{deal.clientName}</p>
                              : <span className="text-gray-300 text-xs">—</span>}
                          </td>
                          <td className="py-3 px-2 text-right text-gray-600">{formatEur(deal.amount * deal.userShare)}</td>
                          <td className="py-3 px-2 text-right font-semibold text-gray-300">{formatEur(0)}</td>
                          <td className="py-3 px-2 text-gray-400 text-xs italic">Pas de règle de commission</td>
                          <td className="py-3 px-2">
                            <Badge variant="gray">Vente enregistrée</Badge>
                          </td>
                          <td className="py-3 px-2 text-xs whitespace-nowrap">
                            <p className="text-gray-400">
                              <span className="text-gray-500 font-medium">Signé </span>
                              {deal.closedAt
                                ? format(new Date(deal.closedAt), 'dd MMM yyyy', { locale: fr })
                                : '—'}
                            </p>
                          </td>
                          <td className="py-3 px-2" />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        })()}
      </Card>
      </div>

      {/* ====== Section Objectifs ====== */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">Mes objectifs</h2>
          {sortedObjectives.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-primary-100 text-primary-700">{sortedObjectives.length}</span>
          )}
        </div>
          {sortedObjectives.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <svg className="w-14 h-14 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <p className="font-medium text-gray-500">Aucun objectif défini</p>
              <p className="text-sm mt-1">Votre manager peut vous assigner des objectifs depuis son espace</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {sortedObjectives.map((obj) => (
                <ObjectiveProgressCard key={obj.id} obj={obj} wonDeals={wonDeals} pendingCommissionCount={pendingCommissionCount} />
              ))}
            </div>
          )}
      </div>

      {/* ====== Section Concours ====== */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-gray-900">Concours en cours</h2>
          {contests.length > 0 && (
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">{contests.length}</span>
          )}
        </div>
          {contestsError ? (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <p className="text-sm font-semibold text-red-700 mb-1">Erreur lors du chargement des concours</p>
              <p className="text-xs text-red-600 font-mono">{contestsError}</p>
            </div>
          ) : contests.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <svg className="w-14 h-14 mx-auto mb-4 opacity-30" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
              </svg>
              <p className="font-medium text-gray-500">Aucun concours en cours</p>
              <p className="text-sm mt-1">Les concours lancés par votre manager apparaîtront ici</p>
            </div>
          ) : (
            contests.map((contest) => {
              const raw = leaderboards[contest.id];
              const isAnonymous = raw && !Array.isArray(raw) && 'anonymous' in raw;
              const board = Array.isArray(raw) ? raw : [];
              const anonData = isAnonymous ? (raw as AnonymousLeaderboardResult & { anonymous: true }) : null;
              const myEntry = !isAnonymous && user ? board.find((e) => e.user.id === user.id) : null;
              return (
                <div key={contest.id} className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-2xl border border-amber-200 p-5">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center flex-shrink-0">
                        <span className="text-xl">🏆</span>
                      </div>
                      <div>
                        <p className="font-bold text-gray-900">{contest.name}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {contestMetricLabel(contest.metric)}
                          {' · '}jusqu'au {format(new Date(contest.periodEnd), 'dd MMM yyyy', { locale: fr })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-amber-600 font-medium">Lot en jeu</p>
                      <p className="text-sm font-bold text-amber-800">🎁 {contest.prize}</p>
                    </div>
                  </div>

                  {/* ── Classement anonyme ── */}
                  {anonData && (
                    <div className="space-y-3">
                      <div className={`px-4 py-3 rounded-xl flex items-center justify-between ${anonData.myRank === 1 ? 'bg-yellow-100 border border-yellow-300' : 'bg-white border border-amber-200'}`}>
                        <div className="flex items-center gap-3">
                          <span className="text-2xl font-bold">
                            {anonData.myRank === 1 ? '🥇' : anonData.myRank === 2 ? '🥈' : anonData.myRank === 3 ? '🥉' : `#${anonData.myRank}`}
                          </span>
                          <div>
                            <p className="text-sm font-semibold text-gray-800">Ma position</p>
                            <p className="text-xs text-gray-500">
                              {anonData.myRank === 1 ? 'En tête !' : `${anonData.myRank}${anonData.myRank === 1 ? 'er' : 'ème'} sur ${anonData.totalParticipants} participants`}
                            </p>
                          </div>
                        </div>
                        <span className="text-lg font-bold text-gray-900">
                          {formatContestValue(contest.metric, anonData.myScore)}
                        </span>
                      </div>

                      {/* Jauge de progression vers le 1er */}
                      {anonData.leaderScore > 0 && (
                        <div className="bg-white/80 rounded-xl px-4 py-3 border border-amber-100">
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-xs font-medium text-gray-500">Progression vers le 1er</p>
                            <p className="text-xs font-semibold text-amber-700">
                              {Math.round((anonData.myScore / anonData.leaderScore) * 100)}%
                            </p>
                          </div>
                          <div className="h-2.5 bg-amber-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-gradient-to-r from-amber-400 to-orange-500 rounded-full transition-all duration-500"
                              style={{ width: `${Math.min(100, Math.round((anonData.myScore / anonData.leaderScore) * 100))}%` }}
                            />
                          </div>
                          <p className="text-xs text-gray-400 mt-1.5">
                            Score du 1er : {formatContestValue(contest.metric, anonData.leaderScore)}
                          </p>
                        </div>
                      )}

                      <p className="text-xs text-amber-600/70 text-center italic">Classement anonyme — seule votre position est visible</p>
                    </div>
                  )}

                  {/* ── Classement normal ── */}
                  {!isAnonymous && myEntry && (
                    <div className={`mb-3 px-4 py-3 rounded-xl flex items-center justify-between ${myEntry.rank === 1 ? 'bg-yellow-100 border border-yellow-300' : 'bg-white border border-amber-200'}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold">
                          {myEntry.rank === 1 ? '🥇' : myEntry.rank === 2 ? '🥈' : myEntry.rank === 3 ? '🥉' : `#${myEntry.rank}`}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">Ma position</p>
                          <p className="text-xs text-gray-500">
                            {myEntry.rank === 1
                              ? 'En tête !'
                              : `${myEntry.rank}${myEntry.rank === 1 ? 'er' : 'e'} sur ${board.length}`
                            }
                          </p>
                        </div>
                      </div>
                      <span className="text-lg font-bold text-gray-900">
                        {formatContestValue(contest.metric, myEntry.value)}
                      </span>
                    </div>
                  )}

                  {!isAnonymous && board.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                        Classement ({board.length} participant{board.length > 1 ? 's' : ''})
                      </p>
                      {board.map((entry) => {
                        const isMe = user && entry.user.id === user.id;
                        const rankIcon = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : null;
                        return (
                          <div key={entry.user.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${
                            isMe
                              ? 'bg-primary-50 border border-primary-200'
                              : entry.rank <= 3
                                ? 'bg-white/70'
                                : 'bg-white/40'
                          }`}>
                            <span className="w-7 text-center font-bold text-sm flex-shrink-0">
                              {rankIcon ?? <span className="text-gray-400">#{entry.rank}</span>}
                            </span>
                            <p className={`flex-1 text-sm truncate ${isMe ? 'font-bold text-primary-700' : 'text-gray-700'}`}>
                              {entry.user.firstName} {entry.user.lastName}{isMe ? ' (moi)' : ''}
                            </p>
                            <span className={`text-sm font-semibold flex-shrink-0 ${entry.value > 0 ? 'text-gray-800' : 'text-gray-400'}`}>
                              {entry.value > 0 ? formatContestValue(contest.metric, entry.value) : '—'}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {!isAnonymous && board.length === 0 && (
                    <p className="text-sm text-amber-700 text-center py-2">Aucun participant pour le moment</p>
                  )}

                  {/* Chantier 4.2 + 4.3 — Lien projections + tooltip */}
                  <div className="mt-3 pt-3 border-t border-amber-200/60 flex items-center justify-between">
                    {pendingCommissionCount > 0 && (
                      <a
                        href="/dashboard/projections"
                        className="text-xs text-amber-700 hover:text-amber-900"
                      >
                        Inclut des ventes dont la commission est en attente.{' '}
                        <span className="underline">Voir mes projections →</span>
                      </a>
                    )}
                    <span
                      className="text-amber-400 hover:text-amber-600 cursor-help text-xs ml-auto"
                      title="Le score se base sur toutes vos ventes validées (WON dans le CRM), y compris celles dont la commission n'est pas encore versée. Si une vente est annulée par votre manager (paiement client non reçu), elle sera retirée de ce score."
                    >
                      (?)
                    </span>
                  </div>
                </div>
              );
            })
          )}
      </div>

      {disputeModal && (
        <RaiseDisputeModal
          commission={disputeModal}
          onClose={() => setDisputeModal(null)}
          onRaised={() => {
            setDisputeModal(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
