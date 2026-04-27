import { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Card, StatCard } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { BillingInfo } from '@shared/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

export function BillingPage() {
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await api.get<{ success: true; data: BillingInfo }>('/billing');
        setInfo(res.data.data);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleSubscribe = async () => {
    setSubscribing(true);
    try {
      await api.post('/billing/subscribe');
      const res = await api.get<{ success: true; data: BillingInfo }>('/billing');
      setInfo(res.data.data);
    } finally {
      setSubscribing(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Facturation</h1>
        <p className="text-gray-500 mt-1">Gérez votre abonnement GrowCom</p>
      </div>

      {/* Résumé abonnement */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
        <StatCard
          title="Utilisateurs actifs"
          value={info?.activeUsers ?? 0}
          color="indigo"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <StatCard
          title="Mensualité"
          value={formatEur(info?.monthlyAmount ?? 0)}
          subtitle="10€ / utilisateur / mois"
          color="green"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          }
        />
        <StatCard
          title="Prochain prélèvement"
          value={
            info?.nextBillingDate
              ? format(new Date(info.nextBillingDate), 'dd MMM yyyy', { locale: fr })
              : '—'
          }
          color="yellow"
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
      </div>

      {/* Statut */}
      <Card>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Statut de l'abonnement</h2>
            <div className="mt-1 flex items-center gap-2">
              <Badge
                variant={
                  info?.status === 'ACTIVE'
                    ? 'green'
                    : info?.status === 'SUSPENDED'
                      ? 'yellow'
                      : 'red'
                }
              >
                {info?.status === 'ACTIVE'
                  ? 'Actif'
                  : info?.status === 'SUSPENDED'
                    ? 'Suspendu'
                    : 'Annulé'}
              </Badge>
              <Badge variant="gray">{info?.plan ?? 'TRIAL'}</Badge>
            </div>
          </div>
          {info?.status !== 'ACTIVE' && (
            <Button onClick={() => void handleSubscribe()} loading={subscribing}>
              Activer l'abonnement
            </Button>
          )}
        </div>
      </Card>

      {/* Historique des factures */}
      <Card>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Factures</h2>
        {!info?.invoices?.length ? (
          <p className="text-sm text-gray-500 text-center py-6">Aucune facture pour l'instant.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Date</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Montant</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Statut</th>
                  <th className="text-right py-3 px-2 font-medium text-gray-500">PDF</th>
                </tr>
              </thead>
              <tbody>
                {info.invoices.map((inv) => (
                  <tr key={inv.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-3 px-2 text-gray-600">
                      {format(new Date(inv.date), 'dd MMMM yyyy', { locale: fr })}
                    </td>
                    <td className="py-3 px-2 text-right font-semibold">{formatEur(inv.amount)}</td>
                    <td className="py-3 px-2">
                      <Badge variant={inv.status === 'paid' ? 'green' : 'yellow'}>
                        {inv.status === 'paid' ? 'Payée' : inv.status}
                      </Badge>
                    </td>
                    <td className="py-3 px-2 text-right">
                      {inv.pdfUrl ? (
                        <a
                          href={inv.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary-600 hover:text-primary-700 font-medium"
                        >
                          Télécharger
                        </a>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
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
