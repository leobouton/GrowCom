import React, { useState, useMemo } from 'react';
import { Button } from './ui/Button';
import type { Objective, ObjectivePeriodType, ObjectiveBonus, ObjectiveBonusMode, ObjectiveBonusTier, ObjectiveRecurrence } from '@shared/types';
import { format } from 'date-fns';

// ─── Constantes ────────────────────────────────────────────────────────────

const UNIT_OPTIONS = [
  { value: '€', label: '€ (euros)', metricLabel: 'Chiffre d\'affaires (CA)' },
  { value: 'marge', label: 'Marge (€)', metricLabel: 'Marge réalisée sur les deals' },
  { value: 'deals', label: 'Deals signés', metricLabel: 'Nombre de deals signés' },
  { value: '%', label: '% (pourcentage)', metricLabel: 'Taux (pourcentage)' },
];

const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const currentYear = new Date().getFullYear();
const YEARS = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

// ─── Types ─────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

interface ObjectiveWizardProps {
  initialObjective?: Objective;
  onSubmit: (objective: Objective) => void;
  onCancel: () => void;
  loading?: boolean;
  submitLabel?: string;
  renderStep4Extra?: () => React.ReactNode;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Composant principal ───────────────────────────────────────────────────

export function ObjectiveWizard({ initialObjective, onSubmit, onCancel, loading, submitLabel = 'Créer l\'objectif', renderStep4Extra }: ObjectiveWizardProps) {
  const isEdit = !!initialObjective?.label;

  const [step, setStep] = useState<WizardStep>(1);
  const [obj, setObj] = useState<Objective>(() => initialObjective ?? {
    id: generateId(),
    label: '',
    target: 0,
    unit: '€',
    periodType: 'monthly',
    month: new Date().getMonth() + 1,
    year: currentYear,
    bonus: { enabled: false, type: 'percentage', value: 10 },
    bonusMode: 'none',
    bonusTiers: [],
    recurrence: 'none',
  });

  const update = <K extends keyof Objective>(field: K, value: Objective[K]) => {
    setObj((prev) => {
      const updated = { ...prev, [field]: value };
      // Nettoyer les champs de période lors du changement de type
      if (field === 'periodType') {
        delete updated.month; delete updated.quarter; delete updated.startDate; delete updated.endDate;
        const pt = value as ObjectivePeriodType;
        if (pt === 'monthly') { updated.month = new Date().getMonth() + 1; updated.year = currentYear; }
        if (pt === 'quarterly') { updated.quarter = Math.ceil((new Date().getMonth() + 1) / 3); updated.year = currentYear; }
        if (pt === 'annual') { updated.year = currentYear; }
      }
      return updated;
    });
  };

  const bonus = obj.bonus ?? { enabled: false, type: 'percentage' as const, value: 10 };
  const bonusMode: ObjectiveBonusMode = obj.bonusMode ?? (bonus.enabled ? 'simple' : 'none');
  const tiers: ObjectiveBonusTier[] = obj.bonusTiers ?? [];
  const recurrence: ObjectiveRecurrence = obj.recurrence ?? 'none';
  const recurrenceEnabled = recurrence !== 'none';

  // ── Validation par étape ──
  const canGoToStep2 = useMemo(() => {
    if (recurrenceEnabled) return true;
    if (obj.periodType === 'monthly') return !!(obj.month && obj.year);
    if (obj.periodType === 'quarterly') return !!(obj.quarter && obj.year);
    if (obj.periodType === 'annual') return !!obj.year;
    if (obj.periodType === 'custom') return !!(obj.startDate && obj.endDate);
    return false;
  }, [obj, recurrenceEnabled]);

  const canGoToStep3 = obj.target > 0 && obj.label.trim().length > 0;

  const goNext = () => setStep((s) => Math.min(s + 1, 4) as WizardStep);
  const goPrev = () => setStep((s) => Math.max(s - 1, 1) as WizardStep);

  const handleSubmit = () => {
    // S'assurer que le bonus est cohérent avec le mode
    const finalObj = { ...obj };
    if (bonusMode === 'none') {
      finalObj.bonus = { enabled: false, type: 'percentage', value: 0 };
    } else if (bonusMode === 'simple') {
      finalObj.bonus = { ...bonus, enabled: true };
    }
    finalObj.bonusMode = bonusMode;
    onSubmit(finalObj);
  };

  // ── Helpers bonus ──
  const setBonus = (patch: Partial<ObjectiveBonus>) => update('bonus', { ...bonus, ...patch });
  const setBonusMode = (mode: ObjectiveBonusMode) => {
    update('bonusMode', mode);
    if (mode === 'simple') update('bonus', { ...bonus, enabled: true });
    if (mode === 'none') update('bonus', { ...bonus, enabled: false });
  };
  const addTier = () => {
    const lastThreshold = tiers.length > 0 ? tiers[tiers.length - 1].threshold : 0;
    update('bonusTiers', [...tiers, { threshold: Math.min(lastThreshold + 20, 200), reward: { type: 'fixed', value: 100 } }]);
  };
  const updateTier = (i: number, patch: Partial<ObjectiveBonusTier>) => {
    update('bonusTiers', tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t));
  };
  const removeTier = (i: number) => update('bonusTiers', tiers.filter((_, idx) => idx !== i));

