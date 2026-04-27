import { useEffect, useState } from 'react';
import { commissionApiService } from '../../services/commission.service';
import { authApiService } from '../../services/auth.service';
import { contestApiService } from '../../services/contest.service';
import { Card } from '../../components/ui/Card';
import { CommissionStatusBadge } from '../../components/ui/Badge';
import type { CommissionWithDetails, Objective, PublicUser, Contest, ContestLeaderboardEntry } from '@shared/types';
import { ContestMetric } from '@shared/types';
import { format, isWithinInterval, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

interface WonDealSummary {
  id: string;
  title: string;
  amount: number;
  closedAt: string | null;
  syncedAt: string | null;
}

interface DashboardData {
  fixedSalary: number;
  totalMonthRevenue: number;
  totalEarnedThisMonth: number;
  totalPendingValidation: number;
  projectedCommissions: number;
  commissions: CommissionWithDetails[];
  wonDeals: WonDealSummary[];
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

/** Retourne [début, fin] de la période d'un objectif */
function getObjectiveDateRange(obj: Objective): [Date, Date] | null {
  const y = obj.year ?? new Date().getFullYear();

  if (obj.periodType === 'monthly') {
    const month = (obj.month ?? 1) - 1;
    const d = new Date(y, month, 1);
    return [startOfMonth(d), endOfMonth(d)];
  }
  if (obj.periodType === 'quarterly') {
    const q = obj.quarter ?? 1;
    const monthStart = (q - 1) * 3;
    const d = new Date(y, monthStart, 1);
    return [startOfQuarter(d), endOfQuarter(d)];
  }
  if (obj.periodType === 'annual') {
    return [startOfYear(new Date(y, 0, 1)), endOfYear(new Date(y, 0, 1))];
  }
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    return [parseISO(obj.startDate), parseISO(obj.endDate)];
  }
  return null;
}

/** Calcule la valeur actuelle d'un objectif depuis les deals WON (CA réel).
 *  On tente d'abord un filtrage par période (closedAt du deal).
 *  Si aucun deal ne correspond (date absente ou hors période),
 *  on affiche tous les deals WON : l'objectif est une CIBLE globale du commercial,
 *  pas un filtre calendaire strict (le concours joue ce rôle). */
function computeProgress(obj: Objective, wonDeals: WonDealSummary[]): number {
  if (wonDeals.length === 0) return 0;

  const range = getObjectiveDateRange(obj);

  if (range) {
    const [start, end] = range;
    const filtered = wonDeals.filter((d) => {
      const dateStr = d.closedAt ?? d.syncedAt;
      if (!dateStr) return true; // pas de date → compté partout
      return isWithinInterval(new Date(dateStr), { start, end });
    });
    // Si au moins un deal a une date dans la période, on filtre strictement
    if (filtered.length > 0) {
      if (obj.unit === 'deals') return filtered.length;
      return filtered.reduce((sum, d) => sum + d.amount, 0);
    }
  }

  // Fallback : aucun deal avec une date dans la période → tous les deals WON
  if (obj.unit === 'deals') return wonDeals.length;
  return wonDeals.reduce((sum, d) => sum + d.amount, 0);
}

/** Calcule la prime gagnée si l'objectif est dépassé */
function computeBonus(obj: Objective, current: number): number {
  if (!obj.bonus?.enabled || current <= obj.target) return 0;
  const excess = current - obj.target;
  if (obj.bonus.type === 'percentage') return excess * (obj.bonus.value / 100);
  return obj.bonus.value; // montant fixe
}

/** Libellé lisible de la période */
const MONTHS_FR = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Jun', 'Jul', 'Aoû', 'Sep', 'Oct', 'Nov', 'Déc'];

function formatObjectivePeriod(obj: Objective): string {
  const y = obj.year ?? new Date().getFullYear();
  if (obj.periodType === 'monthly') return `${MONTHS_FR[(obj.month ?? 1) - 1]} ${y}`;
  if (obj.periodType === 'quarterly') return `T${obj.quarter ?? 1} ${y}`;
  if (obj.periodType === 'annual') return `Année ${y}`;
  if (obj.periodType === 'custom' && obj.startDate && obj.endDate) {
    return `${format(parseISO(obj.startDate), 'dd/MM/yy')} → ${format(parseISO(obj.endDate), 'dd/MM/yy')}`;
  }
  return 'Période perso.';
}

/** Indique si l'objectif est en cours (la période couvre aujourd'hui) */
function isObjectiveCurrent(obj: Objective): boolean {
  const range = getObjectiveDateRange(obj);
  if (!range) return false;
  return isWithinInterval(new Date(), { start: range[0], end: range[1] });
}

/** Indique si l'objectif est dans le futur */
function isObjectiveFuture(obj: Objective): boolean {
  const range = getObjectiveDateRange(obj);
  if (!range) return false;
  return new Date() < range[0];
}

// ============================================================
// Composant barre de progression d'un objectif
// ============================================================
function ObjectiveProgressCard({ obj, wonDeals }: { obj: Objective; wonDeals: WonDealSummary[] }) {
  const current = computeProgress(obj, wonDeals);
  const pct = Math.min(100, obj.target > 0 ? (current / obj.target) * 100 : 0);
  const isCurrent = isObjectiveCurrent(obj);
  const isFuture = isObjectiveFuture(obj);
  const isDone = pct >= 100;
  const bonusEarned = computeBonus(obj, current);
  const hasBonusRule = obj.bonus?.enabled;

  const formatValue = (v: number) => {
    if (obj.unit === '€') return formatEur(v);
    if (obj.unit === '%') return `${v.toFixed(1)} %`;
    return `${v} deal${v > 1 ? 's' : ''}`;
  };

  const barColor = isDone ? 'bg-green-500' : isCurrent ? 'bg-primary-500' : isFuture ? 'bg-gray-300' : 'bg-gray-400';
  const badgeLabel = isDone ? 'Atteint !' : isCurrent ? 'En cours' : isFuture ? 'À venir' : 'Terminé';
  const badgeColor = isDone ? 'bg-green-100 text-green-700' : isCurrent ? 'bg-primary-100 text-primary-700' : isFuture ? 'bg-gray-100 text-gray-500' : 'bg-gray-100 text-gray-400';

  return (
    <div className={`bg-white rounded-xl border p-5 space-y-3 ${isDone && hasBonusRule ? 'border-green-300 ring-1 ring-green-200' : 'border-gray-200'}`}>
      {/* En-tête */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-gray-900 text-sm">{obj.label || 'Objectif'}</p>
          <p className="text-xs text-gray-400 mt-0.5">{formatObjectivePeriod(obj)}</p>
        </div>
        <span className={`text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap ${badgeColor}`}>{badgeLabel}</span>
      </div>

      {/* Barre de progression */}
      <div>
        <div className="flex justify-between items-baseline mb-1.5">
          <span className="text-lg font-bold text-gray-900">{formatValue(current)}</span>
          <span className="text-xs text-gray-400">sur {formatValue(obj.target)}</span>
        </div>
        <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
          <div className={`h-2.5 rounded-full transition-all duration-500 ${barColor}`} style={{ width: `${pct}%` }} />
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-xs text-gray-400">{pct.toFixed(0)} % atteint</span>
          {!isDone && isCurrent && obj.target > 0 && (
            <span className="text-xs text-gray-400">{formatValue(Math.max(0, obj.target - current))} restant</span>
          )}
        </div>
      </div>

      {/* Prime */}
      {hasBonusRule && (
        <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${bonusEarned > 0 ? 'bg-green-50 border border-green-200' : 'bg-amber-50 border border-amber-200'}`}>
          <div className="flex items-center gap-2">
            <span className="text-base">{bonusEarned > 0 ? '🎉' : '🎯'}</span>
            <div>
              <p className="text-xs font-semibold text-gray-700">
                {bonusEarned > 0 ? 'Prime gagnée !' : 'Prime de dépassement'}
              </p>
              <p className="text-xs text-gray-500">
                {obj.bonus!.type === 'percentage'
                  ? `${obj.bonus!.value} % des ventes au-dessus de la cible`
                  : `${formatEur(obj.bonus!.value)} dès l'objectif atteint`}
              </p>
            </div>
          </div>
          <span className={`text-sm font-bold ${bonusEarned > 0 ? 'text-green-600' : 'text-amber-600'}`}>
            {bonusEarned > 0 ? `+${formatEur(bonusEarned)}` : `jusqu'à +${formatEur(obj.bonus!.type === 'fixed' ? obj.bonus!.value : 0)}`}
          </span>
        </div>
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
  const [contests, setContests] = useState<Contest[]>([]);
  const [leaderboards, setLeaderboards] = useState<Record<string, ContestLeaderboardEntry[]>>({});

  useEffect(() => {
    const load = async () => {
      try {
        const [stats, me, activeContests] = await Promise.all([
          commissionApiService.getCommercialStats(),
          authApiService.me(),
          contestApiService.getAll().catch(() => [] as Contest[]),
        ]);
        setData(stats as unknown as DashboardData);
        setUser(me);
        setContests(activeContests);

        // Charger les classements en parallèle
        if (activeContests.length > 0) {
          const entries = await Promise.all(
            activeContests.map((c) =>
              contestApiService.getLeaderboard(c.id).catch(() => [] as ContestLeaderboardEntry[]),
            ),
          );
          const map: Record<string, ContestLeaderboardEntry[]> = {};
          activeContests.forEach((c, i) => { map[c.id] = entries[i]; });
          setLeaderboards(map);
        }
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  const fixedSalary = data?.fixedSalary ?? 0;
  const commissions = data?.totalEarnedThisMonth ?? 0;
  const total = data?.totalMonthRevenue ?? 0;
  const allCommissions = data?.commissions ?? [];
  const wonDeals = data?.wonDeals ?? [];
  const objectives: Objective[] = Array.isArray(user?.objectives) ? (user!.objectives as Objective[]) : [];

  // Trier : en cours d'abord, puis à venir, puis passés
  const sortedObjectives = [...objectives].sort((a, b) => {
    const aScore = isObjectiveCurrent(a) ? 0 : isObjectiveFuture(a) ? 1 : 2;
    const bScore = isObjectiveCurrent(b) ? 0 : isObjectiveFuture(b) ? 1 : 2;
    return aScore - bScore;
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mes revenus</h1>
        <p className="text-gray-500 mt-1">Votre rémunération complète en temps réel</p>
      </div>

      {/* Carte héro — Revenu total du mois */}
      <div className="bg-gradient-to-br from-primary-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg">
        <p className="text-primary-200 text-sm font-medium mb-1">Revenu total estimé ce mois</p>
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
        </div>
      </div>

      {/* Stats secondaires */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-yellow-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">En attente de validation</p>
            <p className="text-xl font-bold text-gray-900">{formatEur(data?.totalPendingValidation ?? 0)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Sera ajouté une fois validé par votre manager</p>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Commissions projetées</p>
            <p className="text-xl font-bold text-gray-900">{formatEur(data?.projectedCommissions ?? 0)}</p>
            <p className="text-xs text-gray-400 mt-0.5">Si tous vos deals en cours sont gagnés</p>
          </div>
        </div>
      </div>

      {/* ====== Section Concours ====== */}
      {contests.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
            </svg>
            Concours en cours
          </h2>
          <div className="space-y-4">
            {contests.map((contest) => {
              const board = leaderboards[contest.id] ?? [];
              const myEntry = user ? board.find((e) => e.user.id === user.id) : null;
              const top3 = board.slice(0, 3);
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
                          {contest.metric === ContestMetric.REVENUE ? 'CA réalisé' : 'Deals signés'}
                          {' · '}jusqu'au {format(new Date(contest.periodEnd), 'dd MMM yyyy', { locale: fr })}
                        </p>
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-amber-600 font-medium">Lot en jeu</p>
                      <p className="text-sm font-bold text-amber-800">🎁 {contest.prize}</p>
                    </div>
                  </div>

                  {/* Ma position */}
                  {myEntry && (
                    <div className={`mb-3 px-4 py-3 rounded-xl flex items-center justify-between ${myEntry.rank === 1 ? 'bg-yellow-100 border border-yellow-300' : 'bg-white border border-amber-200'}`}>
                      <div className="flex items-center gap-3">
                        <span className="text-2xl font-bold">
                          {myEntry.rank === 1 ? '🥇' : myEntry.rank === 2 ? '🥈' : myEntry.rank === 3 ? '🥉' : `#${myEntry.rank}`}
                        </span>
                        <div>
                          <p className="text-sm font-semibold text-gray-800">Ma position</p>
                          <p className="text-xs text-gray-500">{myEntry.rank === 1 ? 'En tête !' : `${myEntry.rank}${myEntry.rank > 1 ? 'ème' : 'er'} sur ${board.length}`}</p>
                        </div>
                      </div>
                      <span className="text-lg font-bold text-gray-900">
                        {contest.metric === ContestMetric.REVENUE
                          ? formatEur(myEntry.value)
                          : `${myEntry.value} deal${myEntry.value > 1 ? 's' : ''}`}
                      </span>
                    </div>
                  )}

                  {/* Podium */}
                  {top3.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Classement</p>
                      {top3.map((entry) => {
                        const isMe = user && entry.user.id === user.id;
                        return (
                          <div key={entry.user.id} className={`flex items-center gap-3 px-3 py-2 rounded-lg ${isMe ? 'bg-primary-50 border border-primary-200' : 'bg-white/70'}`}>
                            <span className="w-6 text-center font-bold text-sm">
                              {entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : '🥉'}
                            </span>
                            <p className={`flex-1 text-sm ${isMe ? 'font-bold text-primary-700' : 'text-gray-700'}`}>
                              {entry.user.firstName} {entry.user.lastName}
                              {isMe && ' (moi)'}
                            </p>
                            <span className="text-sm font-semibold text-gray-800">
                              {contest.metric === ContestMetric.REVENUE
                                ? formatEur(entry.value)
                                : `${entry.value} deal${entry.value > 1 ? 's' : ''}`}
                            </span>
                          </div>
                        );
                      })}
                      {board.length > 3 && (
                        <p className="text-xs text-gray-400 text-center pt-1">{board.length - 3} autre{board.length - 3 > 1 ? 's' : ''} participant{board.length - 3 > 1 ? 's' : ''}</p>
                      )}
                    </div>
                  )}

                  {board.length === 0 && (
                    <p className="text-sm text-amber-700 text-center py-2">Aucune donnée encore — le classement apparaîtra au fil des deals gagnés</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ====== Section Objectifs ====== */}
      {sortedObjectives.length > 0 && (
        <div>
          <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            Mes objectifs
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sortedObjectives.map((obj) => (
              <ObjectiveProgressCard
                key={obj.id}
                obj={obj}
                wonDeals={wonDeals}
              />
            ))}
          </div>
        </div>
      )}

      {/* Historique des commissions */}
      <Card>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Détail de mes commissions</h2>

        {!allCommissions.length ? (
          <div className="text-center py-10 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="font-medium">Aucune commission pour l'instant</p>
            <p className="text-sm mt-1">Vos commissions apparaîtront ici une fois que vos deals seront synchronisés</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Deal</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Client</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Montant deal</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Commission</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Détail calcul</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Statut</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Date</th>
                </tr>
              </thead>
              <tbody>
                {allCommissions.map((commission) => (
                  <tr key={commission.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2">
                      <p className="font-medium text-gray-900 max-w-[180px] truncate">{commission.deal.title}</p>
                    </td>
                    <td className="py-3 px-2">
                      {commission.deal.clientName
                        ? <p className="text-gray-700 text-sm max-w-[150px] truncate">{commission.deal.clientName}</p>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-600">{formatEur(commission.deal.amount)}</td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900">{formatEur(commission.amount)}</td>
                    <td className="py-3 px-2 text-gray-500 text-xs max-w-[200px]">
                      {commission.calculationDetail ?? commission.rule.name}
                    </td>
                    <td className="py-3 px-2"><CommissionStatusBadge status={commission.status} /></td>
                    <td className="py-3 px-2 text-gray-400 text-xs whitespace-nowrap">
                      {format(new Date(commission.calculatedAt), 'dd MMM yyyy', { locale: fr })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
