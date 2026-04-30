import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import axios from 'axios';
import { odooApiService } from '../../services/odoo.service';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';
import type { OdooSyncResult } from '@shared/types';

const configSchema = z.object({
  odooUrl:      z.string().url('URL invalide (ex: https://mon-instance.odoo.com)'),
  odooDatabase: z.string().min(1, 'Nom de la base de données requis'),
  odooLogin:    z.string().email('Email Odoo invalide (ex: jean@mon-entreprise.com)'),
  odooApiKey:   z.string().min(1, 'Clé API requise'),
});

type ConfigFormData = z.infer<typeof configSchema>;

export function OdooPage() {
  const [configured, setConfigured]     = useState(false);
  const [odooUrl, setOdooUrl]           = useState<string | null>(null);
  const [odooLogin, setOdooLogin]       = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [syncing, setSyncing]           = useState(false);
  const [syncResult, setSyncResult]     = useState<OdooSyncResult | null>(null);
  const [syncError, setSyncError]       = useState<string | null>(null);
  const [saveError, setSaveError]       = useState<string | null>(null);

  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<ConfigFormData>({
    resolver: zodResolver(configSchema),
  });

  useEffect(() => {
    const load = async () => {
      try {
        const config = await odooApiService.getConfig();
        setConfigured(config.configured);
        setOdooUrl(config.odooUrl);
        setOdooLogin(config.odooLogin ?? null);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const onSaveConfig = async (data: ConfigFormData) => {
    setSaveError(null);
    try {
      const result = await odooApiService.configure(data);
      setConfigured(result.configured);
      setOdooUrl(result.odooUrl);
      setOdooLogin(result.odooLogin ?? null);
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
      const result = await odooApiService.sync();
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

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" /></div>;
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Connexion CRM</h1>
        <p className="text-gray-500 mt-1">Connectez votre Odoo pour importer vos deals automatiquement</p>
      </div>

      {/* Statut connexion */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold text-gray-900">Configuration de la connexion</h2>
          {configured ? <Badge variant="green">Connecté</Badge> : <Badge variant="gray">Non connecté</Badge>}
        </div>

        {configured && odooUrl && (
          <div className="mb-4 p-3 bg-green-50 rounded-lg text-sm text-green-800 space-y-0.5">
            <p>Instance : <strong>{odooUrl}</strong></p>
            {odooLogin && <p>Compte : <strong>{odooLogin}</strong></p>}
          </div>
        )}

        <form onSubmit={(e) => void handleSubmit(onSaveConfig)(e)} className="space-y-4">
          <Input
            label="URL de votre instance Odoo"
            placeholder="https://mon-entreprise.odoo.com"
            hint="L'URL complète de votre Odoo, sans slash à la fin"
            error={errors.odooUrl?.message}
            {...register('odooUrl')}
          />
          <Input
            label="Nom de la base de données"
            placeholder="mon-entreprise"
            hint="Généralement le sous-domaine de votre URL Odoo"
            error={errors.odooDatabase?.message}
            {...register('odooDatabase')}
          />
          <Input
            label="Email de connexion Odoo"
            type="email"
            placeholder="jean@mon-entreprise.com"
            hint="L'email avec lequel vous vous connectez à Odoo"
            error={errors.odooLogin?.message}
            {...register('odooLogin')}
          />
          <Input
            label="Clé API Odoo"
            type="password"
            placeholder="Votre clé API Odoo"
            hint="Odoo → Préférences → Sécurité du compte → Clés API"
            error={errors.odooApiKey?.message}
            {...register('odooApiKey')}
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
            Comment obtenir votre clé API Odoo ?
          </h2>
          <ol className="space-y-2 text-sm text-gray-600">
            <li className="flex gap-2"><span className="font-bold text-primary-600">1.</span> Connectez-vous à Odoo avec votre compte</li>
            <li className="flex gap-2"><span className="font-bold text-primary-600">2.</span> Cliquez sur votre avatar (en haut à droite) → <strong>Préférences</strong></li>
            <li className="flex gap-2"><span className="font-bold text-primary-600">3.</span> Onglet <strong>Sécurité du compte</strong> → section <strong>Clés API</strong></li>
            <li className="flex gap-2"><span className="font-bold text-primary-600">4.</span> Cliquez <strong>Nouvelle clé API</strong>, nommez-la "GrowCom" et copiez-la</li>
          </ol>
          <p className="text-xs text-amber-600 mt-3 font-medium">La clé n'est affichée qu'une seule fois — copiez-la immédiatement !</p>
        </Card>
      )}

      {/* Synchronisation */}
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
            Les deals sont associés aux commerciaux GrowCom par correspondance exacte du prénom + adresse e-mail (double vérification).
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
                    Ces deals existent dans Odoo mais aucun commercial GrowCom ne correspond (prénom + e-mail introuvables).
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