  // ── Formattage période pour récap ──
  const periodSummary = useMemo(() => {
    if (recurrenceEnabled) {
      const freq = recurrence === 'monthly' ? 'Mensuel' : recurrence === 'quarterly' ? 'Trimestriel' : 'Annuel';
      const until = obj.recurrenceEndDate ? ` jusqu'au ${format(new Date(obj.recurrenceEndDate), 'dd/MM/yyyy')}` : '';
      return `${freq}${until}`;
    }
    switch (obj.periodType) {
      case 'monthly': return `${MONTHS[(obj.month ?? 1) - 1]} ${obj.year ?? currentYear}`;
      case 'quarterly': return `T${obj.quarter ?? 1} ${obj.year ?? currentYear}`;
      case 'annual': return `Année ${obj.year ?? currentYear}`;
      case 'custom':
        if (obj.startDate && obj.endDate) {
          return `${format(new Date(obj.startDate), 'dd/MM/yyyy')} → ${format(new Date(obj.endDate), 'dd/MM/yyyy')}`;
        }
        return 'Période personnalisée';
      default: return '';
    }
  }, [obj, recurrenceEnabled, recurrence]);

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-1">
        {([
          [1, 'Période'],
          [2, 'Cible'],
          [3, 'Prime'],
          [4, 'Confirmation'],
        ] as [WizardStep, string][]).map(([s, label], i) => (
          <div key={s} className="flex items-center gap-1 flex-1">
            <button
              type="button"
              onClick={() => {
                // Permettre de revenir en arrière librement
                if (s < step) setStep(s);
              }}
              className={`flex items-center gap-1.5 text-xs font-semibold px-2 py-1 rounded-full transition-colors ${
                s === step ? 'bg-primary-100 text-primary-700' :
                s < step ? 'bg-green-100 text-green-700 cursor-pointer hover:bg-green-200' :
                'bg-gray-100 text-gray-400'
              }`}
            >
              <span className={`w-5 h-5 flex items-center justify-center rounded-full text-xs font-bold ${
                s === step ? 'bg-primary-600 text-white' :
                s < step ? 'bg-green-500 text-white' :
                'bg-gray-300 text-white'
              }`}>
                {s < step ? '✓' : s}
              </span>
              <span className="hidden sm:inline">{label}</span>
            </button>
            {i < 3 && <div className={`flex-1 h-0.5 rounded ${s < step ? 'bg-green-300' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* ── Étape 1 : Période ── */}
      {step === 1 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Quand cet objectif s'applique-t-il ?</h3>
          </div>

          {/* Type de période */}
          <div className="space-y-3">
            {([
              { value: 'single-monthly', label: 'Sur un seul mois', pt: 'monthly' },
              { value: 'single-quarterly', label: 'Sur un seul trimestre', pt: 'quarterly' },
              { value: 'single-annual', label: 'Sur une seule année', pt: 'annual' },
              { value: 'recurrent', label: 'Récurrent (renouvelé automatiquement)', pt: null },
            ] as { value: string; label: string; pt: ObjectivePeriodType | null }[]).map((opt) => {
              const isSelected = opt.value === 'recurrent'
                ? recurrenceEnabled
                : !recurrenceEnabled && obj.periodType === opt.pt;
              return (
                <label key={opt.value} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${isSelected ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <input
                    type="radio"
                    className="sr-only"
                    checked={isSelected}
                    onChange={() => {
                      if (opt.value === 'recurrent') {
                        update('recurrence', 'monthly');
                        update('periodType', 'monthly');
                      } else {
                        update('recurrence', 'none');
                        update('periodType', opt.pt!);
                      }
                    }}
                  />
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${isSelected ? 'border-primary-600' : 'border-gray-300'}`}>
                    {isSelected && <div className="w-2 h-2 rounded-full bg-primary-600" />}
                  </div>
                  <span className="text-sm font-medium text-gray-800">{opt.label}</span>
                </label>
              );
            })}
          </div>

