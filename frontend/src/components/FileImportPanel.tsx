import { useRef, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { fileImportApiService } from '../services/fileImport.service';
import { Card } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import type { ImportPreview, ImportLog, ImportMappingDetails } from '@shared/types';

// ─── Badge statut import ─────────────────────────────────────────────────────

function ImportStatusBadge({ status }: { status: string }) {
  const config: Record<string, { label: string; variant: 'green' | 'yellow' | 'red' | 'blue' | 'gray' | 'orange' }> = {
    PENDING:       { label: 'En attente', variant: 'yellow' },
    PROCESSING:    { label: 'En cours', variant: 'blue' },
    SUCCESS:       { label: 'Succès', variant: 'green' },
    PARTIAL_ERROR: { label: 'Partiel', variant: 'orange' },
    FAILED:        { label: 'Échec', variant: 'red' },
  };
  const { label, variant } = config[status] ?? { label: status, variant: 'gray' };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Composant principal ──────────────────────────────────────────────────────

export function FileImportPanel() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging]     = useState(false);
  const [uploading, setUploading]   = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [preview, setPreview]       = useState<ImportPreview | null>(null);
  const [history, setHistory]       = useState<ImportLog[]>([]);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [confirmResult, setConfirmResult] = useState<{ created: number; skipped: number; errors: number; batchId?: string } | null>(null);

  // ── Mapping manuel (fallback) ──
  const [mappingMode, setMappingMode] = useState(false);
  const [mappingDetails, setMappingDetails] = useState<ImportMappingDetails | null>(null);
  const [manualMapping, setManualMapping] = useState<Record<string, string>>({});
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  useEffect(() => {
    void fileImportApiService.history().then(setHistory).catch(() => {/* silencieux */});
  }, []);

  const handleFile = useCallback(async (file: File, customMapping?: Record<string, string>) => {
    setUploadError(null);
    setPreview(null);
    setConfirmResult(null);
    setUploading(true);
    setMappingMode(false);
    try {
      const result = await fileImportApiService.upload(file, customMapping);

      // Si le mapping est incomplet → activer le mode mapping manuel
      if (result.mappingIncomplete && result.mappingDetails) {
        setMappingDetails(result.mappingDetails);
        setPendingFile(file);
        // Pré-remplir le mapping manuel avec les champs déjà détectés
        const initial: Record<string, string> = {};
        for (const m of result.mappingDetails.mapped) {
          initial[m.field] = m.columnName;
        }
        setManualMapping(initial);
        setMappingMode(true);
        return;
      }

      setPreview(result);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        setUploadError(msg ?? err.message);
      } else if (err instanceof Error) {
        setUploadError(err.message);
      } else {
        setUploadError('Erreur lors de l\'analyse du fichier');
      }
    } finally {
      setUploading(false);
    }
  }, []);

  const handleConfirmMapping = () => {
    if (!pendingFile) return;
    void handleFile(pendingFile, manualMapping);
  };

  const handleCancelMapping = () => {
    setMappingMode(false);
    setMappingDetails(null);
    setPendingFile(null);
    setManualMapping({});
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  };

  const handleConfirm = async () => {
    if (!preview) return;
    setConfirming(true);
    setUploadError(null);
    try {
      const result = await fileImportApiService.confirm(preview.importLogId);
      setConfirmResult(result);
      setPreview(null);
      // Rafraîchir l'historique
      const newHistory = await fileImportApiService.history();
      setHistory(newHistory);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        setUploadError(msg ?? 'Erreur lors de la confirmation');
      } else {
        setUploadError('Erreur lors de la confirmation');
      }
    } finally {
      setConfirming(false);
    }
  };

  const handleCancel = () => {
    setPreview(null);
    setUploadError(null);
  };

  return (
    <Card>
      <div className="mb-4">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Import par fichier (Excel / CSV)</h2>
        <p className="text-sm text-gray-500">
          Compatible avec tous les CRM. Exportez vos deals gagnés ou en cours en CSV ou Excel,
          importez-les ici.
        </p>
      </div>

      {/* Zone de drop */}
      {!preview && !confirmResult && !mappingMode && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
            ${dragging ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'}
          `}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={handleInputChange}
          />
          {uploading ? (
            <div className="flex flex-col items-center gap-3">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
              <p className="text-sm text-gray-500">Analyse du fichier en cours…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <svg className="w-10 h-10 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
              <div>
                <p className="text-sm font-medium text-gray-700">Glissez votre fichier ici ou cliquez pour choisir</p>
                <p className="text-xs text-gray-400 mt-1">CSV, Excel (.xlsx, .xls) — max 10 MB</p>
              </div>
            </div>
          )}
        </div>
      )}


      {/* UI Mapping manuel (fallback) */}
      {mappingMode && mappingDetails && (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
            <div className="flex items-start gap-3 mb-4">
              <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold text-amber-800">Certaines colonnes n'ont pas été détectées automatiquement</h3>
                <p className="text-sm text-amber-700 mt-1">
                  Veuillez indiquer la correspondance pour les colonnes manquantes.
                </p>
              </div>
            </div>

            <div className="space-y-3">
              {/* Champs manquants à mapper */}
              {mappingDetails.missing.map((m) => (
                <div key={m.field} className="flex items-center gap-3">
                  <div className="w-40 flex-shrink-0">
                    <span className="text-sm font-medium text-gray-800">{m.label}</span>
                    <span className="ml-1 text-xs text-red-500">*</span>
                  </div>
                  <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                  </svg>
                  <select
                    value={manualMapping[m.field] ?? ''}
                    onChange={(e) => setManualMapping((prev) => ({ ...prev, [m.field]: e.target.value }))}
                    className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                  >
                    <option value="">-- Choisir une colonne --</option>
                    {mappingDetails.allHeaders
                      .filter((h) => h?.trim())
                      .map((h) => (
                        <option key={h} value={h}>{h}</option>
                      ))
                    }
                  </select>
                </div>
              ))}

              {/* Champs déjà détectés (lecture seule) */}
              {mappingDetails.mapped.length > 0 && (
                <div className="pt-3 border-t border-amber-200">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide mb-2">Colonnes détectées automatiquement</p>
                  <div className="space-y-1.5">
                    {mappingDetails.mapped.map((m) => (
                      <div key={m.field} className="flex items-center gap-3 text-sm">
                        <span className="w-40 flex-shrink-0 text-gray-600">{m.label}</span>
                        <svg className="w-3 h-3 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-gray-500 text-xs">colonne &laquo;{m.columnName}&raquo;</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Colonnes non identifiées */}
              {mappingDetails.unmapped.length > 0 && (
                <div className="pt-3 border-t border-amber-200">
                  <p className="text-xs text-gray-400">
                    Colonnes non utilisées : {mappingDetails.unmapped.join(', ')}
                  </p>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-5">
              <Button onClick={handleConfirmMapping} loading={uploading}>
                Confirmer le mapping et importer
              </Button>
              <Button variant="secondary" onClick={handleCancelMapping}>
                Annuler
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Erreur upload */}
      {uploadError && (
        <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
          <p className="text-sm font-medium text-red-700 mb-1">Erreur lors de l'analyse</p>
          <p className="text-sm text-red-600">{uploadError}</p>
          <button
            type="button"
            onClick={() => setUploadError(null)}
            className="mt-2 text-xs text-red-500 hover:underline"
          >
            Réessayer
          </button>
        </div>
      )}

      {/* Résultat confirmation */}
      {confirmResult && (
        <div className={`mt-4 rounded-lg border p-4 ${confirmResult.errors > 0 ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
          <p className={`text-sm font-semibold mb-3 ${confirmResult.errors > 0 ? 'text-amber-800' : 'text-green-800'}`}>
            {confirmResult.errors > 0 ? 'Import terminé avec des erreurs' : 'Import terminé'}
          </p>
          <div className="grid grid-cols-3 gap-4 text-sm text-center">
            <div>
              <p className="text-2xl font-bold text-green-700">{confirmResult.created}</p>
              <p className="text-green-600 text-xs mt-0.5">Deals créés</p>
            </div>
            <div>
              <p className={`text-2xl font-bold ${confirmResult.skipped > 0 ? 'text-blue-600' : 'text-gray-400'}`}>{confirmResult.skipped}</p>
              <p className="text-xs mt-0.5 text-gray-500">Deals mis à jour</p>
            </div>
            <div>
              <p className={`text-2xl font-bold ${confirmResult.errors > 0 ? 'text-red-600' : 'text-gray-400'}`}>{confirmResult.errors}</p>
              <p className="text-xs mt-0.5 text-gray-500">Erreurs</p>
            </div>
          </div>
          <div className="mt-3 flex items-center justify-center gap-4">
            <button
              type="button"
              onClick={() => setConfirmResult(null)}
              className="text-xs text-gray-500 hover:underline"
            >
              Importer un autre fichier
            </button>
          </div>
        </div>
      )}

      {/* Prévisualisation */}
      {preview && (
        <div className="mt-4 space-y-4">
          {/* Récap chiffré */}
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Récapitulatif de l'import</p>
            </div>
            <div className="grid grid-cols-4 divide-x divide-gray-100 text-center">
              <div className="py-4 px-2">
                <p className="text-xl font-bold text-gray-800">{preview.totalRows}</p>
                <p className="text-xs text-gray-500 mt-0.5">Total lignes</p>
              </div>
              <div className="py-4 px-2">
                <p className="text-xl font-bold text-green-600">{preview.validRows}</p>
                <p className="text-xs text-gray-500 mt-0.5">Valides</p>
              </div>
              <div className={`py-4 px-2 ${preview.errorRows > 0 ? 'bg-red-50' : ''}`}>
                <p className={`text-xl font-bold ${preview.errorRows > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {preview.errorRows}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Erreurs</p>
              </div>
              <div className={`py-4 px-2 ${preview.duplicateRows > 0 ? 'bg-amber-50' : ''}`}>
                <p className={`text-xl font-bold ${preview.duplicateRows > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
                  {preview.duplicateRows}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">Doublons</p>
              </div>
            </div>
          </div>

          {/* Commerciaux non reconnus */}
          {preview.unmatchedCommercials > 0 && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
              <p className="text-sm font-medium text-amber-800 mb-1">
                {preview.unmatchedCommercials} commercial{preview.unmatchedCommercials > 1 ? 's' : ''} non reconnu{preview.unmatchedCommercials > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-amber-700 mb-2">
                Ces deals seront importés mais non commissionnés tant que le commercial n'est pas associé à un collaborateur GrowCom (vérifiez que l'email ou le nom correspond exactement à celui enregistré).
              </p>
              <div className="flex flex-wrap gap-1.5">
                {preview.unmatchedIdentifiers.map((identifier) => (
                  <span key={identifier} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded font-mono">
                    {identifier}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Pistes / Opportunités détectées (deals OPEN) */}
          {preview.openRows > 0 && (
            <div className="rounded-lg bg-blue-50 border border-blue-200 p-4">
              <p className="text-sm font-medium text-blue-800 mb-1">
                {preview.openRows} piste{preview.openRows > 1 ? 's' : ''} / opportunité{preview.openRows > 1 ? 's' : ''} détectée{preview.openRows > 1 ? 's' : ''}
              </p>
              <p className="text-xs text-blue-700">
                Ces lignes seront importées en tant que projets en cours (non facturés).
                Elles apparaîtront dans «&nbsp;Mes projections&nbsp;» du commercial, mais ne déclencheront
                pas de commission et ne s'afficheront pas sur le dashboard manager.
              </p>
            </div>
          )}

          {/* Erreurs de validation */}
          {preview.errors.length > 0 && (
            <div className="rounded-lg bg-red-50 border border-red-200 p-4">
              <p className="text-sm font-medium text-red-800 mb-2">
                {preview.errors.length} erreur{preview.errors.length > 1 ? 's' : ''} de validation
              </p>
              <div className="max-h-32 overflow-y-auto space-y-1">
                {preview.errors.map((err, i) => (
                  <p key={i} className="text-xs text-red-600 font-mono">
                    Ligne {err.row}, colonne «{err.column}» : {err.message}
                    {err.value ? ` (valeur : "${err.value}")` : ''}
                  </p>
                ))}
              </div>
            </div>
          )}

          {/* Aperçu des deals valides */}
          {preview.sample.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Aperçu des {preview.sample.length} premier{preview.sample.length > 1 ? 's' : ''} deal{preview.sample.length > 1 ? 's' : ''} valide{preview.sample.length > 1 ? 's' : ''}
              </p>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="text-xs w-full">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Deal</th>
                      <th className="px-3 py-2 text-right font-medium">Montant</th>
                      <th className="px-3 py-2 text-left font-medium">Commercial</th>
                      <th className="px-3 py-2 text-left font-medium">Date clôture</th>
                      <th className="px-3 py-2 text-left font-medium">Statut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.sample.map((row) => (
                      <tr key={row.externalId} className={row.isDuplicate ? 'bg-amber-50' : ''}>
                        <td className="px-3 py-2 font-medium text-gray-800 max-w-[180px] truncate">
                          {row.dealName}
                          {row.isDuplicate && <span className="ml-1 text-amber-500">(doublon)</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-gray-700">
                          {row.amount.toLocaleString('fr-FR')} {row.currency}
                        </td>
                        <td className="px-3 py-2">
                          {row.isUnmatched ? (
                            <span className="text-amber-600">{row.commercialIdentifier} (non reconnu)</span>
                          ) : (
                            <span className="text-gray-700">{row.commercialName ?? row.commercialIdentifier}</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-gray-500">
                          {new Date(row.closedAt).toLocaleDateString('fr-FR')}
                        </td>
                        <td className="px-3 py-2">
                          {row.inferredStatus === 'WON' ? (
                            <span className="inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">Gagné</span>
                          ) : row.inferredStatus === 'LOST' ? (
                            <span className="inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full bg-red-100 text-red-700">Perdu</span>
                          ) : (
                            <span className="inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full bg-blue-100 text-blue-700">En cours</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Boutons confirmer / annuler */}
          <div className="flex gap-3 pt-2">
            <Button
              onClick={() => void handleConfirm()}
              loading={confirming}
              disabled={preview.errorRows > 0 && preview.validRows === 0}
            >
              Confirmer l'import ({preview.validRows} deal{preview.validRows > 1 ? 's' : ''})
            </Button>
            <Button variant="secondary" onClick={handleCancel} disabled={confirming}>
              Annuler
            </Button>
          </div>

          {preview.errorRows > 0 && preview.validRows > 0 && (
            <p className="text-xs text-amber-600">
              Les {preview.errorRows} ligne{preview.errorRows > 1 ? 's' : ''} en erreur seront ignorées.
              Seuls les {preview.validRows} deals valides seront importés.
            </p>
          )}
        </div>
      )}

      {/* Historique des imports */}
      {history.length > 0 && !preview && (
        <div className="mt-6">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Derniers imports</p>
          <div className="space-y-2">
            {history.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between py-2 px-3 rounded-lg bg-gray-50 border border-gray-100"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-700 truncate">{log.fileName}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {new Date(log.createdAt).toLocaleDateString('fr-FR', {
                      day: '2-digit',
                      month: 'short',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                    {' · '}{log.totalRows} ligne{log.totalRows > 1 ? 's' : ''}
                    {log.successRows > 0 && ` · ${log.successRows} créé${log.successRows > 1 ? 's' : ''}`}
                    {log.skippedRows > 0 && ` · ${log.skippedRows} ignoré${log.skippedRows > 1 ? 's' : ''}`}
                  </p>
                </div>
                <ImportStatusBadge status={log.status} />
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
