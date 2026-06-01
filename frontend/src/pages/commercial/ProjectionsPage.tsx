import { useEffect, useState } from 'react';
import { commissionApiService } from '../../services/commission.service';
import type { ProjectionsData, ProjectionCommission } from '../../services/commission.service';
import { Card } from '../../components/ui/Card';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

type Filter = 'all' | 'awaitingClient' | 'standard';

function CommissionBadges({ commission }: { commission: ProjectionCommission }) {
  const now = new Date();

  return (
    <div className="flex flex-wrap gap-1.5">
      {/* Badge vert toujours affiché */}
      <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700">
        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        Vente validée
      </span>

      {/* Badge orange si en attente paiement client */}
      {commission.awaitingClientPayment && (
        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          En attente paiement client
        </span>
      )}

      {/* Date de versement prévu */}
      {!commission.awaitingClientPayment && commission.scheduledPaymentAt && new Date(commission.scheduledPaymentAt) > now && (
        <span className="text-xs text-gray-500">
          Versement prévu le {format(new Date(commission.scheduledPaymentAt), 'dd/MM/yyyy')}
        </span>
      )}

      {/* En cours de validation */}
      {!commission.awaitingClientPayment && !commission.scheduledPaymentAt && (
        <span className="text-xs text-gray-400">En cours de validation</span>
      )}

      {/* Versement en retard */}
      {!commission.awaitingClientPayment && commission.scheduledPaymentAt && new Date(commission.scheduledPaymentAt) <= now && (
        <span className="text-xs text-gray-400">En cours de validation</span>
      )}
    </div>
  );
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
      {/* En-tête */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mes projections</h1>
        <p className="text-gray-500 mt-1">
          Voici toutes vos ventes en attente de versement.
          Elles comptent déjà dans vos objectifs et concours.
        </p>
      </div>

      {/* Carte résumé */}
      <div className="bg-gradient-to-br from-primary-50 to-indigo-50 rounded-2xl border border-primary-200 p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-primary-600 font-medium">Total projections</p>
            <p className="text-3xl font-bold text-gray-900 mt-1">{formatEur(data.totalAmount)}</p>
            <p className="text-sm text-gray-500 mt-0.5">
              Réparti sur {data.count} commission{data.count > 1 ? 's' : ''}
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
          { key: 'standard' as Filter, label: 'Délai en cours', count: data.byStatus.standardPending.count },
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

      {/* Liste des commissions */}
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
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Date</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Montant</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Statut</th>
                </tr>
              </thead>
              <tbody>
                {filteredCommissions.map((commission) => (
                  <tr key={commission.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2">
                      <p className="font-medium text-gray-900 max-w-[200px] truncate">
                        {commission.dealTitle}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{commission.ruleName}</p>
                    </td>
                    <td className="py-3 px-2 text-gray-600 max-w-[150px] truncate">
                      {commission.clientName ?? <span className="text-gray-300">—</span>}
                    </td>
                    <td className="py-3 px-2 text-gray-500 text-xs whitespace-nowrap">
                      {commission.dealClosedAt
                        ? format(new Date(commission.dealClosedAt), 'dd MMM yyyy', { locale: fr })
                        : '—'}
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-gray-900">
                      {formatEur(commission.amount)}
                    </td>
                    <td className="py-3 px-2">
                      <CommissionBadges commission={commission} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Explication des statuts */}
      <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-3">
        <p className="text-sm font-semibold text-gray-700">Comprendre les statuts</p>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-100 text-green-700 flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              Vente validée
            </span>
            <p className="text-xs text-gray-600">
              Votre vente est enregistrée, elle compte dans vos objectifs et concours.
            </p>
          </div>
          <div className="flex items-start gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-orange-100 text-orange-700 flex-shrink-0 mt-0.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              En attente paiement client
            </span>
            <p className="text-xs text-gray-600">
              La commission sera versée quand votre manager aura confirmé le paiement du client.
            </p>
          </div>
        </div>
      </div>

      {/* CTA */}
      <div className="bg-blue-50 rounded-xl border border-blue-200 px-5 py-4 flex items-center gap-3">
        <svg className="w-5 h-5 text-blue-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-sm text-blue-700">
          Une commission tarde à être validée ? Contactez votre manager pour qu'il valide le paiement client.
        </p>
      </div>
    </div>
  );
}
