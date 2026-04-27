import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { StatCard, Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  activeUsers: number;
  mrr: number;
  stripeCustomerId: string | null;
  createdAt: string;
}

interface AdminData {
  tenants: TenantSummary[];
  totalMrr: number;
  totalTenants: number;
}

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function AdminDashboard() {
  const [data, setData] = useState<AdminData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get<{ success: true; data: AdminData }>('/admin/tenants');
        setData(res.data.data);
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
        <h1 className="text-2xl font-bold text-gray-900">Administration GrowCom</h1>
        <p className="text-gray-500 mt-1">Vue globale de tous les clients</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <StatCard
          title="MRR Total"
          value={formatEur(data?.totalMrr ?? 0)}
          subtitle="Monthly Recurring Revenue"
          color="green"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          }
        />
        <StatCard
          title="Clients actifs"
          value={data?.totalTenants ?? 0}
          subtitle="Entreprises utilisatrices"
          color="indigo"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          }
        />
      </div>

      <Card padding="none">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">Liste des clients</h2>
        </div>
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100">
            <tr>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Entreprise</th>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Plan</th>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Statut</th>
              <th className="text-right py-3 px-6 font-medium text-gray-500">Utilisateurs</th>
              <th className="text-right py-3 px-6 font-medium text-gray-500">MRR</th>
              <th className="text-left py-3 px-6 font-medium text-gray-500">Inscription</th>
            </tr>
          </thead>
          <tbody>
            {!data?.tenants?.length ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-gray-400">
                  Aucun client pour l'instant
                </td>
              </tr>
            ) : (
              data.tenants.map((tenant) => (
                <tr key={tenant.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50">
                  <td className="py-4 px-6">
                    <p className="font-medium text-gray-900">{tenant.name}</p>
                    <p className="text-xs text-gray-400">{tenant.slug}</p>
                  </td>
                  <td className="py-4 px-6">
                    <Badge variant="gray">{tenant.plan}</Badge>
                  </td>
                  <td className="py-4 px-6">
                    <Badge
                      variant={
                        tenant.status === 'ACTIVE'
                          ? 'green'
                          : tenant.status === 'SUSPENDED'
                            ? 'yellow'
                            : 'red'
                      }
                    >
                      {tenant.status === 'ACTIVE'
                        ? 'Actif'
                        : tenant.status === 'SUSPENDED'
                          ? 'Suspendu'
                          : 'Annulé'}
                    </Badge>
                  </td>
                  <td className="py-4 px-6 text-right font-medium text-gray-900">
                    {tenant.activeUsers}
                  </td>
                  <td className="py-4 px-6 text-right font-semibold text-green-700">
                    {formatEur(tenant.mrr)}
                  </td>
                  <td className="py-4 px-6 text-gray-500 text-xs">
                    {format(new Date(tenant.createdAt), 'dd MMM yyyy', { locale: fr })}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
