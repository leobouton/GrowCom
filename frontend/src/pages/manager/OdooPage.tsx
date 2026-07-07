import { useEffect, useState, useCallback } from 'react';
import { odooApiService } from '../../services/odoo.service';
import { hubspotApiService } from '../../services/hubspot.service';
import { importBatchApiService } from '../../services/importBatch.service';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { TruncatedText } from '../../components/ui/TruncatedText';
import { FileImportPanel } from '../../components/FileImportPanel';
import { OdooConnectionPanel } from '../../components/crm/OdooConnectionPanel';
import { HubspotConnectionPanel } from '../../components/crm/HubspotConnectionPanel';
import { OdooLogo, HubspotLogo } from '../../assets/crm-logos';
import type { ImportBatchWithDetails, CancelPreviewResult, ImportRowError } from '@shared/types';

// ─── Badge statut batch ─────────────────────────────────────────────────────

function BatchStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: 'green' | 'orange' | 'red' | 'gray' }> = {
    COMPLETED: { label: 'OK', variant: 'green' },
    PARTIALLY_CANCELLED: { label: 'Partiel', variant: 'orange' },
    CANCELLED: { label: 'Annulé', variant: 'red' },
  };
  const { label, variant } = config[status] ?? { label: status, variant: 'gray' };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Modal détail d'un import ───────────────────────────────────────────────

