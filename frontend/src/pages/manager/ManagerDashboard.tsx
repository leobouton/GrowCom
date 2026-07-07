import { useEffect, useState } from 'react';
import { commissionApiService } from '../../services/commission.service';
import { dealAssignmentApiService } from '../../services/dealAssignment.service';
import { StatCard, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { TruncatedText } from '../../components/ui/TruncatedText';
import { Badge, CommissionStatusBadge } from '../../components/ui/Badge';
import { DealAssignmentModal } from '../../components/DealAssignmentModal';
import type { CommissionWithDetails, DealAssignment } from '@shared/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

// periodMonth sentinelle (1970-01-01) = commission de deal one-shot
const PERIOD_MONTH_SENTINEL = new Date('1971-01-01').getTime();

/**
 * Date affichée pour une commission :
 * - commission récurrente de mission : le MOIS de rattachement (pas la date du
 *   contrat d'origine, qui peut dater de plusieurs mois) ;
 * - commission de deal : date de vente (closedAt), repli sur la date de calcul.
 */
function commissionSaleDateLabel(commission: CommissionWithDetails): string {
  if (
    commission.missionId &&
    commission.periodMonth &&
    new Date(commission.periodMonth).getTime() > PERIOD_MONTH_SENTINEL
  ) {
    return `🔁 ${format(new Date(commission.periodMonth), 'MMMM yyyy', { locale: fr })}`;
  }
  if (commission.deal.closedAt) {
    return format(new Date(commission.deal.closedAt), 'dd MMM yyyy', { locale: fr });
  }
  return format(new Date(commission.calculatedAt), 'dd MMM yyyy', { locale: fr });
}

// ─── Modal d'annulation ──────────────────────────────────────────────────────
function CancelCommissionModal({
  commission,
  onClose,
  onCancelled,
}: {
  commission: CommissionWithDetails;
  onClose: () => void;
  onCancelled: () => void;
}) {
  const [reason, setReason] = useState('');
  const [cancelDeal, setCancelDeal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (reason.trim().length < 5) {
      setError('Le motif doit contenir au moins 5 caractères.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await commissionApiService.cancel(commission.id, reason.trim(), cancelDeal);
      onCancelled();
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
        <h3 className="text-base font-semibold text-gray-900 mb-1">Annuler la commission</h3>
        <p className="text-sm text-gray-500 mb-4">
          Deal : <span className="font-medium text-gray-800">{commission.deal.title}</span> —{' '}
          <span className="font-medium text-gray-800">
            {commission.user.firstName} {commission.user.lastName}
          </span>
        </p>

        {commission.status === 'PAID' && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800 mb-4">
            Cette commission est déjà payée. Un ajustement négatif sera créé pour compenser le remboursement.
          </div>
        )}

        <label className="block text-sm font-medium text-gray-700 mb-1">
          Motif d'annulation <span className="text-red-500">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
          placeholder="Ex : Deal annulé par le client, erreur de saisie..."
        />

        <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={cancelDeal}
            onChange={(e) => setCancelDeal(e.target.checked)}
            className="rounded border-gray-300 text-red-500 focus:ring-red-400"
          />
          <span className="text-sm text-gray-700">Marquer également le deal comme "Perdu"</span>
        </label>

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex gap-3 justify-end mt-5">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            size="sm"
            variant="danger"
            loading={loading}
            onClick={() => void handleSubmit()}
          >
            Confirmer l'annulation
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de révocation (remettre en attente) ──────────────────────────────
function RevertCommissionModal({
  commission,
  onClose,
  onReverted,
}: {
  commission: CommissionWithDetails;
  onClose: () => void;
  onReverted: () => void;
}) {
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (reason.trim().length < 5) {
      setError('Le motif doit contenir au moins 5 caractères.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await commissionApiService.revertToPending(commission.id, reason.trim());
      onReverted();
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
        <h3 className="text-base font-semibold text-gray-900 mb-1">Révoquer la validation</h3>
        <p className="text-sm text-gray-500 mb-4">
          Deal : <span className="font-medium text-gray-800">{commission.deal.title}</span> —{' '}
          <span className="font-medium text-gray-800">
            {commission.user.firstName} {commission.user.lastName}
          </span>
        </p>

        <div className="bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-xs text-blue-800 mb-4">
          La commission sera remise en attente de validation.
          {commission.status === 'PAID' && (
            <span className="block mt-1 font-medium text-amber-700">
              Cette commission est payée — un ajustement négatif (clawback) sera créé automatiquement.
            </span>
          )}
        </div>

        <label className="block text-sm font-medium text-gray-700 mb-1">
          Motif de la révocation <span className="text-red-500">*</span>
        </label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 resize-none"
          placeholder="Ex : Validation prématurée, montant à corriger, erreur de saisie..."
        />

        {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

        <div className="flex gap-3 justify-end mt-5">
          <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
            Annuler
          </Button>
          <Button
            size="sm"
            loading={loading}
            onClick={() => void handleSubmit()}
          >
            Remettre en attente
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Modal de recherche de commissions traitées ─────────────────────────────
function SearchProcessedModal({
  commissions,
  onClose,
  onRevert,
  onCancel,
}: {
  commissions: CommissionWithDetails[];
  onClose: () => void;
  onRevert: (c: CommissionWithDetails) => void;
  onCancel: (c: CommissionWithDetails) => void;
}) {
  const [search, setSearch] = useState('');

  const query = search.trim().toLowerCase();
  const filtered = query
    ? commissions.filter((c) => {
        const haystack = [
          c.user.firstName,
          c.user.lastName,
          c.deal.title,
          c.deal.clientName,
          c.rule.name,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return haystack.includes(query);
      })
    : commissions;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-base font-semibold text-gray-900">Corriger une commission</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher par commercial, deal, client..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              autoFocus
            />
          </div>
        </div>

        {/* Résultats */}
        <div className="flex-1 overflow-y-auto px-6 py-3">
          {filtered.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <p className="text-sm font-medium">
                {query ? 'Aucun résultat' : 'Aucune commission traitée sur cette période'}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50/50 transition-colors"
                >
                  {/* Infos */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <TruncatedText text={c.deal.title} className="text-sm font-medium text-gray-900" />
                      <CommissionStatusBadge status={c.status} />
                    </div>
                    <p className="text-xs text-gray-500">
                      {c.user.firstName} {c.user.lastName}
                      {c.deal.clientName && <span> — {c.deal.clientName}</span>}
                      <span className="mx-1.5">·</span>
                      <span className="font-medium text-gray-700">{formatEur(c.amount)}</span>
                      <span className="mx-1.5">·</span>
                      {c.paidAt
                        ? format(new Date(c.paidAt), 'dd MMM yyyy', { locale: fr })
                        : c.validatedAt
                          ? format(new Date(c.validatedAt), 'dd MMM yyyy', { locale: fr })
                          : '—'}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => onRevert(c)}
                      title="Remettre en attente"
                    >
                      <svg className="w-3.5 h-3.5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 010 10H9m4-10l-4-4m4 4l-4 4" />
                      </svg>
                      Révoquer
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => onCancel(c)}
                      title="Annuler définitivement"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-gray-100 flex-shrink-0">
          <p className="text-xs text-gray-400">
            {filtered.length} commission{filtered.length > 1 ? 's' : ''} sur la période
          </p>
        </div>
      </div>
    </div>
  );
}

interface Stats {
  totalPendingCommissions: number;
  totalValidatedCommissions: number;
  totalPaidCommissions: number;
  totalDeferredCommissions: number;
  commercialsSummary: Array<{
    user: { id: string; firstName: string; lastName: string; email: string };
    totalRevenue: number;
    dealCount: number;
    totalCommissions: number;
    pendingCount: number;
  }>;
  pendingCommissions: CommissionWithDetails[];
  deferredCommissions: CommissionWithDetails[];
  recentlyProcessedCommissions: CommissionWithDetails[];
}

type PeriodType = 'month' | 'year';

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function getMedalColor(rank: number): string {
  if (rank === 1) return 'text-yellow-500';
  if (rank === 2) return 'text-gray-400';
  if (rank === 3) return 'text-amber-600';
  return 'text-gray-300';
}


export function ManagerDashboard() {
  const now = new Date();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [rankingLoading, setRankingLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Modal d'assignation
  const [assignModal, setAssignModal] = useState<{
    dealId: string;
    dealTitle: string;
    existingAssignments: DealAssignment[];
  } | null>(null);

  // Modal confirmation "Client a payé"
  const [clientPaidConfirm, setClientPaidConfirm] = useState<CommissionWithDetails | null>(null);

  // Modal annulation commission
  const [cancelModal, setCancelModal] = useState<CommissionWithDetails | null>(null);

  // Modal révocation (remettre en attente)
  const [revertModal, setRevertModal] = useState<CommissionWithDetails | null>(null);

  // Modal recherche de commissions traitées
  const [showSearchProcessed, setShowSearchProcessed] = useState(false);

  const [periodType, setPeriodType] = useState<PeriodType>('month');
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1); // 1-indexed

  const yearOptions = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const loadStats = async (opts?: { period: PeriodType; year: number; month: number }) => {
    const period = opts?.period ?? periodType;
    const year = opts?.year ?? selectedYear;
    const month = opts?.month ?? selectedMonth;

    try {
      const data = await commissionApiService.getManagerStats({
        period,
        year,
        ...(period === 'month' ? { month } : {}),
      });
      setStats(data);
    } finally {
      setLoading(false);
      setRankingLoading(false);
    }
  };

  useEffect(() => {
    void loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePeriodChange = (type: PeriodType) => {
    setPeriodType(type);
    setRankingLoading(true);
    void loadStats({ period: type, year: selectedYear, month: selectedMonth });
  };

  const handleYearChange = (year: number) => {
    setSelectedYear(year);
    setRankingLoading(true);
    void loadStats({ period: periodType, year, month: selectedMonth });
  };

  const handleMonthChange = (month: number) => {
    setSelectedMonth(month);
    setRankingLoading(true);
    void loadStats({ period: periodType, year: selectedYear, month });
  };

  const handleValidate = async (id: string) => {
    setActionLoading(id);
    setActionError(null);
    try {
      await commissionApiService.validate(id);
      await loadStats();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setActionError(e?.response?.data?.message ?? 'Erreur lors de la validation. Vérifiez que la migration SQL a bien été exécutée dans Supabase.');
    } finally {
      setActionLoading(null);
    }
  };

  const handlePay = async (id: string) => {
    setActionLoading(id);
    setActionError(null);
    try {
      await commissionApiService.markAsPaid(id);
      await loadStats();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setActionError(e?.response?.data?.message ?? 'Erreur lors du paiement.');
    } finally {
      setActionLoading(null);
    }
  };

  const handleClientPaid = async (id: string) => {
    setActionLoading(id);
    setActionError(null);
    try {
      await commissionApiService.markClientPaid(id);
      await loadStats();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setActionError(e?.response?.data?.message ?? 'Erreur lors de la confirmation du paiement client.');
    } finally {
      setActionLoading(null);
      setClientPaidConfirm(null);
    }
  };

  const handleOpenAssignModal = async (commission: CommissionWithDetails) => {
    const assignments = await dealAssignmentApiService.getByDealId(commission.dealId);
    setAssignModal({
      dealId: commission.dealId,
      dealTitle: commission.deal.title,
      existingAssignments: assignments,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Tableau de bord</h1>
        <p className="text-gray-500 mt-1">Vue d'ensemble des commissions de votre équipe</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="En attente de validation"
          value={formatEur(stats?.totalPendingCommissions ?? 0)}
          color="yellow"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title="Paiements différés"
          value={formatEur(stats?.totalDeferredCommissions ?? 0)}
          color="yellow"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <StatCard
          title="Payées ce mois"
          value={formatEur(stats?.totalPaidCommissions ?? 0)}
          color="green"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          }
        />
      </div>

      {/* Classement des meilleurs vendeurs */}
      <Card>
        {/* En-tête du tableau avec sélecteur de période */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
          <h2 className="text-base font-semibold text-gray-900">Meilleurs vendeurs</h2>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Toggle Mois / Année */}
            <div className="flex rounded-lg border border-gray-200 overflow-hidden">
              <button
                onClick={() => handlePeriodChange('month')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                  periodType === 'month'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Mois
              </button>
              <button
                onClick={() => handlePeriodChange('year')}
                className={`px-3 py-1.5 text-sm font-medium transition-colors border-l border-gray-200 ${
                  periodType === 'year'
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                Année
              </button>
            </div>

            {/* Sélecteur de mois (visible uniquement en mode "mois") */}
            {periodType === 'month' && (
              <select
                value={selectedMonth}
                onChange={(e) => handleMonthChange(parseInt(e.target.value, 10))}
                className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
              >
                {MONTHS.map((name, i) => (
                  <option key={i + 1} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
            )}

            {/* Sélecteur d'année */}
            <select
              value={selectedYear}
              onChange={(e) => handleYearChange(parseInt(e.target.value, 10))}
              className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
            >
              {yearOptions.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Tableau */}
        {rankingLoading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : !stats?.commercialsSummary?.length ? (
          <div className="text-center py-10 text-gray-400">
            <p className="font-medium">Aucune donnée pour cette période</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 font-medium text-gray-500 w-10">#</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Commercial</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">CA</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Deals</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Commissions</th>
                </tr>
              </thead>
              <tbody>
                {stats.commercialsSummary.map((item, index) => {
                  const rank = index + 1;
                  return (
                    <tr key={item.user.id} className="border-b border-gray-50 last:border-0">
                      <td className="py-3 px-2">
                        <span className={`font-bold text-base ${getMedalColor(rank)}`}>
                          {rank <= 3 ? (
                            <svg className={`w-5 h-5 ${getMedalColor(rank)}`} fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 14a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" clipRule="evenodd" />
                            </svg>
                          ) : (
                            <span className="text-gray-400 text-sm">{rank}</span>
                          )}
                        </span>
                      </td>
                      <td className="py-3 px-2">
                        <div>
                          <p className="font-medium text-gray-900">
                            {item.user.firstName} {item.user.lastName}
                          </p>
                          <p className="text-xs text-gray-400">{item.user.email}</p>
                        </div>
                      </td>
                      <td className="py-3 px-2 text-right font-semibold text-gray-900">
                        {formatEur(item.totalRevenue)}
                      </td>
                      <td className="py-3 px-2 text-right text-gray-600">
                        {item.dealCount > 0 ? item.dealCount : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {item.totalCommissions > 0 ? (
                          <span className="text-gray-700">{formatEur(item.totalCommissions)}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Commissions différées */}
      {(stats?.deferredCommissions?.length ?? 0) > 0 && (
        <Card>
          <h2 className="text-base font-semibold text-gray-900 mb-1 flex items-center gap-2">
            <svg className="w-4 h-4 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Ventes gagnées — paiement différé
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
              {stats!.deferredCommissions.length}
            </span>
          </h2>
          <p className="text-xs text-gray-400 mb-4">
            Ces commissions seront validées automatiquement à leur date de paiement prévue.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Commercial</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Deal</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Client</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Commission</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Date de vente</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Paiement prevu</th>
                </tr>
              </thead>
              <tbody>
                {stats!.deferredCommissions.map((commission) => (
                  <tr key={commission.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2 font-medium text-gray-900">
                      {commission.user.firstName} {commission.user.lastName}
                    </td>
                    <td className="py-3 px-2 max-w-xs">
                      <TruncatedText text={commission.deal.title} className="text-gray-600" />
                    </td>
                    <td className="py-3 px-2 max-w-xs">
                      <TruncatedText text={commission.deal.clientName || '—'} className="text-gray-600" />
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900">
                      {formatEur(commission.amount)}
                    </td>
                    <td className="py-3 px-2 text-xs text-gray-500 whitespace-nowrap">
                      {commissionSaleDateLabel(commission)}
                    </td>
                    <td className="py-3 px-2">
                      <span className="inline-flex items-center gap-1.5 text-orange-700 font-medium">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                        {commission.scheduledPaymentAt
                          ? format(new Date(commission.scheduledPaymentAt), 'dd MMM yyyy', { locale: fr })
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

      {/* Erreur action commission */}
      {actionError && (
        <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-start gap-2">
          <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{actionError}</span>
          <button onClick={() => setActionError(null)} className="ml-auto text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {/* Commissions en attente de validation */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900 flex items-center gap-2">
            Commissions en attente de validation
            {stats?.pendingCommissions?.length ? (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
                {stats.pendingCommissions.length}
              </span>
            ) : null}
          </h2>
          {(stats?.recentlyProcessedCommissions?.length ?? 0) > 0 && (
            <button
              onClick={() => setShowSearchProcessed(true)}
              className="flex items-center gap-1.5 text-xs font-medium text-amber-700 hover:text-amber-900 bg-amber-50 hover:bg-amber-100 px-3 py-1.5 rounded-lg border border-amber-200 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a5 5 0 010 10H9m4-10l-4-4m4 4l-4 4" />
              </svg>
              Corriger une commission
            </button>
          )}
        </div>

        {!stats?.pendingCommissions?.length ? (
          <div className="text-center py-10 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium">Tout est à jour !</p>
            <p className="text-sm mt-1">Aucune commission en attente de validation.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Commercial</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Deal</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Client</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Montant</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Date de vente</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Validation</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Statut</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {stats.pendingCommissions.map((commission) => (
                  <tr key={commission.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2 font-medium text-gray-900">
                      {commission.user.firstName} {commission.user.lastName}
                    </td>
                    <td className="py-3 px-2 max-w-xs">
                      <TruncatedText text={commission.deal.title} className="text-gray-600" />
                    </td>
                    <td className="py-3 px-2 max-w-xs">
                      <TruncatedText text={commission.deal.clientName || '—'} className="text-gray-600" />
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900">
                      {formatEur(commission.amount)}
                    </td>
                    <td className="py-3 px-2 text-xs text-gray-500 whitespace-nowrap">
                      {commissionSaleDateLabel(commission)}
                    </td>
                    <td className="py-3 px-2 text-xs whitespace-nowrap">
                      {commission.validatedAt ? (
                        <span className="text-green-600">{format(new Date(commission.validatedAt), 'dd MMM yyyy', { locale: fr })}</span>
                      ) : commission.clientPaidAt ? (
                        <span className="text-blue-600">{format(new Date(commission.clientPaidAt), 'dd MMM yyyy', { locale: fr })}</span>
                      ) : (
                        <span className="text-gray-400">En attente</span>
                      )}
                    </td>
                    <td className="py-3 px-2">
                      {commission.awaitingClientPayment
                        ? <Badge variant="orange">En attente paiement client</Badge>
                        : <CommissionStatusBadge status={commission.status} scheduledPaymentAt={commission.scheduledPaymentAt} />
                      }
                    </td>
                    <td className="py-3 px-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleOpenAssignModal(commission)}
                          title="Modifier l'affectation"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                        </Button>
                        {commission.awaitingClientPayment && (
                          <Button
                            size="sm"
                            loading={actionLoading === commission.id}
                            onClick={() => setClientPaidConfirm(commission)}
                          >
                            Client a payé
                          </Button>
                        )}
                        {!commission.awaitingClientPayment && commission.status === 'PENDING' && (
                          <Button
                            size="sm"
                            loading={actionLoading === commission.id}
                            onClick={() => void handleValidate(commission.id)}
                          >
                            Valider
                          </Button>
                        )}
                        {!commission.awaitingClientPayment && commission.status === 'VALIDATED' && (
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={actionLoading === commission.id}
                            onClick={() => void handlePay(commission.id)}
                          >
                            Marquer payé
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => setCancelModal(commission)}
                          title="Annuler la commission"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Modal recherche de commissions traitées */}
      {showSearchProcessed && stats?.recentlyProcessedCommissions && (
        <SearchProcessedModal
          commissions={stats.recentlyProcessedCommissions}
          onClose={() => setShowSearchProcessed(false)}
          onRevert={(c) => {
            setShowSearchProcessed(false);
            setRevertModal(c);
          }}
          onCancel={(c) => {
            setShowSearchProcessed(false);
            setCancelModal(c);
          }}
        />
      )}

      {/* Modal annulation commission */}
      {cancelModal && (
        <CancelCommissionModal
          commission={cancelModal}
          onClose={() => setCancelModal(null)}
          onCancelled={() => {
            setCancelModal(null);
            void loadStats();
          }}
        />
      )}

      {/* Modal révocation commission */}
      {revertModal && (
        <RevertCommissionModal
          commission={revertModal}
          onClose={() => setRevertModal(null)}
          onReverted={() => {
            setRevertModal(null);
            void loadStats();
          }}
        />
      )}

      {/* Modal modification affectation */}
      {assignModal && (
        <DealAssignmentModal
          dealId={assignModal.dealId}
          dealTitle={assignModal.dealTitle}
          existingAssignments={assignModal.existingAssignments}
          onClose={() => setAssignModal(null)}
          onSaved={() => {
            setAssignModal(null);
            void loadStats();
          }}
        />
      )}

      {/* Modal confirmation "Client a payé" */}
      {clientPaidConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-2">Confirmer le paiement client</h3>
            <p className="text-sm text-gray-600 mb-5">
              Confirmer que le client a payé la prestation pour{' '}
              <span className="font-medium text-gray-900">"{clientPaidConfirm.deal.title}"</span> ?
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="secondary" size="sm" onClick={() => setClientPaidConfirm(null)}>
                Annuler
              </Button>
              <Button
                size="sm"
                loading={actionLoading === clientPaidConfirm.id}
                onClick={() => void handleClientPaid(clientPaidConfirm.id)}
              >
                Confirmer
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
