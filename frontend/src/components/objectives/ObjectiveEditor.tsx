import type { Objective, ObjectivePeriodType, ObjectiveBonus, ObjectiveBonusMode, ObjectiveBonusTier, ObjectiveRecurrence } from '@shared/types';
import { format } from 'date-fns';

// ─── Constantes ────────────────────────────────────────────────────────────

export const UNIT_OPTIONS = [
  { value: '€', label: '€ (euros)' },
  { value: 'marge', label: 'Marge (€)' },
  { value: 'deals', label: 'Deals signés' },
  { value: '%', label: '% (pourcentage)' },
];

export const MONTHS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

const currentYear = new Date().getFullYear();
export const YEARS = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

const PERIOD_TYPE_OPTIONS: { value: ObjectivePeriodType; label: string; description: string }[] = [
  { value: 'monthly',   label: 'Mensuel',     description: 'Un mois précis' },
  { value: 'quarterly', label: 'Trimestriel', description: 'T1, T2, T3 ou T4' },
  { value: 'semester',  label: 'Semestriel',  description: 'S1 ou S2' },
  { value: 'annual',    label: 'Annuel',       description: 'Toute une année' },
  { value: 'custom',    label: 'Personnalisé', description: 'Plage de dates libre' },
];

// ─── Types ────────────────────────────────────────────────────────────────

export interface ObjectiveEditorProps {
  obj: Objective;
  index: number;
  onChange: <K extends keyof Objective>(id: string, field: K, value: Objective[K]) => void;
  onRemove: (id: string) => void;
  hiddenRemove?: boolean;
}

// ─── Composant principal ──────────────────────────────────────────────────

