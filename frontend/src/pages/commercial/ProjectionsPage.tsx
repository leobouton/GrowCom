import { useEffect, useState } from 'react';
import { commissionApiService } from '../../services/commission.service';
import type { ProjectionsData, ProjectionCommission } from '../../services/commission.service';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

type Filter = 'all' | 'awaitingClient' | 'standard';

function StatusBadge({ commission }: { commission: ProjectionCommission }) {
  const now = new Date();

  if (commission.awaitingClientPayment) {
    return (
      <div>
        <Badge variant="orange">En attente paiement client</Badge>
        <p className="text-xs text-gray-400 mt-0.5">Sera versée une fois que le client aura réglé</p>
      </div>
    );
  }

  if (commission.scheduledPaymentAt && new Date(commission.scheduledPaymentAt) > now) {
    return (
      <div>
        <Badge variant="yellow">Versement programmé</Badge>
        <p className="text-xs text-gray-400 mt-0.5">
          Prévu le {format(new Date(commission.scheduledPaymentAt), 'dd MMM yyyy', { locale: fr })}
        </p>
      </div>
    );
  }

  return <Badge variant="yellow">En attente de validation</Badge>;
}

export function ProjectionsPage() {
  const [data, setData] = useState<ProjectionsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    const load = async () => {
      try {
        const result = await commissionApiService.getProjections();
        setData(result);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: { message?: string } } } };
        setError(e?.response?.data?.error?.message ?? 'Impossible de charger les projections');
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="bg-red-50 border border-red-200 rounded-xl px-6 py-4 text-center max-w-md">
          <p className="text-sm font-semibold text-red-700 mb-1">Erreur</p>
          <p className="text-xs text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const filteredCommissions = data.commissions.filter((c) => {
    if (filter === 'awaitingClient') return c.awaitingClientPayment;
    if (filter === 'standard') return !c.awaitingClientPayment;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* En-tete */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mes projections</h1>
        <p className="text-gray-500 mt-1">
          Toutes vos ventes en attente de versement. Elles comptent dans vos objectifs et concours.
        </p>
      </div>

      {/* Carte resume */}
      <div className="bg-gradient-to-br from-primary-50 to-indigo-50 rounded-2xl border border-primary-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-primary-600 font-medium">Total projections</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{formatEur(data.totalAmount)}</p>
            <p className="text-sm text-gray-500 mt-0.5">
              {data.count} commission{data.count > 1 ? 's' : ''} en attente
            </p>
          </div>
          {data.byStatus.awaitingClientPayment.count > 0 && (
            <div className="text-right">
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-100 text-orange-700">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm font-medium">
                  {data.byStatus.awaitingClientPayment.count} en attente paiement client
                </span>
              </div>
              <p className="text-xs text-gray-400 mt-1">
                {formatEur(data.byStatus.awaitingClientPayment.amount)}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Filtres */}
      <div className="flex gap-2">
        {[
          { key: 'all' as Filter, label: 'Tous', count: data.count },
          { key: 'awaitingClient' as Filter, label: 'En attente paiement client', count: data.byStatus.awaitingClientPayment.count },
          { key: 'standard' as Filter, label: 'Validation en cours', count: data.byStatus.standardPending.count },
        ].map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === key
                ? 'bg-primary-100 text-primary-700'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label} ({count})
          </button>
        ))}
      </div>

      {/* Tableau */}
      <Card>
        {filteredCommissions.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="font-medium">Aucune commission en attente</p>
            <p className="text-sm mt-1">Vos ventes gagnées apparaîtront ici en attendant le versement</p>
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
                </tr>
              </thead>
              <tbody>
                {filteredCommissions.map((commission) => (
                  <tr key={commission.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2">
                      <p className="font-medium text-gray-900 max-w-[180px] truncate">{commission.dealTitle}</p>
                    </td>
                    <td className="py-3 px-2">
                      {commission.clientName
                        ? <p className="text-gray-700 text-sm max-w-[150px] truncate">{commission.clientName}</p>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-600">
                      {commission.dealAmount != null ? formatEur(commission.dealAmount) : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900">
                      {formatEur(commission.amount)}
                    </td>
                    <td className="py-3 px-2 text-gray-500 text-xs max-w-[200px]">
                      {commission.calculationDetail || commission.ruleName}
                    </td>
                    <td className="py-3 px-2">
                      <StatusBadge commission={commission} />
                    </td>
                    <td className="py-3 px-2 text-xs whitespace-nowrap">
                      <p className="text-gray-400">
                        <span className="text-gray-500 font-medium">Signé </span>
                        {commission.dealClosedAt
                          ? format(new Date(commission.dealClosedAt), 'dd MMM yyyy', { locale: fr })
                          : '—'}
                      </p>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Explication */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Comprendre les statuts</p>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <Badge variant="yellow">En attente de validation</Badge>
            <p className="text-xs text-gray-600 mt-0.5">
              La commission est en cours de traitement par votre manager.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Badge variant="orange">En attente paiement client</Badge>
            <p className="text-xs text-gray-600 mt-0.5">
              La commission sera versée quand votre manager aura confirmé le paiement du client.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <Badge variant="yellow">Versement programmé</Badge>
            <p className="text-xs text-gray-600 mt-0.5">
              La commission sera automatiquement validée à la date de versement prévue.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