          {/* Détails récurrence */}
          {recurrenceEnabled && (
            <div className="space-y-3 bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-2">Fréquence</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { value: 'monthly', label: 'Mensuel' },
                    { value: 'quarterly', label: 'Trimestriel' },
                    { value: 'annual', label: 'Annuel' },
                  ] as { value: ObjectiveRecurrence; label: string }[]).map((opt) => (
                    <label key={opt.value} className={`flex items-center justify-center p-2 rounded-lg border-2 cursor-pointer text-xs font-medium transition-colors ${recurrence === opt.value ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                      <input type="radio" className="sr-only" checked={recurrence === opt.value} onChange={() => update('recurrence', opt.value)} />
                      {opt.label}
                    </label>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Jusqu'au</label>
                <input
                  type="date"
                  value={obj.recurrenceEndDate ?? ''}
                  onChange={(e) => update('recurrenceEndDate', e.target.value || undefined)}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                />
              </div>
            </div>
          )}

          {/* Détails période non récurrente */}
          {!recurrenceEnabled && (
            <div className="space-y-3">
              {obj.periodType === 'monthly' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Mois</label>
                    <select value={obj.month ?? 1} onChange={(e) => update('month', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
                      {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
                    <select value={obj.year ?? currentYear} onChange={(e) => update('year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
                      {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {obj.periodType === 'quarterly' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Trimestre</label>
                    <div className="grid grid-cols-4 gap-1">
                      {[1, 2, 3, 4].map((q) => (
                        <button key={q} type="button" onClick={() => update('quarter', q)} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${obj.quarter === q ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>T{q}</button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
                    <select value={obj.year ?? currentYear} onChange={(e) => update('year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
                      {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                    </select>
                  </div>
                </div>
              )}
              {obj.periodType === 'annual' && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
                  <select value={obj.year ?? currentYear} onChange={(e) => update('year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
                    {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
                  </select>
                </div>
              )}
              {obj.periodType === 'custom' && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Date de début</label>
                    <input type="date" value={obj.startDate ?? ''} onChange={(e) => update('startDate', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Date de fin</label>
                    <input type="date" value={obj.endDate ?? ''} min={obj.startDate ?? undefined} onChange={(e) => update('endDate', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onCancel}>Annuler</Button>
            <Button onClick={goNext} disabled={!canGoToStep2}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Étape 2 : Cible ── */}
      {step === 2 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Quel objectif fixer ?</h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Intitulé</label>
            <input
              type="text"
              placeholder="ex : CA T1, Deals signés janvier..."
              value={obj.label}
              onChange={(e) => update('label', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Cible</label>
              <input
                type="number"
                min="0"
                placeholder="50 000"
                value={obj.target || ''}
                onChange={(e) => update('target', parseFloat(e.target.value) || 0)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Unité</label>
              <select value={obj.unit} onChange={(e) => update('unit', e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
                {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Calculé sur</label>
            <div className="space-y-2">
              {UNIT_OPTIONS.map((u) => (
                <label key={u.value} className={`flex items-center gap-3 p-2.5 rounded-lg border-2 cursor-pointer transition-colors ${obj.unit === u.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                  <input type="radio" className="sr-only" checked={obj.unit === u.value} onChange={() => update('unit', u.value)} />
                  <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${obj.unit === u.value ? 'border-primary-600' : 'border-gray-300'}`}>
                    {obj.unit === u.value && <div className="w-2 h-2 rounded-full bg-primary-600" />}
                  </div>
                  <span className="text-sm text-gray-800">{u.metricLabel}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={goPrev}>Retour</Button>
            <Button onClick={goNext} disabled={!canGoToStep3}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Étape 3 : Prime ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Quelle prime accorder ?</h3>
          </div>

          <div className="space-y-2">
            {([
              { value: 'none' as const, label: 'Aucune prime', desc: '' },
              { value: 'simple' as const, label: 'Prime simple (à 100% d\'atteinte)', desc: '' },
              { value: 'tiered' as const, label: 'Paliers personnalisés', desc: '' },
            ]).map((opt) => (
              <label key={opt.value} className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-colors ${bonusMode === opt.value ? 'border-amber-400 bg-amber-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
                <input type="radio" className="sr-only" checked={bonusMode === opt.value} onChange={() => setBonusMode(opt.value)} />
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${bonusMode === opt.value ? 'border-amber-500' : 'border-gray-300'}`}>
                  {bonusMode === opt.value && <div className="w-2 h-2 rounded-full bg-amber-500" />}
                </div>
                <span className="text-sm font-medium text-gray-800">{opt.label}</span>
              </label>
            ))}
          </div>

