import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import { hubspotApiService, type HubspotSyncResult } from '../../services/hubspot.service';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';

const configSchema = z.object({
  hubspotToken: z.string().min(1, 'Token requis'),
});

type ConfigFormData = z.infer<typeof configSchema>;

interface HubspotConnectionPanelProps {
  initialConfig: { configured: boolean; hubspotPortalId: string | null };
  /** Remonte au parent le nouveau statut « connecté » (pour le badge sur le logo). */
  onConfiguredChange: (configured: boolean) => void;
}

export function HubspotConnectionPanel({ initialConfig, onConfiguredChange }: HubspotConnectionPanelProps) {
  const [configured, setConfigured]         = useState(initialConfig.configured);
  const [hubspotPortalId, setPortalId]      = useState<string | null>(initialConfig.hubspotPortalId);
  const [syncing, setSyncing]               = useState(false);
  const [syncResult, setSyncResult]         = useState<HubspotSyncResult | null>(null);
  const [syncError, setSyncError]           = useState<string | null>(null);
  const [saveError, setSaveError]           = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ConfigFormData>({
    resolver: zodResolver(configSchema),
  });

  const onSaveConfig = async (data: ConfigFormData) => {
    setSaveError(null);
    try {
      const result = await hubspotApiService.configure(data);
      setConfigured(result.configured);
      setPortalId(result.hubspotPortalId ?? null);
      onConfiguredChange(result.configured);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        setSaveError(msg ?? err.message);
      } else {
        setSaveError('Erreur lors de la sauvegarde');
      }
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    setSyncError(null);
    try {
      const result = await hubspotApiService.sync();
      setSyncResult(result);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const msg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        setSyncError(msg ?? 'Erreur lors de la synchronisation');
      } else if (err instanceof Error) {
        setSyncError(err.message);
      } else {
        setSyncError('Erreur inconnue lors de la synchronisation');
      }
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Configuration de la connexion */}
      <Card>
        <h2 className="text-base font-semibold text-gray-900 mb-4">Configuration de la connexion HubSpot</h2>

        {configured && (
          <div className="mb-4 p-3 bg-green-50 rounded-lg text-sm text-green-800 space-y-0.5">
            <p>Connexion établie avec votre compte HubSpot</p>
            {hubspotPortalId && <p>Portail : <strong>{hubspotPortalId}</strong></p>}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(onSaveConfig)(e)} className="space-y-4">
          <Input
            label="Token de votre Private App HubSpot"
            type="password"
            placeholder="pat-eu1-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            hint="HubSpot → Paramètres → Intégrations → Applications privées"
            error={errors.hubspotToken?.message}
            {...register('hubspotToken')}
          />

          {saveError && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{saveError}</p>
            </div>
          )}

          <Button type="submit" variant="secondary" loading={isSubmitting}>
            {configured ? 'Mettre à jour la configuration' : 'Enregistrer la configuration'}
          </Button>
        </form>
      </Card>

      {/* Guide rapide */}
      {!configured && (
        <Card>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
            <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Comment obtenir votre token HubSpot ?
          </h2>
          <ol className="space-y-2 text-sm text-gray-600">
            <li className="flex gap-2"><span className="font-bold text-primary-600">1.</span> <span className="min-w-0">Connectez-vous à HubSpot avec un compte administrateur</span></li>
            <li className="flex gap-2"><span className="font-bold text-primary-600">2.</span> <span className="min-w-0">Allez dans <strong>Paramètres</strong> (icône engrenage) → <strong>Intégrations</strong> → <strong>Applications privées</strong></span></li>
            <li className="flex gap-2"><span className="font-bold text-primary-600">3.</span> <span className="min-w-0">Cliquez <strong>Créer une application privée</strong>, nommez-la "GrowCom"</span></li>
            <li className="flex gap-2">
              <span className="font-bold text-primary-600">4.</span>
              <span className="min-w-0">
                Onglet <strong>Périmètres</strong> : cochez ces 3 autorisations :
                <span className="mt-1.5 flex flex-col gap-1">
                  <code className="bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 text-xs break-all">crm.objects.deals.read</code>
                  <code className="bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 text-xs break-all">crm.objects.companies.read</code>
                  <code className="bg-gray-100 text-gray-700 rounded px-1.5 py-0.5 text-xs break-all">crm.objects.owners.read</code>
                </span>
              </span>
            </li>
            <li className="flex gap-2"><span className="font-bold text-primary-600">5.</span> <span className="min-w-0">Créez l'application et copiez le <strong>token d'accès</strong></span></li>
          </ol>
          <p className="text-xs text-amber-600 mt-3 font-medium">Conservez ce token en lieu sûr — il donne accès à vos données HubSpot.</p>
        </Card>
      )}

      {/* Synchronisation manuelle */}
      {configured && (
        <Card>
          <h2 className="text-base font-semibold text-gray-900 mb-1">Synchronisation manuelle</h2>
          <div className="flex items-center gap-2 mb-3">
            <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs text-green-700 font-medium">Synchronisation automatique active — vos deals sont importés toutes les heures</p>
          </div>
          <p className="text-sm text-gray-500 mb-4">
            Utilisez ce bouton pour importer vos deals immédiatement sans attendre le prochain cycle automatique.
            Les deals sont associés aux commerciaux GrowCom par correspondance de l'adresse e-mail du propriétaire HubSpot.
          </p>

          <Button onClick={() => void handleSync()} loading={syncing}>
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            {syncing ? 'Synchronisation en cours...' : 'Lancer la synchronisation'}
          </Button>

          {syncError && (
            <div className="mt-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm font-medium text-red-700 mb-1">Échec de la synchronisation</p>
              <p className="text-sm text-red-600">{syncError}</p>
            </div>
          )}

          {syncResult && (
            <div className="mt-4 space-y-3">
              <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                <p className="text-sm font-semibold text-green-800 mb-3">Synchronisation terminée !</p>
                <div className="grid grid-cols-3 gap-4 text-sm text-center">
                  <div>
                    <p className="text-2xl font-bold text-green-700">{syncResult.synced}</p>
                    <p className="text-green-600 text-xs mt-0.5">Total traités</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-700">{syncResult.created}</p>
                    <p className="text-green-600 text-xs mt-0.5">Créés</p>
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-green-700">{syncResult.updated}</p>
                    <p className="text-green-600 text-xs mt-0.5">Mis à jour</p>
                  </div>
                </div>
              </div>

              {syncResult.errors.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-4">
                  <p className="text-sm font-medium text-amber-800 mb-2">
                    {syncResult.errors.length} deal{syncResult.errors.length > 1 ? 's' : ''} non associé{syncResult.errors.length > 1 ? 's' : ''}
                  </p>
                  <p className="text-xs text-amber-700 mb-2">
                    Ces deals existent dans HubSpot mais aucun commercial GrowCom ne correspond (e-mail du propriétaire introuvable).
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {syncResult.errors.map((err, i) => (
                      <p key={i} className="text-xs text-amber-600 font-mono">{err}</p>
                    ))}
                  </div>
                </div>
              )}

              {syncResult.synced > 0 && syncResult.errors.length === 0 && (
                <p className="text-xs text-gray-500 text-center">
                  Tous les deals ont été associés correctement.
                </p>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