export function ObjectiveEditor({ obj, index, onChange, onRemove, hiddenRemove }: ObjectiveEditorProps) {
  const bonus = obj.bonus ?? { enabled: false, type: 'percentage' as const, value: 10 };
  const bonusMode: ObjectiveBonusMode = obj.bonusMode ?? (bonus.enabled ? 'simple' : 'none');
  const tiers: ObjectiveBonusTier[] = obj.bonusTiers ?? [];
  const recurrence: ObjectiveRecurrence = obj.recurrence ?? 'none';
  const recurrenceEnabled = recurrence !== 'none';

  const setBonus = (patch: Partial<ObjectiveBonus>) => {
    onChange(obj.id, 'bonus', { ...bonus, ...patch });
  };

  const setBonusMode = (mode: ObjectiveBonusMode) => {
    onChange(obj.id, 'bonusMode', mode);
    if (mode === 'simple') onChange(obj.id, 'bonus', { ...bonus, enabled: true });
    if (mode === 'none') onChange(obj.id, 'bonus', { ...bonus, enabled: false });
  };

  const addTier = () => {
    const lastThreshold = tiers.length > 0 ? tiers[tiers.length - 1].threshold : 0;
    const newTier: ObjectiveBonusTier = {
      threshold: Math.min(lastThreshold + 20, 200),
      reward: { type: 'fixed', value: 100 },
    };
    onChange(obj.id, 'bonusTiers', [...tiers, newTier]);
  };

  const updateTier = (i: number, patch: Partial<ObjectiveBonusTier>) => {
    const updated = tiers.map((t, idx) => idx === i ? { ...t, ...patch } : t);
    onChange(obj.id, 'bonusTiers', updated);
  };

  const removeTier = (i: number) => {
    onChange(obj.id, 'bonusTiers', tiers.filter((_, idx) => idx !== i));
  };

  const previewTiers = [...tiers].sort((a, b) => a.threshold - b.threshold)
    .map((t) => `À ${t.threshold}% → +${t.reward.type === 'fixed' ? `${t.reward.value}€` : `${t.reward.value}% CA`}`)
    .join(' | ');

  return (
    <div className="border border-gray-200 rounded-xl p-4 bg-gray-50/50 space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Objectif {index + 1}</span>
        {!hiddenRemove && (
          <button type="button" onClick={() => onRemove(obj.id)} className="text-gray-300 hover:text-red-500 transition-colors">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Intitulé</label>
        <input type="text" placeholder="ex : CA T1, Deals signés janvier…" value={obj.label} onChange={(e) => onChange(obj.id, 'label', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Cible</label>
          <input type="number" min="0" placeholder="50 000" value={obj.target} onChange={(e) => onChange(obj.id, 'target', parseFloat(e.target.value) || 0)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Unité</label>
          <select value={obj.unit} onChange={(e) => onChange(obj.id, 'unit', e.target.value)} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {UNIT_OPTIONS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-2">Période</label>
        <div className="grid grid-cols-2 gap-2">
          {PERIOD_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className={`flex items-center gap-2 p-2.5 rounded-lg border-2 cursor-pointer transition-colors ${obj.periodType === opt.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300 bg-white'}`}>
              <input type="radio" className="sr-only" checked={obj.periodType === opt.value} onChange={() => onChange(obj.id, 'periodType', opt.value)} />
              <div><p className="text-xs font-semibold text-gray-800">{opt.label}</p><p className="text-xs text-gray-400">{opt.description}</p></div>
            </label>
          ))}
        </div>
      </div>

      <PeriodFields obj={obj} onChange={onChange} />

      {/* ── Prime de dépassement ── */}
      <div className="border-t border-gray-200 pt-4 space-y-3">
        <p className="text-xs font-semibold text-gray-700">Prime de dépassement</p>
        <div className="grid grid-cols-3 gap-2">
          {([
            { value: 'none',   label: 'Pas de prime',        desc: '' },
            { value: 'simple', label: 'Prime simple',        desc: '' },
            { value: 'tiered', label: 'Paliers personnalisés', desc: '' },
          ] as { value: ObjectiveBonusMode; label: string; desc: string }[]).map((opt) => (
            <label key={opt.value} className={`flex flex-col gap-0.5 p-2 rounded-lg border-2 cursor-pointer text-center transition-colors ${bonusMode === opt.value ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white hover:border-gray-300'}`}>
              <input type="radio" className="sr-only" checked={bonusMode === opt.value} onChange={() => setBonusMode(opt.value)} />
              <span className="text-xs font-semibold text-gray-800">{opt.label}</span>
            </label>
          ))}
        </div>

        {bonusMode === 'simple' && (
          <div className="space-y-3 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <div className="grid grid-cols-2 gap-2">
              <label className={`flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer ${bonus.type === 'percentage' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" className="sr-only" checked={bonus.type === 'percentage'} onChange={() => setBonus({ type: 'percentage' })} />
                <div><p className="text-xs font-semibold text-gray-800">% des ventes</p><p className="text-xs text-gray-400">Au-dessus de la cible</p></div>
              </label>
              <label className={`flex items-center gap-2 p-2 rounded-lg border-2 cursor-pointer ${bonus.type === 'fixed' ? 'border-amber-400 bg-amber-50' : 'border-gray-200 bg-white'}`}>
                <input type="radio" className="sr-only" checked={bonus.type === 'fixed'} onChange={() => setBonus({ type: 'fixed' })} />
                <div><p className="text-xs font-semibold text-gray-800">Montant fixe</p><p className="text-xs text-gray-400">Dès l'objectif atteint</p></div>
              </label>
            </div>
            <div className="relative">
              <input type="number" min="0" step={bonus.type === 'percentage' ? '0.5' : '50'} value={bonus.value} onChange={(e) => setBonus({ value: parseFloat(e.target.value) || 0 })} className="w-full border border-gray-300 rounded-lg px-3 py-2 pr-8 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white" />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">{bonus.type === 'percentage' ? '%' : '€'}</span>
            </div>
          </div>
        )}

        {bonusMode === 'tiered' && (
          <div className="space-y-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
            {tiers.length > 0 && (
              <div className="space-y-1.5">
                <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-gray-500 px-1">
                  <span>Seuil (%)</span><span>Type</span><span>Montant</span><span />
                </div>
                {tiers.map((tier, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-center">
                    <input
                      type="number" min="1" max="200" value={tier.threshold}
                      onChange={(e) => updateTier(i, { threshold: parseInt(e.target.value) || 1 })}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
                    <select
                      value={tier.reward.type}
                      onChange={(e) => updateTier(i, { reward: { ...tier.reward, type: e.target.value as 'fixed' | 'percentage' } })}
                      className="border border-gray-300 rounded-lg px-1 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    >
                      <option value="fixed">Fixe (€)</option>
                      <option value="percentage">% CA</option>
                    </select>
                    <input
                      type="number" min="0" value={tier.reward.value}
                      onChange={(e) => updateTier(i, { reward: { ...tier.reward, value: parseFloat(e.target.value) || 0 } })}
                      className="border border-gray-300 rounded-lg px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-1 focus:ring-amber-400"
                    />
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
            {previewTiers && (
              <p className="text-xs text-gray-500 italic mt-1">Aperçu : {previewTiers}</p>
            )}
          </div>
        )}
      </div>

      {/* ── Récurrence ── */}
      <div className="border-t border-gray-200 pt-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-gray-700">Objectif récurrent</p>
            <p className="text-xs text-gray-400">Se régénère automatiquement chaque période</p>
          </div>
          <button
            type="button"
            onClick={() => onChange(obj.id, 'recurrence', recurrenceEnabled ? 'none' : 'monthly')}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${recurrenceEnabled ? 'bg-primary-500' : 'bg-gray-200'}`}
          >
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${recurrenceEnabled ? 'translate-x-4.5' : 'translate-x-0.5'}`} />
          </button>
        </div>

        {recurrenceEnabled && (
          <div className="space-y-3 bg-blue-50 border border-blue-200 rounded-xl p-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-2">Fréquence</label>
              <div className="grid grid-cols-4 gap-2">
                {([
                  { value: 'monthly',   label: 'Mensuel' },
                  { value: 'quarterly', label: 'Trimestriel' },
                  { value: 'semester',  label: 'Semestriel' },
                  { value: 'annual',    label: 'Annuel' },
                ] as { value: ObjectiveRecurrence; label: string }[]).map((opt) => (
                  <label key={opt.value} className={`flex items-center justify-center p-2 rounded-lg border-2 cursor-pointer text-xs font-medium transition-colors ${recurrence === opt.value ? 'border-blue-400 bg-blue-100 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>
                    <input type="radio" className="sr-only" checked={recurrence === opt.value} onChange={() => onChange(obj.id, 'recurrence', opt.value)} />
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
                onChange={(e) => onChange(obj.id, 'recurrenceEndDate', e.target.value || undefined)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
              />
            </div>
            {obj.recurrenceEndDate && (
              <p className="text-xs text-blue-600">
                Cet objectif sera généré chaque {recurrence === 'monthly' ? 'mois' : recurrence === 'quarterly' ? 'trimestre' : recurrence === 'semester' ? 'semestre' : 'an'} jusqu'au {format(new Date(obj.recurrenceEndDate), 'dd/MM/yyyy')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Champs de période dynamiques ─────────────────────────────────────────

interface PeriodFieldsProps {
  obj: Objective;
  onChange: <K extends keyof Objective>(id: string, field: K, value: Objective[K]) => void;
}

function PeriodFields({ obj, onChange }: PeriodFieldsProps) {
  if (obj.periodType === 'monthly') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Mois</label>
          <select value={obj.month ?? 1} onChange={(e) => onChange(obj.id, 'month', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
          <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
    );
  }
  if (obj.periodType === 'quarterly') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Trimestre</label>
          <div className="grid grid-cols-4 gap-1">
            {[1, 2, 3, 4].map((q) => (
              <button key={q} type="button" onClick={() => onChange(obj.id, 'quarter', q)} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${obj.quarter === q ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>T{q}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
          <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
    );
  }
  if (obj.periodType === 'semester') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Semestre</label>
          <div className="grid grid-cols-2 gap-1">
            {[1, 2].map((s) => (
              <button key={s} type="button" onClick={() => onChange(obj.id, 'semester', s)} className={`py-2 rounded-lg text-xs font-semibold border-2 transition-colors ${obj.semester === s ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300'}`}>S{s}</button>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
          <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
            {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
      </div>
    );
  }
  if (obj.periodType === 'annual') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Année</label>
        <select value={obj.year ?? currentYear} onChange={(e) => onChange(obj.id, 'year', Number(e.target.value))} className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white">
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </div>
    );
  }
  if (obj.periodType === 'custom') {
    return (
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date de début</label>
          <input type="date" value={obj.startDate ?? ''} onChange={(e) => onChange(obj.id, 'startDate', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Date de fin</label>
          <input type="date" value={obj.endDate ?? ''} min={obj.startDate ?? undefined} onChange={(e) => onChange(obj.id, 'endDate', e.target.value)} className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white" />
        </div>
      </div>
    );
  }
  return null;
}
