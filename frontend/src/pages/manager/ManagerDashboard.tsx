import { useEffect, useState } from 'react';
import { commissionApiService } from '../../services/commission.service';
import { dealAssignmentApiService } from '../../services/dealAssignment.service';
import { StatCard, Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge, CommissionStatusBadge } from '../../components/ui/Badge';
import { DealAssignmentModal } from '../../components/DealAssignmentModal';
import type { CommissionWithDetails, DealAssignment } from '@shared/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Stats {
  totalPendingCommissions: number;
  totalValidatedCommissions: number;
  totalPaidCommissions: number;
  totalDeferredCommissions: number;
  commercialsSummary: Array<{
    user: { id: string; firstName: string; lastName: string; email: string };
    totalCommissions: number;
    pendingCount: number;
  }>;
  pendingCommissions: CommissionWithDetails[];
  deferredCommissions: CommissionWithDetails[];
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

  // Modal d'assignation
  const [assignModal, setAssignModal] = useState<{
    dealId: string;
    dealTitle: string;
    existingAssignments: DealAssignment[];
  } | null>(null);

  // Modal confirmation "Client a payé"
  const [clientPaidConfirm, setClientPaidConfirm] = useState<CommissionWithDetails | null>(null);

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
    try {
      await commissionApiService.validate(id);
      await loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handlePay = async (id: string) => {
    setActionLoading(id);
    try {
      await commissionApiService.markAsPaid(id);
      await loadStats();
    } finally {
      setActionLoading(null);
    }
  };

  const handleClientPaid = async (id: string) => {
    setActionLoading(id);
    try {
      await commissionApiService.markClientPaid(id);
      await loadStats();
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
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Commissions</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">En attente</th>
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
                        {formatEur(item.totalCommissions)}
                      </td>
                      <td className="py-3 px-2 text-right">
                        {item.pendingCount > 0 ? (
                          <span className="text-yellow-600 font-medium">{item.pendingCount} en attente</span>
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
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Commission</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Paiement prévu</th>
                </tr>
              </thead>
              <tbody>
                {stats!.deferredCommissions.map((commission) => (
                  <tr key={commission.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2 font-medium text-gray-900">
                      {commission.user.firstName} {commission.user.lastName}
                    </td>
                    <td className="py-3 px-2 text-gray-600 max-w-xs truncate">
                      {commission.deal.title}
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

      {/* Commissions en attente de validation */}
      <Card>
        <h2 className="text-base font-semibold text-gray-900 mb-4">
          Commissions en attente de validation
          {stats?.pendingCommissions?.length ? (
            <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800">
              {stats.pendingCommissions.length}
            </span>
          ) : null}
        </h2>

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
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Montant</th>
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
                    <td className="py-3 px-2 text-gray-600 max-w-xs truncate">
                      {commission.deal.title}
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900">
                      {formatEur(commission.amount)}
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
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
