import { useEffect, useState } from 'react';
import { commissionApiService } from '../../services/commission.service';
import { StatCard, Card } from '../../components/ui/Card';

interface Projection {
  deal: { id: string; title: string; amount: number; probability: number };
  projectedCommission: number;
  explanation: string;
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function ProjectionsPage() {
  const [projections, setProjections] = useState<Projection[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const stats = await commissionApiService.getCommercialStats();
        setProjections(stats.projections);
        setTotal(stats.projectedCommissions);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Mes projections</h1>
        <p className="text-gray-500 mt-1">Commissions estimées sur vos deals en cours</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <StatCard
          title="Commissions projetées (total)"
          value={formatEur(total)}
          subtitle="Si tous vos deals en cours sont gagnés"
          color="indigo"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Deals en cours"
          value={projections.length}
          color="indigo"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
      </div>

      <Card>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Deals en cours et commissions potentielles</h2>

        {projections.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="font-medium">Aucun deal en cours</p>
            <p className="text-sm mt-1">Connectez votre CRM pour voir vos deals</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Deal</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Montant</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Probabilité</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Commission si gagné</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Détail</th>
                </tr>
              </thead>
              <tbody>
                {projections.map((proj) => (
                  <tr key={proj.deal.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2 font-medium text-gray-900 max-w-[200px] truncate">
                      {proj.deal.title}
                    </td>
                    <td className="py-3 px-2 text-right text-gray-600">
                      {formatEur(proj.deal.amount)}
                    </td>
                    <td className="py-3 px-2 text-right">
                      <span
                        className={`font-medium ${
                          proj.deal.probability >= 70
                            ? 'text-green-600'
                            : proj.deal.probability >= 40
                              ? 'text-yellow-600'
                              : 'text-gray-500'
                        }`}
                      >
                        {proj.deal.probability}%
                      </span>
                    </td>
                    <td className="py-3 px-2 text-right font-semibold text-primary-700">
                      {formatEur(proj.projectedCommission)}
                    </td>
                    <td className="py-3 px-2 text-gray-500 text-xs max-w-[200px]">
                      {proj.explanation}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 bg-gray-50">
                  <td colSpan={3} className="py-3 px-2 font-semibold text-gray-700">Total projeté</td>
                  <td className="py-3 px-2 text-right font-bold text-primary-700 text-base">
                    {formatEur(total)}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