          {/* Détails prime simple */}
          {bonusMode === 'simple' && (
            <div className="space-y-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
              <div className="grid grid-cols-2 gap-2">
                <label className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer ${bonus.type === 'percentage' ? 'border-amber-400 bg-amber-100' : 'border-gray-200 bg-white'}`}>
                  <input type="radio" className="sr-only" checked={bonus.type === 'percentage'} onChange={() => setBonus({ type: 'percentage' })} />
                  <div><p className="text-xs font-semibold text-gray-800">% des ventes</p><p className="text-xs text-gray-400">Au-dessus de la cible</p></div>
                </label>
                <label className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer ${bonus.type === 'fixed' ? 'border-amber-400 bg-amber-100' : 'border-gray-200 bg-white'}`}>
                  <input type="radio" className="sr-only" checked={bonus.type === 'fixed'} onChange={() => setBonus({ type: 'fixed' })} />
                  <div><p className="text-xs font-semibold text-gray-800">Montant fixe</p><p className="text-xs text-gray-400">Dès l'objectif atteint</p></div>
                </label>
              </div>
              <div className="relative">
                <input type="number" min="0" step={bonus.type === 'percentage' ? '0.5' : '50'} value={bonus.value} onChange={(e) => setBonus({ value: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" placeholder="Montant" />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">{bonus.type === 'percentage' ? '%' : '€'}</span>
              </div>
            </div>
          )}

          {/* Détails paliers */}
          {bonusMode === 'tiered' && (
            <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-xl p-4">
              {tiers.length > 0 && (
                <div className="space-y-1.5">
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-gray-500 px-1">
                    <span>Seuil (%)</span><span>Type</span><span>Montant</span><span />
                  </div>
                  {tiers.map((tier, i) => (
                    <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                      <input type="number" min="1" max="200" value={tier.threshold} onChange={(e) => updateTier(i, { threshold: parseInt(e.target.value) || 1 })} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      <select value={tier.reward.type} onChange={(e) => updateTier(i, { reward: { ...tier.reward, type: e.target.value as 'fixed' | 'percentage' } })} className="border border-gray-300 rounded-lg px-1 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400">
                        <option value="fixed">Fixe (€)</option>
                        <option value="percentage">% CA</option>
                      </select>
                      <input type="number" min="0" value={tier.reward.value} onChange={(e) => updateTier(i, { reward: { ...tier.reward, value: parseFloat(e.target.value) || 0 } })} className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400" />
                      <button type="button" onClick={() => removeTier(i)} className="text-gray-300 hover:text-red-400">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button type="button" onClick={addTier} className="text-xs text-amber-600 hover:text-amber-700 font-medium flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                Ajouter un palier
              </button>
            </div>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={goPrev}>Retour</Button>
            <Button onClick={goNext}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Étape 4 : Récapitulatif ── */}
      {step === 4 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Récapitulatif</h3>
          </div>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
            {/* Période */}
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">📅</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Période</p>
                <p className="text-sm text-gray-800 font-medium">{periodSummary}</p>
              </div>
            </div>

            {/* Cible */}
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">🎯</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Cible</p>
                <p className="text-sm text-gray-800 font-medium">
                  {obj.label} : {obj.target.toLocaleString('fr-FR')} {obj.unit}{recurrenceEnabled ? ` par ${recurrence === 'monthly' ? 'mois' : recurrence === 'quarterly' ? 'trimestre' : 'an'}` : ''}
                </p>
              </div>
            </div>

            {/* Prime */}
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">💰</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Prime</p>
                {bonusMode === 'none' && <p className="text-sm text-gray-500 italic">Aucune prime</p>}
                {bonusMode === 'simple' && (
                  <p className="text-sm text-gray-800 font-medium">
                    {bonus.type === 'percentage'
                      ? `${bonus.value}% des ventes au-dessus de la cible`
                      : `${formatEur(bonus.value)} dès l'objectif atteint`}
                  </p>
                )}
                {bonusMode === 'tiered' && tiers.length > 0 && (
                  <div className="space-y-1 mt-1">
                    {[...tiers].sort((a, b) => a.threshold - b.threshold).map((t, i) => (
                      <p key={i} className="text-sm text-gray-800">
                        • {t.threshold}% atteint → +{t.reward.type === 'fixed' ? formatEur(t.reward.value) : `${t.reward.value}% CA`}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Slot pour contenu supplémentaire (ex: "Affecter à") */}
          {renderStep4Extra && renderStep4Extra()}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={goPrev}>Modifier</Button>
            <Button onClick={handleSubmit} loading={loading}>{isEdit ? 'Enregistrer' : submitLabel}</Button>
          </div>
        </div>
      )}
    </div>
  );
}
