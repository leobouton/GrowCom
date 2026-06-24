import { useState, useMemo } from 'react';
import axios from 'axios';
import { Button } from '../ui/Button';
import { commissionRuleApiService, type CommissionRuleWithCount } from '../../services/commissionRule.service';
import type { CommissionRuleConfig, CommissionTier, CommissionExample, CommissionCalculationBasis, CommissionPaymentTrigger } from '@shared/types';
import { CommissionRuleType } from '@shared/types';

// ─── Types ────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4 | 5;

interface WizardState {
  step: WizardStep;
  // Step 1 - Identite
  name: string;
  dealType: string;
  // Step 2 - Type
  ruleType: CommissionRuleType;
  // Step 3 - Config
  rate: number;           // pour PERCENTAGE (en %, ex: 10 pour 10%)
  fixedAmount: number;    // pour FIXED
  tiers: CommissionTier[];
  calculationBasis: CommissionCalculationBasis;
  cap: number | null;
  floor: number | null;
  // Step 4 - Paiement
  paymentDelayDays: number | null;
  paymentTrigger: CommissionPaymentTrigger;
  // General
  isSaving: boolean;
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

function parseExistingConfig(config: CommissionRuleConfig): Partial<WizardState> {
  return {
    ruleType: config.type,
    rate: config.rate !== undefined ? config.rate * 100 : 10,
    fixedAmount: config.fixedAmount ?? 500,
    tiers: config.tiers ?? [{ min: 0, max: 10000, rate: 0.08 }, { min: 10000, max: null, rate: 0.12 }],
    calculationBasis: config.calculationBasis ?? 'REVENUE',
    cap: config.cap ?? null,
    floor: config.floor ?? null,
    paymentTrigger: config.paymentTrigger ?? 'DEAL_WON',
  };
}

function generateExamples(state: WizardState): CommissionExample[] {
  const amounts = [5000, 15000, 30000, 50000];
  return amounts.map((saleAmount) => {
    let commission = 0;
    let explanation = '';

    // Apply floor
    if (state.floor && saleAmount < state.floor) {
      return {
        saleAmount,
        commission: 0,
        explanation: `Montant (${formatEur(saleAmount)}) inférieur au seuil minimum de ${formatEur(state.floor)} : pas de commission`,
      };
    }

    const basisLabel = state.calculationBasis === 'MARGIN' ? 'marge' : 'CA';

    if (state.ruleType === CommissionRuleType.PERCENTAGE) {
      const rate = state.rate / 100;
      commission = saleAmount * rate;
      explanation = `${state.rate}% de ${formatEur(saleAmount)} (${basisLabel}) = ${formatEur(commission)}`;
    } else if (state.ruleType === CommissionRuleType.FIXED) {
      commission = state.fixedAmount;
      explanation = `Montant fixe de ${formatEur(state.fixedAmount)} par deal`;
    } else if (state.ruleType === CommissionRuleType.TIERED) {
      const sortedTiers = [...state.tiers].sort((a, b) => a.min - b.min);
      const parts: string[] = [];
      for (const tier of sortedTiers) {
        const tierMax = tier.max ?? Infinity;
        if (saleAmount <= tier.min) break;
        const applicable = Math.min(saleAmount, tierMax) - tier.min;
        const tierCommission = applicable * tier.rate;
        commission += tierCommission;
        parts.push(`${formatEur(applicable)} x ${(tier.rate * 100).toFixed(0)}% = ${formatEur(tierCommission)}`);
      }
      explanation = parts.join(' + ');
    }

    // Apply cap
    if (state.cap && commission > state.cap) {
      explanation += ` (plafonné à ${formatEur(state.cap)})`;
      commission = state.cap;
    }

    return { saleAmount, commission, explanation };
  });
}

function buildDescription(state: WizardState): string {
  const parts: string[] = [];
  const basisLabel = state.calculationBasis === 'MARGIN' ? 'la marge' : 'le chiffre d\'affaires';

  if (state.ruleType === CommissionRuleType.PERCENTAGE) {
    parts.push(`${state.rate}% sur ${basisLabel}`);
  } else if (state.ruleType === CommissionRuleType.FIXED) {
    parts.push(`${formatEur(state.fixedAmount)} fixe par deal`);
  } else if (state.ruleType === CommissionRuleType.TIERED) {
    const sortedTiers = [...state.tiers].sort((a, b) => a.min - b.min);
    const tierDescs = sortedTiers.map((t) =>
      `${(t.rate * 100).toFixed(0)}% de ${formatEur(t.min)} à ${t.max ? formatEur(t.max) : 'l\'infini'}`
    );
    parts.push(`Paliers sur ${basisLabel} : ${tierDescs.join(', ')}`);
  }

  if (state.floor) parts.push(`seuil minimum ${formatEur(state.floor)}`);
  if (state.cap) parts.push(`plafond ${formatEur(state.cap)}`);
  if (state.dealType) parts.push(`applicable aux deals ${state.dealType}`);
  if (state.paymentTrigger === 'CLIENT_PAID') parts.push(`paiement au règlement client`);
  if (state.paymentDelayDays) parts.push(`délai ${state.paymentDelayDays} jours`);

  return parts.join('. ') + '.';
}

function buildConfig(state: WizardState): CommissionRuleConfig {
  const config: CommissionRuleConfig = {
    type: state.ruleType,
    description: buildDescription(state),
    examples: generateExamples(state),
    calculationBasis: state.calculationBasis,
    paymentTrigger: state.paymentTrigger,
  };

  if (state.cap) config.cap = state.cap;
  if (state.floor) config.floor = state.floor;

  if (state.ruleType === CommissionRuleType.PERCENTAGE) {
    config.rate = state.rate / 100;
  } else if (state.ruleType === CommissionRuleType.FIXED) {
    config.fixedAmount = state.fixedAmount;
  } else if (state.ruleType === CommissionRuleType.TIERED) {
    config.tiers = state.tiers;
  }

  return config;
}

// ─── Composant ────────────────────────────────────────────────────────────

export function CommissionWizard({ existingRule, onSuccess, onCancel }: CommissionWizardProps) {
  const isEdit = !!existingRule;
  const existingConfig = isEdit ? parseExistingConfig(existingRule.config as unknown as CommissionRuleConfig) : {};

  const [state, setState] = useState<WizardState>(() => ({
    step: 1,
    name: existingRule?.name ?? '',
    dealType: existingRule?.dealType ?? '',
    ruleType: CommissionRuleType.PERCENTAGE,
    rate: 10,
    fixedAmount: 500,
    tiers: [
      { min: 0, max: 10000, rate: 0.08 },
      { min: 10000, max: null, rate: 0.12 },
    ],
    calculationBasis: 'REVENUE',
    cap: null,
    floor: null,
    paymentDelayDays: existingRule?.paymentDelayDays ?? null,
    paymentTrigger: 'DEAL_WON',
    isSaving: false,
    error: null,
    ...existingConfig,
  }));

  const update = (patch: Partial<WizardState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  // ── Navigation ──

  const goToStep = (step: WizardStep) => update({ step, error: null });
  const goNext = () => goToStep(Math.min(state.step + 1, 5) as WizardStep);
  const goPrev = () => goToStep(Math.max(state.step - 1, 1) as WizardStep);

  const canGoToStep2 = state.name.trim().length > 0;
  const canGoToStep4 = useMemo(() => {
    if (state.ruleType === CommissionRuleType.PERCENTAGE) return state.rate > 0 && state.rate <= 100;
    if (state.ruleType === CommissionRuleType.FIXED) return state.fixedAmount > 0;
    if (state.ruleType === CommissionRuleType.TIERED) return state.tiers.length >= 1;
    return false;
  }, [state.ruleType, state.rate, state.fixedAmount, state.tiers]);

  // ── Tiers helpers ──

  const addTier = () => {
    const lastTier = state.tiers[state.tiers.length - 1];
    const newMin = lastTier?.max ?? (lastTier?.min ?? 0) + 10000;
    update({
      tiers: [...state.tiers, { min: newMin, max: null, rate: 0.15 }],
    });
  };

  const updateTier = (i: number, patch: Partial<CommissionTier>) => {
    const newTiers = state.tiers.map((t, idx) => {
      if (idx !== i) return t;
      const updated = { ...t, ...patch };
      return updated;
    });
    // Auto-chain: quand on change le max d'un palier, ajuster le min du suivant
    if (patch.max !== undefined && i < newTiers.length - 1) {
      newTiers[i + 1] = { ...newTiers[i + 1], min: patch.max ?? newTiers[i + 1].min };
    }
    update({ tiers: newTiers });
  };

  const removeTier = (i: number) => {
    const newTiers = state.tiers.filter((_, idx) => idx !== i);
    // Rechainage auto
    if (newTiers.length > 0) {
      newTiers[newTiers.length - 1] = { ...newTiers[newTiers.length - 1], max: null };
    }
    update({ tiers: newTiers });
  };

  // ── Exemples auto ──

  const examples = useMemo(() => generateExamples(state), [state.ruleType, state.rate, state.fixedAmount, state.tiers, state.cap, state.floor, state.calculationBasis]);

  // ── Soumission ──

  const handleSubmit = async () => {
    update({ isSaving: true, error: null });
    try {
      const config = buildConfig(state);
      const description = buildDescription(state);

      if (isEdit && existingRule) {
        const updated = await commissionRuleApiService.update(existingRule.id, {
          name: state.name,
          description,
          dealType: state.dealType || null,
          paymentDelayDays: state.paymentDelayDays,
          type: state.ruleType,
          config,
        });
        onSuccess({ ...updated, assignmentCount: existingRule.assignmentCount } as CommissionRuleWithCount);
      } else {
        const rule = await commissionRuleApiService.create({
          name: state.name,
          type: state.ruleType,
          config,
          dealType: state.dealType || null,
          paymentDelayDays: state.paymentDelayDays,
        });
        onSuccess({ ...rule, assignmentCount: 0 } as CommissionRuleWithCount);
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const apiMsg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        update({ error: `[${status ?? '?'}] ${apiMsg ?? err.message}`, isSaving: false });
      } else if (err instanceof Error) {
        update({ error: err.message, isSaving: false });
      } else {
        update({ error: 'Erreur inconnue', isSaving: false });
      }
      return;
    }
    update({ isSaving: false });
  };

  // ── Stepper labels ──

  const steps: [WizardStep, string][] = [
    [1, 'Identité'],
    [2, 'Type'],
    [3, 'Configuration'],
    [4, 'Paiement'],
    [5, 'Récapitulatif'],
  ];

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-1">
        {steps.map(([s, label], i) => (
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
            {i < steps.length - 1 && <div className={`flex-1 h-0.5 rounded ${s < state.step ? 'bg-green-300' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* ── Etape 1 : Identite ── */}
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
              placeholder="ex : CDI, CDD, Interim..."
              value={state.dealType}
              onChange={(e) => update({ dealType: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            />
            <p className="mt-1 text-xs text-gray-400">Laissez vide pour une règle applicable à tous les deals</p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onCancel}>Annuler</Button>
            <Button onClick={goNext} disabled={!canGoToStep2}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Etape 2 : Type de commission ── */}
      {state.step === 2 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Quel type de commission ?</h3>
          </div>

          <div className="space-y-3">
            {([
              {
                value: CommissionRuleType.PERCENTAGE,
                label: 'Pourcentage',
                desc: 'Un % du montant de chaque vente',
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l2-2 4 4m0-12a9 9 0 11-6 15.9" />
                  </svg>
                ),
                color: 'blue',
              },
              {
                value: CommissionRuleType.FIXED,
                label: 'Montant fixe',
                desc: 'Un montant fixe par deal signé',
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                ),
                color: 'indigo',
              },
              {
                value: CommissionRuleType.TIERED,
                label: 'Paliers progressifs',
                desc: 'Des taux différents selon les tranches de CA',
                icon: (
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                  </svg>
                ),
                color: 'purple',
              },
            ] as const).map((opt) => {
              const isSelected = state.ruleType === opt.value;
              const colorClasses = {
                blue: { border: 'border-blue-400', bg: 'bg-blue-50', icon: 'text-blue-600', radio: 'border-blue-600', dot: 'bg-blue-600' },
                indigo: { border: 'border-indigo-400', bg: 'bg-indigo-50', icon: 'text-indigo-600', radio: 'border-indigo-600', dot: 'bg-indigo-600' },
                purple: { border: 'border-purple-400', bg: 'bg-purple-50', icon: 'text-purple-600', radio: 'border-purple-600', dot: 'bg-purple-600' },
              }[opt.color];

              return (
                <label
                  key={opt.value}
                  className={`flex items-center gap-4 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    isSelected
                      ? `${colorClasses.border} ${colorClasses.bg}`
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={isSelected}
                    onChange={() => update({ ruleType: opt.value })}
                  />
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    isSelected ? colorClasses.bg : 'bg-gray-100'
                  }`}>
                    <span className={isSelected ? colorClasses.icon : 'text-gray-400'}>
                      {opt.icon}
                    </span>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-800">{opt.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                    isSelected ? colorClasses.radio : 'border-gray-300'
                  }`}>
                    {isSelected && <div className={`w-2.5 h-2.5 rounded-full ${colorClasses.dot}`} />}
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={goPrev}>Retour</Button>
            <Button onClick={goNext}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Etape 3 : Configuration ── */}
      {state.step === 3 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Configurez votre règle</h3>
          </div>

          {/* Config specifique au type */}
          {state.ruleType === CommissionRuleType.PERCENTAGE && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-600">Taux de commission</label>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={1}
                  max={50}
                  step={0.5}
                  value={state.rate}
                  onChange={(e) => update({ rate: parseFloat(e.target.value) })}
                  className="flex-1 h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
                <div className="relative w-24">
                  <input
                    type="number"
                    min={0.1}
                    max={100}
                    step={0.5}
                    value={state.rate}
                    onChange={(e) => update({ rate: parseFloat(e.target.value) || 0 })}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">%</span>
                </div>
              </div>
              <p className="text-xs text-gray-400">
                Pour un deal de {formatEur(10000)}, la commission sera de {formatEur(10000 * state.rate / 100)}
              </p>
            </div>
          )}

          {state.ruleType === CommissionRuleType.FIXED && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-600">Montant fixe par deal</label>
              <div className="relative">
                <input
                  type="number"
                  min={1}
                  step={50}
                  value={state.fixedAmount}
                  onChange={(e) => update({ fixedAmount: parseFloat(e.target.value) || 0 })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2.5 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
                  placeholder="ex : 500"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-400 font-medium">&euro;</span>
              </div>
              <p className="text-xs text-gray-400">
                Chaque deal signé génèrera une commission de {formatEur(state.fixedAmount)}
              </p>
            </div>
          )}

          {state.ruleType === CommissionRuleType.TIERED && (
            <div className="space-y-3">
              <label className="block text-xs font-medium text-gray-600">Paliers de commission</label>
              <div className="space-y-2">
                {state.tiers.map((tier, i) => (
                  <div key={i} className="flex items-center gap-2 bg-purple-50 border border-purple-200 rounded-lg p-3">
                    <div className="flex-1 grid grid-cols-3 gap-2 items-center">
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">De</label>
                        <input
                          type="number"
                          min={0}
                          value={tier.min}
                          onChange={(e) => updateTier(i, { min: parseFloat(e.target.value) || 0 })}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                          placeholder="0"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">
                          {tier.max === null ? 'À (illimité)' : 'À'}
                        </label>
                        <input
                          type="number"
                          min={tier.min + 1}
                          value={tier.max ?? ''}
                          onChange={(e) => updateTier(i, { max: e.target.value ? parseFloat(e.target.value) : null })}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                          placeholder={'\u221E'}
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-medium text-gray-500 mb-0.5">Taux</label>
                        <div className="relative">
                          <input
                            type="number"
                            min={0.1}
                            max={100}
                            step={0.5}
                            value={parseFloat((tier.rate * 100).toFixed(1))}
                            onChange={(e) => updateTier(i, { rate: (parseFloat(e.target.value) || 0) / 100 })}
                            className="w-full border border-gray-300 rounded px-2 py-1.5 pr-6 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-purple-400"
                          />
                          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">%</span>
                        </div>
                      </div>
                    </div>
                    {state.tiers.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTier(i)}
                        className="text-gray-300 hover:text-red-400 p-1"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button
                type="button"
                onClick={addTier}
                className="text-xs text-purple-600 hover:text-purple-700 font-medium flex items-center gap-1"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Ajouter un palier
              </button>
            </div>
          )}

          {/* Separateur */}
          <div className="relative pt-2">
            <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-gray-200" /></div>
            <div className="relative flex justify-center text-xs"><span className="bg-white px-3 text-gray-400">Options avancées</span></div>
          </div>

          {/* Base de calcul */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Base de calcul</label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'REVENUE' as const, label: 'Chiffre d\'affaires', desc: 'Montant total du deal' },
                { value: 'MARGIN' as const, label: 'Marge', desc: 'Marge réalisée sur le deal' },
              ]).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex flex-col p-3 rounded-lg border-2 cursor-pointer transition-colors ${
                    state.calculationBasis === opt.value
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <input
                    type="radio"
                    className="sr-only"
                    checked={state.calculationBasis === opt.value}
                    onChange={() => update({ calculationBasis: opt.value })}
                  />
                  <span className="text-xs font-semibold text-gray-800">{opt.label}</span>
                  <span className="text-[10px] text-gray-400 mt-0.5">{opt.desc}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Floor & Cap */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Seuil minimum (optionnel)</label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={state.floor ?? ''}
                  onChange={(e) => update({ floor: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                  placeholder="Aucun"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">&euro;</span>
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400">En dessous, pas de commission</p>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Plafond (optionnel)</label>
              <div className="relative">
                <input
                  type="number"
                  min={0}
                  step={100}
                  value={state.cap ?? ''}
                  onChange={(e) => update({ cap: e.target.value ? parseFloat(e.target.value) : null })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                  placeholder="Aucun"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">&euro;</span>
              </div>
              <p className="mt-0.5 text-[10px] text-gray-400">Commission maximum par deal</p>
            </div>
          </div>

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={goPrev}>Retour</Button>
            <Button onClick={goNext} disabled={!canGoToStep4}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Etape 4 : Paiement ── */}
      {state.step === 4 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Quand la commission est-elle versée ?</h3>
          </div>

          {/* Declencheur */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Déclencheur de paiement</label>
            <div className="space-y-2">
              {([
                { value: 'DEAL_WON' as const, label: 'Deal signé', desc: 'La commission est due dès la signature du deal', icon: '\u270D\uFE0F' },
                { value: 'CLIENT_PAID' as const, label: 'Règlement client', desc: 'La commission est due quand le client a payé', icon: '\uD83D\uDCB3' },
              ]).map((opt) => (
                <label
                  key={opt.value}
                  className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${
                    state.paymentTrigger === opt.value
                      ? 'border-primary-400 bg-primary-50'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  <input type="radio" className="sr-only" checked={state.paymentTrigger === opt.value} onChange={() => update({ paymentTrigger: opt.value })} />
                  <span className="text-lg">{opt.icon}</span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{opt.label}</p>
                    <p className="text-xs text-gray-500">{opt.desc}</p>
                  </div>
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                    state.paymentTrigger === opt.value ? 'border-primary-600' : 'border-gray-300'
                  }`}>
                    {state.paymentTrigger === opt.value && <div className="w-2 h-2 rounded-full bg-primary-600" />}
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Delai */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Délai de versement (optionnel)</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={730}
                placeholder="ex : 90"
                value={state.paymentDelayDays ?? ''}
                onChange={(e) => update({ paymentDelayDays: e.target.value ? Number(e.target.value) : null })}
                className="block w-28 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
              />
              <span className="text-sm text-gray-500">jours après le déclencheur</span>
            </div>
            <p className="mt-1 text-xs text-gray-400">Laissez vide pour un versement immédiat. Ex : 90 = 3 mois après.</p>
          </div>

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={goPrev}>Retour</Button>
            <Button onClick={goNext}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Etape 5 : Recapitulatif ── */}
      {state.step === 5 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Récapitulatif de la règle</h3>
          </div>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
            {/* Nom */}
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83D\uDCCB'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom</p>
                <p className="text-sm text-gray-800 font-medium">{state.name}</p>
                {state.dealType && (
                  <span className="inline-block mt-1 px-2 py-0.5 bg-yellow-100 text-yellow-700 text-xs rounded-full font-medium">
                    {state.dealType}
                  </span>
                )}
              </div>
            </div>

            {/* Type & config */}
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83D\uDCCA'}</span>
              <div className="flex-1">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Règle de calcul</p>
                {state.ruleType === CommissionRuleType.PERCENTAGE && (
                  <p className="text-sm text-gray-800 font-medium">
                    {state.rate}% sur {state.calculationBasis === 'MARGIN' ? 'la marge' : 'le CA'}
                  </p>
                )}
                {state.ruleType === CommissionRuleType.FIXED && (
                  <p className="text-sm text-gray-800 font-medium">
                    {formatEur(state.fixedAmount)} fixe par deal
                  </p>
                )}
                {state.ruleType === CommissionRuleType.TIERED && (
                  <div className="space-y-1 mt-1">
                    {state.tiers.map((tier, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs bg-white rounded px-2 py-1 border border-gray-100">
                        <span className="text-gray-500">
                          {formatEur(tier.min)} {'\u2192'} {tier.max ? formatEur(tier.max) : '\u221E'}
                        </span>
                        <span className="font-semibold text-primary-700">{(tier.rate * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                    <p className="text-xs text-gray-400 mt-1">
                      Calculé sur {state.calculationBasis === 'MARGIN' ? 'la marge' : 'le CA'}
                    </p>
                  </div>
                )}
                {(state.floor || state.cap) && (
                  <div className="flex gap-2 mt-2">
                    {state.floor && (
                      <span className="inline-block px-2 py-0.5 bg-orange-100 text-orange-700 text-xs rounded-full">
                        Seuil min : {formatEur(state.floor)}
                      </span>
                    )}
                    {state.cap && (
                      <span className="inline-block px-2 py-0.5 bg-red-100 text-red-700 text-xs rounded-full">
                        Plafond : {formatEur(state.cap)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Paiement */}
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\u23F1'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Paiement</p>
                <p className="text-sm text-gray-800 font-medium">
                  {state.paymentTrigger === 'CLIENT_PAID' ? 'Au règlement client' : 'Dès la signature du deal'}
                  {state.paymentDelayDays ? ` + ${state.paymentDelayDays} jours` : ''}
                </p>
              </div>
            </div>
          </div>

          {/* Exemples de calcul */}
          <div className="bg-blue-50 rounded-xl border border-blue-200 p-4">
            <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide mb-3">Exemples de calcul</p>
            <div className="space-y-2">
              {examples.map((ex, i) => (
                <div key={i} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-blue-100">
                  <div className="flex-1">
                    <span className="text-xs text-gray-500">Vente de {formatEur(ex.saleAmount)}</span>
                    <p className="text-[10px] text-gray-400">{ex.explanation}</p>
                  </div>
                  <span className={`text-sm font-bold ${ex.commission > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                    {formatEur(ex.commission)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {state.error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{state.error}</p>
            </div>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={goPrev}>Modifier</Button>
            <Button onClick={() => void handleSubmit()} loading={state.isSaving}>
              {isEdit ? 'Enregistrer' : 'Créer la règle'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
