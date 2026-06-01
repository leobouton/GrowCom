import { useState, useEffect, useCallback } from 'react';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { importBatchApiService } from '../../services/importBatch.service';
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

// ─── Modal détail ───────────────────────────────────────────────────────────

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
                      <td className="px-3 py-2 font-medium text-gray-800 max-w-[180px] truncate">
                        {deal.title}
                      </td>
                      <td className="px-3 py-2 text-gray-600 max-w-[140px] truncate">
                        {deal.clientName ?? '-'}
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

function CancelModal({
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
            {/* Récap d'impact */}
            <div className="rounded-lg border border-gray-200 p-4 space-y-3">
              <p className="text-sm font-semibold text-gray-800">Impact :</p>

              {preview.toBeDeleted > 0 && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium text-red-600">{preview.toBeDeleted}</span> deal{preview.toBeDeleted > 1 ? 's' : ''} créé{preview.toBeDeleted > 1 ? 's' : ''} seront supprimé{preview.toBeDeleted > 1 ? 's' : ''}
                </p>
              )}

              {preview.toBeRestored > 0 && (
                <p className="text-sm text-gray-700">
                  <span className="font-medium text-amber-600">{preview.toBeRestored}</span> deal{preview.toBeRestored > 1 ? 's' : ''} modifié{preview.toBeRestored > 1 ? 's' : ''} seront restauré{preview.toBeRestored > 1 ? 's' : ''} à leur état précédent
                </p>
              )}

              {/* Commissions */}
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
                    d'un mois passé seront conservé{preview.toBeKept > 1 ? 's' : ''}. Pour les annuler, utilisez le bouton "Annuler"
                    sur chaque commission individuellement.
                  </p>
                </div>
              )}
            </div>

            {/* Motif */}
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

            {/* Actions */}
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="secondary" onClick={onClose} disabled={cancelling}>
                Annuler
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

// ─── Page principale ────────────────────────────────────────────────────────

export function ImportHistoryPage() {
  const [batches, setBatches] = useState<ImportBatchWithDetails[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);

  // Modals
  const [detailBatch, setDetailBatch] = useState<(ImportBatchWithDetails & { deals?: unknown[] }) | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [cancelBatch, setCancelBatch] = useState<ImportBatchWithDetails | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const loadBatches = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const result = await importBatchApiService.list(p, 20);
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

  // Garde-fou : pas d'annulation si l'import date de plus de 90 jours
  const isOlderThan90Days = (createdAt: string) => {
    const diff = Date.now() - new Date(createdAt).getTime();
    return diff > 90 * 24 * 60 * 60 * 1000;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Historique des imports</h1>
          <p className="text-sm text-gray-500 mt-1">
            {total} import{total > 1 ? 's' : ''} au total
          </p>
        </div>
      </div>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : batches.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-500">Aucun import pour le moment</p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">Date</th>
                    <th className="px-4 py-3 text-left font-medium">Fichier</th>
                    <th className="px-4 py-3 text-left font-medium">Importé par</th>
                    <th className="px-4 py-3 text-center font-medium">Lignes</th>
                    <th className="px-4 py-3 text-center font-medium">Statut</th>
                    <th className="px-4 py-3 text-right font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {batches.map((batch) => (
                    <tr key={batch.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 text-gray-700 whitespace-nowrap">
                        {new Date(batch.createdAt).toLocaleDateString('fr-FR', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </td>
                      <td className="px-4 py-3 text-gray-900 font-medium max-w-[200px] truncate">
                        {batch.originalFileName ?? 'Sans nom'}
                      </td>
                      <td className="px-4 py-3 text-gray-600">
                        {batch.importer.firstName} {batch.importer.lastName}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-600">
                        <span className="tabular-nums">{batch.totalRows}</span>
                        <span className="text-xs text-gray-400 ml-1">
                          ({batch.createdRows} nouv.
                          {batch.updatedRows > 0 && <>, {batch.updatedRows} maj</>}
                          {batch.errorRows > 0 && <>, {batch.errorRows} err.</>})
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <BatchStatusBadge status={batch.status} />
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => void handleViewDetail(batch)}
                          className="text-xs text-primary-600 hover:text-primary-800 font-medium"
                        >
                          Voir
                        </button>
                        {batch.status === 'COMPLETED' && !isOlderThan90Days(batch.createdAt) && (
                          <button
                            onClick={() => handleCancelClick(batch)}
                            className="text-xs text-red-600 hover:text-red-800 font-medium"
                          >
                            Annuler
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-500">
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
          </>
        )}
      </Card>

      {/* Modals */}
      <BatchDetailModal
        batch={detailBatch}
        isOpen={detailOpen}
        onClose={() => setDetailOpen(false)}
        onCancelClick={() => {
          if (detailBatch) handleCancelClick(detailBatch);
        }}
      />
      <CancelModal
        batch={cancelBatch}
        isOpen={cancelOpen}
        onClose={() => setCancelOpen(false)}
        onConfirmed={handleCancelled}
      />
    </div>
  );
}