function BatchDetailModal({
  batch,
  isOpen,
  onClose,
  onCancelClick,
}: {
  batch: (ImportBatchWithDetails & { deals?: unknown[] }) | null;
  isOpen: boolean;
  onClose: () => void;
  onCancelClick: () => void;
}) {
  if (!batch) return null;

  const deals = (batch.deals ?? []) as Array<{
    id: string;
    title: string;
    clientName: string | null;
    amount: number;
    status: string;
    commissions: Array<{ id: string; status: string; amount: number }>;
  }>;

  const importErrors = (batch.importErrors ?? []) as ImportRowError[];

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Détail de l'import" size="xl">
      <div className="space-y-5">
        {/* Métadonnées */}
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-gray-500">Importé par</p>
            <p className="font-medium text-gray-900">
              {batch.importer.firstName} {batch.importer.lastName}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Date</p>
            <p className="font-medium text-gray-900">
              {new Date(batch.createdAt).toLocaleDateString('fr-FR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
          <div>
            <p className="text-gray-500">Fichier</p>
            <p className="font-medium text-gray-900">{batch.originalFileName ?? 'Sans nom'}</p>
          </div>
          <div>
            <p className="text-gray-500">Statut</p>
            <BatchStatusBadge status={batch.status} />
          </div>
          <div>
            <p className="text-gray-500">Résumé</p>
            <p className="font-medium text-gray-900">
              {batch.createdRows} créé{batch.createdRows > 1 ? 's' : ''}
              {batch.updatedRows > 0 && <>, {batch.updatedRows} mis à jour</>}
              {batch.errorRows > 0 && <>, {batch.errorRows} erreur{batch.errorRows > 1 ? 's' : ''}</>}
            </p>
          </div>
        </div>

        {/* Récap annulation si batch annulé */}
        {batch.cancellationSummary && (
          <div className="rounded-lg bg-red-50 border border-red-200 p-4">
            <p className="text-sm font-semibold text-red-800 mb-1">Import annulé</p>
            <p className="text-sm text-red-700">
              {batch.cancellationSummary.deletedDeals} deal{batch.cancellationSummary.deletedDeals > 1 ? 's' : ''} supprimé{batch.cancellationSummary.deletedDeals > 1 ? 's' : ''}
              {batch.cancellationSummary.restoredDeals > 0 && <>, {batch.cancellationSummary.restoredDeals} restauré{batch.cancellationSummary.restoredDeals > 1 ? 's' : ''}</>}
              {batch.cancellationSummary.keptDeals > 0 && <>, {batch.cancellationSummary.keptDeals} conservé{batch.cancellationSummary.keptDeals > 1 ? 's' : ''}</>}
            </p>
            {batch.cancellationReason && (
              <p className="text-xs text-red-600 mt-1">Motif : {batch.cancellationReason}</p>
            )}
          </div>
        )}

        {/* Erreurs d'import */}
        {importErrors.length > 0 && (
          <details className="rounded-lg border border-amber-200 bg-amber-50">
            <summary className="px-4 py-3 text-sm font-medium text-amber-800 cursor-pointer">
              Erreurs ignorées ({importErrors.length})
            </summary>
            <div className="px-4 pb-3 max-h-40 overflow-y-auto space-y-1">
              {importErrors.map((err, i) => (
                <p key={i} className="text-xs text-amber-700 font-mono">
                  Ligne {err.row}{err.column ? `, colonne «${err.column}»` : ''} : {err.message}
                  {err.value ? ` (valeur : "${err.value}")` : ''}
                </p>
              ))}
            </div>
          </details>
        )}

        {/* Liste des deals */}
        {deals.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Deals de cet import ({deals.length})
            </p>
            <div className="overflow-x-auto rounded-lg border border-gray-200 max-h-64 overflow-y-auto">
              <table className="text-xs w-full">
                <thead className="bg-gray-50 text-gray-500 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Deal</th>
                    <th className="px-3 py-2 text-left font-medium">Client</th>
                    <th className="px-3 py-2 text-right font-medium">Montant</th>
                    <th className="px-3 py-2 text-center font-medium">Commissions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {deals.map((deal) => (
                    <tr key={deal.id}>
                      <td className="px-3 py-2 max-w-[180px]">
                        <TruncatedText text={deal.title} className="font-medium text-gray-800" />
                      </td>
                      <td className="px-3 py-2 max-w-[140px]">
                        <TruncatedText text={deal.clientName ?? '-'} className="text-gray-600" />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                        {deal.amount.toLocaleString('fr-FR')} EUR
                      </td>
                      <td className="px-3 py-2 text-center">
                        {deal.commissions.length > 0 ? (
                          <span className="text-gray-600">
                            {deal.commissions.length} ({deal.commissions.reduce((s, c) => s + c.amount, 0).toLocaleString('fr-FR')} EUR)
                          </span>
                        ) : (
                          <span className="text-gray-400">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Bouton annuler */}
        {batch.status === 'COMPLETED' && (
          <div className="pt-2">
            <Button
              variant="secondary"
              onClick={onCancelClick}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              Annuler cet import
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}

// ─── Modal annulation ───────────────────────────────────────────────────────

function CancelBatchModal({
  batch,
  isOpen,
  onClose,
  onConfirmed,
}: {
  batch: ImportBatchWithDetails | null;
  isOpen: boolean;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const [preview, setPreview] = useState<CancelPreviewResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!batch || !isOpen) return;
    setLoading(true);
    setPreview(null);
    setReason('');
    setError(null);
    importBatchApiService
      .cancelPreview(batch.id)
      .then(setPreview)
      .catch(() => setError('Impossible de charger l\'aperçu'))
      .finally(() => setLoading(false));
  }, [batch, isOpen]);

  const handleConfirm = async () => {
    if (!batch) return;
    setCancelling(true);
    setError(null);
    try {
      await importBatchApiService.cancel(batch.id, reason);
      onConfirmed();
    } catch (err) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message ?? 'Erreur lors de l\'annulation';
      setError(msg);
    } finally {
      setCancelling(false);
    }
  };

  if (!batch) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Annuler l'import "${batch.originalFileName ?? 'Sans nom'}" ?`} size="lg">
      <div className="space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {preview && (
          <>
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-800">Impact :</p>

              {preview.toBeDeleted > 0 && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium text-red-600">{preview.toBeDeleted}</span> deal{preview.toBeDeleted > 1 ? 's' : ''} seront supprimé{preview.toBeDeleted > 1 ? 's' : ''}
                </p>
              )}

              {preview.toBeRestored > 0 && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium text-amber-600">{preview.toBeRestored}</span> deal{preview.toBeRestored > 1 ? 's' : ''} seront restauré{preview.toBeRestored > 1 ? 's' : ''}
                </p>
              )}

              <div className="text-sm text-gray-700 space-y-1">
                <p className="font-medium">Commissions associées :</p>
                {preview.affectedCommissions.pending > 0 && (
                  <p className="ml-4">- {preview.affectedCommissions.pending} en attente seront supprimée{preview.affectedCommissions.pending > 1 ? 's' : ''}</p>
                )}
                {preview.affectedCommissions.validated > 0 && (
                  <p className="ml-4 text-amber-700">
                    - {preview.affectedCommissions.validated} validée{preview.affectedCommissions.validated > 1 ? 's' : ''} ne seront PAS touchée{preview.affectedCommissions.validated > 1 ? 's' : ''}
                  </p>
                )}
                {preview.affectedCommissions.paid > 0 && (
                  <p className="ml-4 text-amber-700">
                    - {preview.affectedCommissions.paid} payée{preview.affectedCommissions.paid > 1 ? 's' : ''} ne seront PAS touchée{preview.affectedCommissions.paid > 1 ? 's' : ''}
                  </p>
                )}
              </div>

              {preview.toBeKept > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 mt-2">
                  <p className="text-sm text-amber-800">
                    <span className="font-semibold">{preview.toBeKept}</span> deal{preview.toBeKept > 1 ? 's' : ''} avec commissions validées/payées
                    seront conservé{preview.toBeKept > 1 ? 's' : ''}. Pour les annuler, utilisez le bouton "Annuler"
                    sur chaque commission individuellement.
                  </p>
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Motif de l'annulation (obligatoire)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Ex : Mauvais fichier importé, données erronées..."
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
              />
              <p className="text-xs text-gray-400 mt-1">
                {reason.trim().length}/500 caractères (min. 10)
              </p>
            </div>

            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" onClick={onClose} disabled={cancelling}>
                Fermer
              </Button>
              <Button
                onClick={() => void handleConfirm()}
                loading={cancelling}
                disabled={reason.trim().length < 10}
                className="bg-red-600 hover:bg-red-700 text-white"
              >
                Confirmer l'annulation
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ─── Section historique des imports ──────────────────────────────────────────

function ImportHistorySection() {
  const [batches, setBatches] = useState<ImportBatchWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  // Modals
  const [detailBatch, setDetailBatch] = useState<(ImportBatchWithDetails & { deals?: unknown[] }) | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [cancelBatch, setCancelBatch] = useState<ImportBatchWithDetails | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const loadBatches = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await importBatchApiService.list(p, 10);
      setBatches(result.batches);
      setTotal(result.total);
      setTotalPages(result.totalPages);
      setPage(p);
    } catch {
      // Silencieux
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBatches(1);
  }, [loadBatches]);

  const handleViewDetail = async (batch: ImportBatchWithDetails) => {
    try {
      const full = await importBatchApiService.getById(batch.id);
      setDetailBatch(full);
      setDetailOpen(true);
    } catch {
      // Silencieux
    }
  };

  const handleCancelClick = (batch: ImportBatchWithDetails) => {
    setDetailOpen(false);
    setCancelBatch(batch);
    setCancelOpen(true);
  };

  const handleCancelled = () => {
    setCancelOpen(false);
    setCancelBatch(null);
    void loadBatches(page);
  };

  const isOlderThan90Days = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    return diff > 90 * 24 * 60 * 60 * 1000;
  };

  if (loading && batches.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (total === 0) return null;

  // On affiche les 3 derniers par défaut, le reste est caché derrière "Voir tout"
  const visibleBatches = expanded ? batches : batches.slice(0, 3);

  return (
    <>
      <div className="space-y-3">
        {/* En-tête */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h3 className="text-sm font-semibold text-gray-700">
              Historique des imports
            </h3>
            <span className="text-xs text-gray-400">({total})</span>
          </div>
          {total > 3 && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-xs text-primary-600 hover:text-primary-800 font-medium transition-colors"
            >
              {expanded ? 'Voir moins' : `Voir tout (${total})`}
            </button>
          )}
        </div>

        {/* Liste des imports */}
        <div className="space-y-2">
          {visibleBatches.map((batch) => (
            <div
              key={batch.id}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-gray-100 bg-gray-50/50 hover:bg-gray-50 transition-colors group"
            >
              {/* Icone fichier */}
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                batch.status === 'CANCELLED' ? 'bg-red-100' :
                batch.status === 'PARTIALLY_CANCELLED' ? 'bg-amber-100' :
                'bg-green-100'
              }`}>
                <svg className={`w-4 h-4 ${
                  batch.status === 'CANCELLED' ? 'text-red-500' :
                  batch.status === 'PARTIALLY_CANCELLED' ? 'text-amber-500' :
                  'text-green-500'
                }`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
              </div>

              {/* Infos */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <TruncatedText text={batch.originalFileName ?? 'Sans nom'} className="text-sm font-medium text-gray-900" />
                  <BatchStatusBadge status={batch.status} />
                </div>
                <p className="text-xs text-gray-500 mt-0.5">
                  {new Date(batch.createdAt).toLocaleDateString('fr-FR', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {' '}&middot;{' '}
                  {batch.createdRows} deal{batch.createdRows > 1 ? 's' : ''}
                  {batch.errorRows > 0 && (
                    <span className="text-amber-600"> &middot; {batch.errorRows} erreur{batch.errorRows > 1 ? 's' : ''}</span>
                  )}
                  {' '}&middot;{' '}
                  par {batch.importer.firstName} {batch.importer.lastName}
                </p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => void handleViewDetail(batch)}
                  className="px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:text-primary-800 hover:bg-primary-50 rounded-lg transition-colors"
                >
                  Détail
                </button>
                {batch.status === 'COMPLETED' && !isOlderThan90Days(batch.createdAt) && (
                  <button
                    onClick={() => handleCancelClick(batch)}
                    className="px-2.5 py-1.5 text-xs font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors"
                  >
                    Annuler
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Pagination (visible seulement en mode étendu) */}
        {expanded && totalPages > 1 && (
          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-gray-400">
              Page {page} sur {totalPages}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => void loadBatches(page - 1)}
              >
                Précédent
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => void loadBatches(page + 1)}
              >
                Suivant
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Modals */}
      <BatchDetailModal
        batch={detailBatch}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        onCancelClick={() => {
          if (detailBatch) handleCancelClick(detailBatch);
        }}
      />
      <CancelBatchModal
        batch={cancelBatch}
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirmed={handleCancelled}
      />
    </>
  );
}

// ─── Page principale ────────────────────────────────────────────────────────

type CrmId = 'odoo' | 'hubspot';

// ─── Carte logo CRM cliquable ────────────────────────────────────────────────

function CrmCard({
  logo,
  name,
  connected,
  selected,
  onClick,
}: {
  logo: React.ReactNode;
  name: string;
  connected: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex-1 flex flex-col items-center gap-3 rounded-xl border-2 bg-white px-4 py-5 transition-all ${
        selected
          ? 'border-primary-500 shadow-card ring-1 ring-primary-200'
          : 'border-gray-200 hover:border-gray-300 hover:shadow-card'
      }`}
    >
      <div className="h-10 flex items-center">{logo}</div>
      <span className="text-sm font-semibold text-gray-900">{name}</span>
      {connected ? (
        <Badge variant="green">Connecté</Badge>
      ) : (
        <Badge variant="gray">Non connecté</Badge>
      )}
    </button>
  );
}

// ─── Page principale ─────────────────────────────────────────────────────────

export function OdooPage() {
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<CrmId>('odoo');

  const [odooConfig, setOdooConfig] = useState<{ configured: boolean; odooUrl: string | null; odooLogin: string | null }>({
    configured: false,
    odooUrl: null,
    odooLogin: null,
  });
  const [hubspotConfig, setHubspotConfig] = useState<{ configured: boolean; hubspotPortalId: string | null }>({
    configured: false,
    hubspotPortalId: null,
  });

  useEffect(() => {
    const load = async () => {
      // On charge les deux configurations en parallèle. Chaque appel est protégé :
      // si l'endpoint HubSpot n'est pas encore disponible, on retombe sur « non connecté ».
      const [odoo, hubspot] = await Promise.all([
        odooApiService.getConfig().catch(() => ({ configured: false, odooUrl: null, odooDatabase: null, odooLogin: null })),
        hubspotApiService.getConfig().catch(() => ({ configured: false, hubspotPortalId: null })),
      ]);

      setOdooConfig({ configured: odoo.configured, odooUrl: odoo.odooUrl, odooLogin: odoo.odooLogin ?? null });
      setHubspotConfig({ configured: hubspot.configured, hubspotPortalId: hubspot.hubspotPortalId ?? null });

      // On présélectionne le CRM déjà connecté (Odoo prioritaire), sinon Odoo par défaut.
      setSelected(odoo.configured ? 'odoo' : hubspot.configured ? 'hubspot' : 'odoo');
      setLoading(false);
    };
    void load();
  }, []);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Connexion CRM</h1>
        <p className="text-gray-500 mt-1">Choisissez votre CRM ou importez vos deals via un fichier Excel / CSV</p>
      </div>

      {/* Sélecteur de CRM par logos */}
      <div className="flex gap-4">
        <CrmCard
          logo={<OdooLogo />}
          name="Odoo"
          connected={odooConfig.configured}
          selected={selected === 'odoo'}
          onClick={() => setSelected('odoo')}
        />
        <CrmCard
          logo={<HubspotLogo />}
          name="HubSpot"
          connected={hubspotConfig.configured}
          selected={selected === 'hubspot'}
          onClick={() => setSelected('hubspot')}
        />
      </div>

      {/* Panneau de configuration du CRM sélectionné */}
      {selected === 'odoo' && (
        <OdooConnectionPanel
          initialConfig={odooConfig}
          onConfiguredChange={(configured) => setOdooConfig((c) => ({ ...c, configured }))}
        />
      )}
      {selected === 'hubspot' && (
        <HubspotConnectionPanel
          initialConfig={hubspotConfig}
          onConfiguredChange={(configured) => setHubspotConfig((c) => ({ ...c, configured }))}
        />
      )}

      {/* ─── Séparateur Import fichier ─── */}
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-gray-200" />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Import fichier</span>
        <div className="flex-1 h-px bg-gray-200" />
      </div>

      {/* Panel import Excel / CSV */}
      <FileImportPanel />

      {/* Historique des imports (directement sous le panel) */}
      <ImportHistorySection />
    </div>
  );
}
