import { useState } from 'react';
import axios from 'axios';
import { Button } from '../ui/Button';
import { commissionRuleApiService, type CommissionRuleWithCount } from '../../services/commissionRule.service';
import type { CommissionRuleConfig } from '@shared/types';
import { CommissionRuleType } from '@shared/types';

// ─── Types ────────────────────────────────────────────────────────────────

interface CommissionWizardState {
  step: 1 | 2 | 3;
  name: string;
  dealType: string;
  paymentDelayDays: number | null;
  description: string;
  generatedConfig: CommissionRuleConfig | null;
  isGenerating: boolean;
  error: string | null;
}

interface CommissionWizardProps {
  existingRule?: CommissionRuleWithCount;
  onSuccess: (rule: CommissionRuleWithCount) => void;
  onCancel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

function describeConfig(config: CommissionRuleConfig): string {
  if (config.type === CommissionRuleType.PERCENTAGE && config.rate !== undefined) {
    return `${(config.rate * 100).toFixed(0)}% du montant de chaque vente`;
  }
  if (config.type === CommissionRuleType.FIXED && config.fixedAmount !== undefined) {
    return `${formatEur(config.fixedAmount)} fixe par vente`;
  }
  if (config.tiers && config.tiers.length > 0) {
    return config.tiers.map((t) =>
      `${formatEur(t.min)} → ${t.max ? formatEur(t.max) : '\u221E'} : ${(t.rate * 100).toFixed(0)}%`
    ).join(' | ');
  }
  return config.description ?? '';
}

// ─── Composant ────────────────────────────────────────────────────────────

export function CommissionWizard({ existingRule, onSuccess, onCancel }: CommissionWizardProps) {
  const isEdit = !!existingRule;

  const [state, setState] = useState<CommissionWizardState>(() => ({
    step: isEdit ? 1 : 1,
    name: existingRule?.name ?? '',
    dealType: existingRule?.dealType ?? '',
    paymentDelayDays: existingRule?.paymentDelayDays ?? null,
    description: existingRule?.description ?? '',
    generatedConfig: isEdit ? (existingRule.config as unknown as CommissionRuleConfig) : null,
    isGenerating: false,
    error: null,
  }));

  const [showAdvanced, setShowAdvanced] = useState(!!state.paymentDelayDays);

  const update = (patch: Partial<CommissionWizardState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  // ── Navigation ──

  const goToStep = (step: 1 | 2 | 3) => update({ step, error: null });

  const canGoToStep2 = state.name.trim().length > 0;

  const canGoToStep3 = state.description.trim().length > 0 || state.generatedConfig !== null;

  // ── Génération IA ──

  const handleGenerate = async () => {
    if (!state.description.trim()) {
      update({ error: 'Décrivez votre règle en au moins quelques mots' });
      return;
    }
    update({ isGenerating: true, error: null });
    try {
      if (isEdit && existingRule) {
        const rule = await commissionRuleApiService.update(existingRule.id, {
          name: state.name,
          description: state.description,
          dealType: state.dealType || null,
          paymentDelayDays: state.paymentDelayDays,
        });
        update({
          generatedConfig: rule.config as unknown as CommissionRuleConfig,
          isGenerating: false,
        });
      } else {
        const rule = await commissionRuleApiService.generate({
          name: state.name,
          description: state.description,
          dealType: state.dealType || null,
          paymentDelayDays: state.paymentDelayDays,
        });
        update({
          generatedConfig: rule.config as unknown as CommissionRuleConfig,
          isGenerating: false,
        });
        // En création, on passe directement au récap avec la règle générée
        // La règle est déjà créée côté serveur via generate
        onSuccess({ ...rule, assignmentCount: 0 } as CommissionRuleWithCount);
        return;
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const apiMsg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        update({ error: `[${status ?? '?'}] ${apiMsg ?? err.message}`, isGenerating: false });
      } else if (err instanceof Error) {
        update({ error: err.message, isGenerating: false });
      } else {
        update({ error: 'Erreur inconnue', isGenerating: false });
      }
      return;
    }
    // En édition, passer au récap
    goToStep(3);
  };

  // ── Soumission ──

  const handleSubmit = async () => {
    // En édition, la mise à jour a déjà été faite via handleGenerate
    // On notifie juste le parent
    if (isEdit && existingRule) {
      onSuccess({ ...existingRule, name: state.name, description: state.description, dealType: state.dealType || null, paymentDelayDays: state.paymentDelayDays, config: state.generatedConfig } as unknown as CommissionRuleWithCount);
    }
  };

  // Avancer vers étape 3 : si on a pas encore généré et qu'on a une description, on génère d'abord
  const goToStep3 = async () => {
    if (!state.generatedConfig && state.description.trim()) {
      await handleGenerate();
      // handleGenerate gère le passage au step 3 ou le succès
      return;
    }
    goToStep(3);
  };

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-1">
        {([
          [1, 'Identité'],
          [2, 'Règle'],
          [3, 'Récapitulatif'],
        ] as [1 | 2 | 3, string][]).map(([s, label], i) => (
          <div key={s} className="flex items-center gap-1 flex-1">
            <button
              type="button"
              onClick={() => { if (s < state.step) goToStep(s); }}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full transition-colors ${
                s === state.step ? 'bg-primary-100 text-primary-700' :
                s < state.step ? 'bg-green-100 text-green-700 cursor-pointer hover:bg-green-200' :
                'bg-gray-100 text-gray-400'
              }`}
            >
              <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                s === state.step ? 'bg-primary-600 text-white' :
                s < state.step ? 'bg-green-500 text-white' :
                'bg-gray-300 text-white'
              }`}>
                {s < state.step ? '\u2713' : s}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < 2 && <div className={`flex-1 h-0.5 rounded ${s < state.step ? 'bg-green-300' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* ── Étape 1 : Identité ── */}
      {state.step === 1 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Nommez votre règle de commission</h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nom de la règle</label>
            <input
              type="text"
              placeholder="ex : Commission CDI Senior"
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type de deal (optionnel)</label>
            <input
              type="text"
              placeholder="ex : CDI, CDD, Intérim..."
              value={state.dealType}
              onChange={(e) => update({ dealType: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            />
            <p className="mt-1 text-xs text-gray-400">Laissez vide pour une règle applicable à tous les deals</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onCancel}>Annuler</Button>
            <Button onClick={() => goToStep(2)} disabled={!canGoToStep2}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Étape 2 : Règle ── */}
      {state.step === 2 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Définissez la règle de calcul</h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Décrivez en langage naturel
            </label>
            <textarea
              className="block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
              rows={4}
              placeholder="ex : 10% sur toutes les ventes, 15% au-dessus de 10 000\u20AC de CA mensuel, avec un palier à 20% au-dessus de 25 000\u20AC..."
              value={state.description}
              onChange={(e) => update({ description: e.target.value, generatedConfig: null })}
            />
            {isEdit && (
              <p className="mt-1 text-xs text-gray-400">
                Modifier la description recalcule automatiquement le barème via l'IA.
              </p>
            )}
          </div>

          <Button
            onClick={() => void handleGenerate()}
            loading={state.isGenerating}
            disabled={!state.description.trim()}
            className="w-full"
          >
            {state.isGenerating
              ? (isEdit ? 'Recalcul IA en cours...' : 'Génération en cours...')
              : '\u2728 Générer avec l\'IA'}
          </Button>

          <div className="relative">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
            <div className="relative flex justify-center text-xs"><span className="bg-white px-3 text-gray-400">Options avancées</span></div>
          </div>

          <div>
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors"
            >
              <svg className={`w-3.5 h-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              Délai de paiement
            </button>
            {showAdvanced && (
              <div className="mt-3 pl-5">
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={730}
                    placeholder="ex : 90"
                    value={state.paymentDelayDays ?? ''}
                    onChange={(e) => update({ paymentDelayDays: e.target.value ? Number(e.target.value) : null })}
                    className="block w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                  />
                  <span className="text-sm text-gray-500">jours après la signature</span>
                </div>
                <p className="mt-1 text-xs text-gray-400">Laissez vide pour un paiement immédiat.</p>
              </div>
            )}
          </div>

          {state.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{state.error}</p>
            </div>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={() => goToStep(1)}>Retour</Button>
            <Button
              onClick={() => void goToStep3()}
              disabled={!canGoToStep3}
              loading={state.isGenerating}
            >
              Suivant
            </Button>
          </div>
        </div>
      )}

      {/* ── Étape 3 : Récapitulatif ── */}
      {state.step === 3 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Récapitulatif</h3>
          </div>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83D\uDCCB'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom</p>
                <p className="text-sm text-gray-800 font-medium">{state.name}</p>
              </div>
            </div>

            {state.dealType && (
              <div className="flex items-start gap-3">
                <span className="text-base mt-0.5">{'\uD83D\uDD27'}</span>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Type de deal</p>
                  <p className="text-sm text-gray-800 font-medium">{state.dealType}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83D\uDCCA'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Règle</p>
                {state.generatedConfig ? (
                  <p className="text-sm text-gray-800 font-medium">{describeConfig(state.generatedConfig)}</p>
                ) : (
                  <p className="text-sm text-gray-500 italic">{state.description}</p>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\u23F1'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Délai</p>
                <p className="text-sm text-gray-800 font-medium">
                  {state.paymentDelayDays
                    ? `${state.paymentDelayDays} jours après la signature`
                    : 'Paiement immédiat'}
                </p>
              </div>
            </div>
          </div>

          {state.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{state.error}</p>
            </div>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={() => goToStep(2)}>Modifier</Button>
            <Button onClick={() => void handleSubmit()}>
              {isEdit ? 'Enregistrer' : 'Créer la règle'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
