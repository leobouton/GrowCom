import { useEffect, useState } from 'react';
import { commissionDisputeService } from '../../services/commissionDispute.service';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import type { CommissionDispute, DisputeStatus } from '@shared/types';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

const STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: 'En attente',
  RESOLVED_ACCEPTED: 'Acceptee',
  RESOLVED_REJECTED: 'Rejetee',
};

const STATUS_BADGE_VARIANT: Record<DisputeStatus, 'yellow' | 'green' | 'red'> = {
  OPEN: 'yellow',
  RESOLVED_ACCEPTED: 'green',
  RESOLVED_REJECTED: 'red',
};

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

// ─── Modal de résolution ────────────────────────────────────────────────────
function ResolveDisputeModal({
  dispute,
  onClose,
  onResolved,
}: {
  dispute: CommissionDispute;
  onClose: () => void;
  onResolved: () => void;
}) {
  const [action, setAction] = useState<'accept' | 'reject'>('reject');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Champs du deal modifiables (seulement en mode acceptation)
  const deal = dispute.commission?.deal;
  const [dealTitle, setDealTitle] = useState(deal?.title ?? '');
  const [dealClient, setDealClient] = useState(deal?.clientName ?? '');
  const [dealAmount, setDealAmount] = useState(deal?.amount ?? 0);
  const [dealType, setDealType] = useState(deal?.dealType ?? '');
  const [dealNotes, setDealNotes] = useState(deal?.notes ?? '');

  const hasDealChanges = deal && (
    dealTitle !== deal.title ||
    dealClient !== (deal.clientName ?? '') ||
    dealAmount !== deal.amount ||
    dealType !== (deal.dealType ?? '') ||
    dealNotes !== (deal.notes ?? '')
  );

  const handleSubmit = async () => {
    if (!response.trim()) {
      setError('Une reponse est requise.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      // Construire les modifications du deal si on accepte
      let dealUpdates: Record<string, unknown> | undefined;
      if (action === 'accept' && hasDealChanges && deal) {
        dealUpdates = {};
        if (dealTitle !== deal.title) dealUpdates.title = dealTitle;
        if (dealClient !== (deal.clientName ?? '')) dealUpdates.clientName = dealClient || null;
        if (dealAmount !== deal.amount) dealUpdates.amount = dealAmount;
        if (dealType !== (deal.dealType ?? '')) dealUpdates.dealType = dealType || null;
        if (dealNotes !== (deal.notes ?? '')) dealUpdates.notes = dealNotes || null;
      }

      await commissionDisputeService.resolve(
        dispute.id,
        action,
        response.trim(),
        dealUpdates as Parameters<typeof commissionDisputeService.resolve>[3],
      );
      onResolved();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } } };
      setError(e?.response?.data?.message ?? 'Une erreur est survenue.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <h3 className="text-base font-semibold text-gray-900 mb-4">Resoudre la contestation</h3>

          {/* Info du commercial */}
          {dispute.raiser && (
            <div className="flex items-center gap-2 mb-4">
              <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center text-xs font-bold text-primary-700">
                {dispute.raiser.firstName[0]}{dispute.raiser.lastName[0]}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{dispute.raiser.firstName} {dispute.raiser.lastName}</p>
                <p className="text-xs text-gray-400">{dispute.raiser.email}</p>
              </div>
            </div>
          )}

          {/* Motif */}
          <div className="bg-gray-50 rounded-lg px-4 py-3 mb-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Motif de la contestation</p>
            <p className="text-sm text-gray-700 italic">"{dispute.reason}"</p>
          </div>

          {/* Details de la vente */}
          {deal && (
            <div className="bg-blue-50 rounded-lg px-4 py-3 mb-4">
              <p className="text-xs font-semibold text-blue-600 uppercase tracking-wide mb-2">Vente concernee</p>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-gray-500">Nom : </span>
                  <span className="font-medium text-gray-900">{deal.title}</span>
                </div>
                <div>
                  <span className="text-gray-500">Client : </span>
                  <span className="font-medium text-gray-900">{deal.clientName ?? '—'}</span>
                </div>
                <div>
                  <span className="text-gray-500">Montant : </span>
                  <span className="font-medium text-gray-900">{formatEur(deal.amount)}</span>
                </div>
                <div>
                  <span className="text-gray-500">Type : </span>
                  <span className="font-medium text-gray-900">{deal.dealType ?? '—'}</span>
                </div>
                {deal.closedAt && (
                  <div>
                    <span className="text-gray-500">Cloturee le : </span>
                    <span className="font-medium text-gray-900">
                      {format(new Date(deal.closedAt), 'dd MMM yyyy', { locale: fr })}
                    </span>
                  </div>
                )}
                {dispute.commission && (
                  <div>
                    <span className="text-gray-500">Commission : </span>
                    <span className="font-medium text-gray-900">{formatEur(dispute.commission.amount)}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Boutons action */}
          <div className="flex gap-3 mb-4">
            <button
              onClick={() => setAction('accept')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                action === 'accept'
                  ? 'bg-green-600 text-white border-green-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Accepter
            </button>
            <button
              onClick={() => setAction('reject')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                action === 'reject'
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}
            >
              Rejeter
            </button>
          </div>

          {/* Modification du deal (seulement si accepte) */}
          {action === 'accept' && deal && (
            <div className="border border-green-200 bg-green-50 rounded-lg p-4 mb-4">
              <p className="text-xs font-semibold text-green-700 uppercase tracking-wide mb-3">
                Modifier la vente (optionnel)
              </p>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Nom de la vente</label>
                  <input
                    type="text"
                    value={dealTitle}
                    onChange={(e) => setDealTitle(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Client</label>
                  <input
                    type="text"
                    value={dealClient}
                    onChange={(e) => setDealClient(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Montant</label>
                  <input
                    type="number"
                    value={dealAmount}
                    onChange={(e) => setDealAmount(Number(e.target.value))}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Type de deal</label>
                  <input
                    type="text"
                    value={dealType}
                    onChange={(e) => setDealType(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
                <div className="col-span-2">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                  <input
                    type="text"
                    value={dealNotes}
                    onChange={(e) => setDealNotes(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400"
                  />
                </div>
              </div>
              {hasDealChanges && (
                <p className="text-xs text-green-600 mt-2 font-medium">
                  Des modifications seront appliquees a la vente
                </p>
              )}
            </div>
          )}

          {/* Reponse */}
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Reponse au commercial <span className="text-red-500">*</span>
          </label>
          <textarea
            value={response}
            onChange={(e) => setResponse(e.target.value)}
            rows={3}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            placeholder="Expliquez votre decision au commercial..."
          />

          {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

          <div className="flex gap-3 justify-end mt-5">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={loading}>
              Annuler
            </Button>
            <Button
              size="sm"
              variant={action === 'accept' ? 'primary' : 'danger'}
              loading={loading}
              onClick={() => void handleSubmit()}
            >
              {action === 'accept' ? 'Accepter' : 'Rejeter'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Ligne de detail expandable ─────────────────────────────────────────────
function DisputeRow({
  dispute,
  showResponse,
  onResolve,
}: {
  dispute: CommissionDispute;
  showResponse: boolean;
  onResolve: (d: CommissionDispute) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const deal = dispute.commission?.deal;
  const raiserName = dispute.raiser
    ? `${dispute.raiser.firstName} ${dispute.raiser.lastName}`
    : dispute.raisedBy;

  return (
    <>
      <tr
        className="border-b border-gray-50 last:border-0 cursor-pointer hover:bg-gray-50/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 px-2">
          <div className="flex items-center gap-2">
            <svg
              className={`w-3.5 h-3.5 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-medium text-gray-900">{raiserName}</span>
          </div>
        </td>
        <td className="py-3 px-2 text-gray-600 max-w-xs">
          <p className="truncate max-w-[220px]" title={dispute.reason}>
            {dispute.reason}
          </p>
        </td>
        <td className="py-3 px-2">
          <Badge variant={STATUS_BADGE_VARIANT[dispute.status]}>
            {STATUS_LABELS[dispute.status]}
          </Badge>
        </td>
        <td className="py-3 px-2 text-gray-400 text-xs whitespace-nowrap">
          {format(new Date(dispute.createdAt), 'dd MMM yyyy', { locale: fr })}
        </td>
        {showResponse && (
          <td className="py-3 px-2 text-gray-500 text-xs max-w-[200px]">
            {dispute.managerResponse
              ? <span title={dispute.managerResponse} className="truncate block max-w-[180px]">{dispute.managerResponse}</span>
              : <span className="text-gray-300">&mdash;</span>}
          </td>
        )}
        <td className="py-3 px-2 text-right">
          {dispute.status === 'OPEN' && (
            <Button
              size="sm"
              onClick={(e) => { e.stopPropagation(); onResolve(dispute); }}
            >
              Traiter
            </Button>
          )}
        </td>
      </tr>
      {expanded && deal && (
        <tr className="bg-gray-50/70">
          <td colSpan={showResponse ? 6 : 5} className="px-6 py-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div>
                <span className="text-gray-400 block">Vente</span>
                <span className="font-medium text-gray-800">{deal.title}</span>
              </div>
              <div>
                <span className="text-gray-400 block">Client</span>
                <span className="font-medium text-gray-800">{deal.clientName ?? '—'}</span>
              </div>
              <div>
                <span className="text-gray-400 block">Montant</span>
                <span className="font-medium text-gray-800">{formatEur(deal.amount)}</span>
              </div>
              <div>
                <span className="text-gray-400 block">Commission</span>
                <span className="font-medium text-gray-800">
                  {dispute.commission ? formatEur(dispute.commission.amount) : '—'}
                </span>
              </div>
              {deal.dealType && (
                <div>
                  <span className="text-gray-400 block">Type</span>
                  <span className="font-medium text-gray-800">{deal.dealType}</span>
                </div>
              )}
              {deal.closedAt && (
                <div>
                  <span className="text-gray-400 block">Date de cloture</span>
                  <span className="font-medium text-gray-800">
                    {format(new Date(deal.closedAt), 'dd MMM yyyy', { locale: fr })}
                  </span>
                </div>
              )}
              {dispute.commission?.rule && (
                <div>
                  <span className="text-gray-400 block">Regle</span>
                  <span className="font-medium text-gray-800">{dispute.commission.rule.name}</span>
                </div>
              )}
            </div>
            {dispute.managerResponse && dispute.status !== 'OPEN' && (
              <div className="mt-3 bg-yellow-50 border border-yellow-200 rounded-lg px-3 py-2">
                <p className="text-xs font-semibold text-yellow-700 mb-0.5">Reponse du manager</p>
                <p className="text-xs text-yellow-800">{dispute.managerResponse}</p>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Page principale ────────────────────────────────────────────────────────
export function DisputesPage() {
  const [disputes, setDisputes] = useState<CommissionDispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<DisputeStatus | 'ALL'>('OPEN');
  const [resolveModal, setResolveModal] = useState<CommissionDispute | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await commissionDisputeService.listByTenant(
        filter === 'ALL' ? undefined : filter,
      );
      setDisputes(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const openCount = disputes.filter((d) => d.status === 'OPEN').length;
  const showResponse = filter !== 'OPEN';

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contestations</h1>
          <p className="text-gray-500 mt-1">Gerez les contestations de vos commerciaux</p>
        </div>
        {filter === 'OPEN' && openCount > 0 && (
          <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-yellow-100 text-yellow-800">
            {openCount} en attente
          </span>
        )}
      </div>

      {/* Filtres */}
      <div className="flex gap-2">
        {(['ALL', 'OPEN', 'RESOLVED_ACCEPTED', 'RESOLVED_REJECTED'] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              filter === s
                ? 'bg-primary-600 text-white border-primary-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {s === 'ALL' ? 'Toutes' : STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Tableau */}
      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-10">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
          </div>
        ) : disputes.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="font-medium">Aucune contestation</p>
            <p className="text-sm mt-1">
              {filter === 'OPEN' ? "Aucune contestation en attente — tout est traite !" : "Aucune contestation pour ce filtre."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Commercial</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Motif</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Statut</th>
                  <th className="text-left py-3 px-2 font-medium text-gray-500">Date</th>
                  {showResponse && (
                    <th className="text-left py-3 px-2 font-medium text-gray-500">Reponse manager</th>
                  )}
                  <th className="text-right py-3 px-2 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {disputes.map((dispute) => (
                  <DisputeRow
                    key={dispute.id}
                    dispute={dispute}
                    showResponse={showResponse}
                    onResolve={setResolveModal}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {resolveModal && (
        <ResolveDisputeModal
          dispute={resolveModal}
          onClose={() => setResolveModal(null)}
          onResolved={() => {
            setResolveModal(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
