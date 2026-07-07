import { useState } from 'react';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { componentBadge, validateComponent } from './planDisplay';
import type { GeneratedPlanComponentDraft, CommissionTier, ObjectiveBonusTier } from '@shared/types';
import { CommissionRuleType } from '@shared/types';

/**
 * Édition manuelle d'un composant du plan : valeurs numériques, nom/libellé,
 * ajout/suppression de paliers (commissions ET primes d'objectifs), et options
 * avancées (base de calcul, fréquence, déclencheur de paiement, période,
 * récurrence). La refonte complète de la logique passe par le re-prompt IA.
 */

function NumberField({
  label, value, onChange, suffix, step = 1, allowEmpty = false,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix: string;
  step?: number;
  allowEmpty?: boolean;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-gray-500">{label}</span>
      <div className="flex items-center gap-1.5 mt-0.5">
        <input
          type="number"
          step={step}
          min={0}
          value={value ?? ''}
          placeholder={allowEmpty ? '—' : undefined}
          onChange={(e) => {
            if (e.target.value === '') {
              onChange(allowEmpty ? null : 0);
              return;
            }
            const v = Number(e.target.value);
            if (Number.isFinite(v)) onChange(v);
          }}
          className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
        />
        <span className="text-xs text-gray-400">{suffix}</span>
      </div>
    </label>
  );
}

function SelectField({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium text-gray-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="block mt-0.5 border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

/** Sélecteur à puces (3 modes de prime d'objectif). */
function ChipSelector({
  value, onChange, options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
            value === o.value
              ? 'bg-primary-600 text-white border-primary-600'
              : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ComponentInlineEditor({
  component,
  index,
}: {
  component: GeneratedPlanComponentDraft;
  index: number;
}) {
  const replaceComponent = useVariablePlanStore((s) => s.replaceComponent);
  const removeComponent = useVariablePlanStore((s) => s.removeComponent);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const badge = componentBadge(component);
  const validationError = validateComponent(component);

  const updateConfig = (patch: Record<string, unknown>) => {
    if (component.kind !== 'COMMISSION_RULE') return;
    replaceComponent(index, { ...component, config: { ...component.config, ...patch } });
  };

  const updateName = (name: string) => {
    if (component.kind === 'COMMISSION_RULE') {
      replaceComponent(index, { ...component, name });
    } else {
      replaceComponent(index, { ...component, objective: { ...component.objective, label: name } });
    }
  };

  const updateObjective = (patch: Record<string, unknown>) => {
    if (component.kind !== 'OBJECTIVE') return;
    replaceComponent(index, { ...component, objective: { ...component.objective, ...patch } });
  };

  // ── Paliers de commission (TIERED) ──
  const updateTier = (tierIndex: number, patch: Partial<CommissionTier>) => {
    if (component.kind !== 'COMMISSION_RULE' || !component.config.tiers) return;
    const tiers = component.config.tiers.map((t, i) => (i === tierIndex ? { ...t, ...patch } : t));
    // Chaînage : le min du palier suivant suit le max modifié
    if (patch.max !== undefined && patch.max !== null && tierIndex < tiers.length - 1) {
      tiers[tierIndex + 1] = { ...tiers[tierIndex + 1], min: patch.max };
    }
    updateConfig({ tiers });
  };

  const addTier = () => {
    if (component.kind !== 'COMMISSION_RULE') return;
    const tiers = [...(component.config.tiers ?? [])];
    if (tiers.length === 0) {
      updateConfig({ tiers: [{ min: 0, max: null, rate: 0.05 }] });
      return;
    }
    // Le dernier palier (ouvert) est fermé à min + 50 000 €, un nouveau palier ouvert prend la suite
    const last = tiers[tiers.length - 1];
    const closingMax = last.min + 50000;
    tiers[tiers.length - 1] = { ...last, max: closingMax };
    tiers.push({ min: closingMax, max: null, rate: last.rate });
    updateConfig({ tiers });
  };

  const removeTier = (tierIndex: number) => {
    if (component.kind !== 'COMMISSION_RULE' || !component.config.tiers) return;
    const tiers = component.config.tiers.filter((_, i) => i !== tierIndex);
    // Re-chaînage : chaque min suit le max précédent, le dernier palier reste ouvert
    for (let i = 0; i < tiers.length; i++) {
      if (i > 0 && tiers[i - 1].max !== null) tiers[i] = { ...tiers[i], min: tiers[i - 1].max! };
      if (i === tiers.length - 1) tiers[i] = { ...tiers[i], max: null };
    }
    updateConfig({ tiers });
  };

  // ── Primes d'objectif : mode + paliers ──
  const bonusMode = component.kind === 'OBJECTIVE'
    ? (component.objective.bonusMode
        ?? (component.objective.bonusTiers && component.objective.bonusTiers.length > 0
          ? 'tiered'
          : component.objective.bonus?.enabled ? 'simple' : 'none'))
    : 'none';

  const setBonusMode = (mode: string) => {
    if (component.kind !== 'OBJECTIVE') return;
    const o = component.objective;
    if (mode === 'none') {
      updateObjective({ bonusMode: 'none', bonus: { enabled: false, type: o.bonus?.type ?? 'fixed', value: o.bonus?.value ?? 0 } });
    } else if (mode === 'simple') {
      updateObjective({ bonusMode: 'simple', bonus: { enabled: true, type: o.bonus?.type ?? 'fixed', value: o.bonus?.value || 500 } });
    } else {
      const bonusTiers = o.bonusTiers && o.bonusTiers.length > 0
        ? o.bonusTiers
        : [{ threshold: 100, reward: { type: 'fixed' as const, value: 500 } }];
      updateObjective({ bonusMode: 'tiered', bonusTiers, bonus: { enabled: false, type: o.bonus?.type ?? 'fixed', value: o.bonus?.value ?? 0 } });
    }
  };

  const updateBonusTier = (tierIndex: number, patch: { threshold?: number; rewardValue?: number; rewardType?: 'fixed' | 'percentage' }) => {
    if (component.kind !== 'OBJECTIVE' || !component.objective.bonusTiers) return;
    const bonusTiers: ObjectiveBonusTier[] = component.objective.bonusTiers.map((t, i) =>
      i === tierIndex
        ? {
            threshold: patch.threshold ?? t.threshold,
            reward: { type: patch.rewardType ?? t.reward.type, value: patch.rewardValue ?? t.reward.value },
          }
        : t,
    );
    updateObjective({ bonusTiers });
  };

  const addBonusTier = () => {
    if (component.kind !== 'OBJECTIVE') return;
    const tiers = [...(component.objective.bonusTiers ?? [])];
    const last = tiers[tiers.length - 1];
    tiers.push({
      threshold: (last?.threshold ?? 90) + 10,
      reward: { type: last?.reward.type ?? 'fixed', value: last?.reward.value ?? 500 },
    });
    updateObjective({ bonusTiers: tiers, bonusMode: 'tiered' });
  };

  const removeBonusTier = (tierIndex: number) => {
    if (component.kind !== 'OBJECTIVE' || !component.objective.bonusTiers) return;
    const bonusTiers = component.objective.bonusTiers.filter((_, i) => i !== tierIndex);
    if (bonusTiers.length === 0) {
      // Plus aucun palier → retour au mode « sans prime » en une seule mise à jour
      updateObjective({
        bonusTiers: [],
        bonusMode: 'none',
        bonus: { enabled: false, type: component.objective.bonus?.type ?? 'fixed', value: component.objective.bonus?.value ?? 0 },
      });
      return;
    }
    updateObjective({ bonusTiers });
  };

  const name = component.kind === 'COMMISSION_RULE' ? component.name : component.objective.label;

  return (
    <Card padding="sm" className={validationError ? 'border-red-300' : undefined}>
      {/* En-tête : nom éditable + badge + suppression */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <input
          type="text"
          value={name}
          onChange={(e) => updateName(e.target.value)}
          className="flex-1 min-w-0 text-sm font-semibold text-gray-800 bg-transparent border border-transparent rounded-lg px-1.5 py-0.5 -ml-1.5 hover:border-gray-200 focus:border-gray-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary-400 transition-colors"
          title="Cliquez pour renommer"
        />
        <Badge variant={badge.variant}>{badge.label}</Badge>
        <button
          type="button"
          onClick={() => removeComponent(index)}
          className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
          title="Retirer ce composant du plan"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>

      {component.kind === 'COMMISSION_RULE' ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            {component.config.type === CommissionRuleType.PERCENTAGE && (
              <NumberField
                label="Taux"
                suffix="%"
                step={0.5}
                value={Math.round(((component.config.rate ?? 0) * 100) * 100) / 100}
                onChange={(v) => updateConfig({ rate: (v ?? 0) / 100 })}
              />
            )}
            {(component.config.type === CommissionRuleType.FIXED || component.config.calculationBasis === 'PER_UNIT') && (
              <NumberField
                label={component.config.calculationBasis === 'PER_UNIT' ? 'Montant / consultant / mois' : 'Montant fixe'}
                suffix="€"
                step={10}
                value={component.config.fixedAmount ?? 0}
                onChange={(v) => updateConfig({ fixedAmount: v ?? 0 })}
              />
            )}
            {component.config.type === CommissionRuleType.TIERED && component.config.tiers && (
              <div className="w-full space-y-1.5">
                <span className="text-[11px] font-medium text-gray-500">Paliers</span>
                {component.config.tiers.map((tier, ti) => (
                  <div key={ti} className="flex items-center gap-2 text-xs text-gray-500">
                    <span>de</span>
                    <input
                      type="number" min={0} value={tier.min}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateTier(ti, { min: v }); }}
                      className="w-20 border border-gray-300 rounded px-1.5 py-0.5 text-right bg-white"
                    />
                    <span>à</span>
                    <input
                      type="number" min={0} value={tier.max ?? ''} placeholder="∞"
                      disabled={ti === (component.config.tiers?.length ?? 0) - 1}
                      onChange={(e) => {
                        const v = e.target.value === '' ? null : Number(e.target.value);
                        if (v === null || Number.isFinite(v)) updateTier(ti, { max: v });
                      }}
                      className="w-20 border border-gray-300 rounded px-1.5 py-0.5 text-right bg-white disabled:bg-gray-50"
                    />
                    <span>€ :</span>
                    <input
                      type="number" min={0} step={0.5} value={Math.round(tier.rate * 100 * 100) / 100}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateTier(ti, { rate: v / 100 }); }}
                      className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-right bg-white"
                    />
                    <span>%</span>
                    {(component.config.tiers?.length ?? 0) > 1 && (
                      <button
                        type="button"
                        onClick={() => removeTier(ti)}
                        className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                        title="Supprimer ce palier"
                      >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addTier}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline"
                >
                  + Ajouter un palier
                </button>
              </div>
            )}
          </div>

          {/* Options avancées */}
          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="text-[11px] font-medium text-gray-400 hover:text-gray-600 transition-colors"
          >
            {showAdvanced ? '▾ Masquer les options avancées' : '▸ Options avancées (base de calcul, fréquence, plafond…)'}
          </button>
          {showAdvanced && (
            <div className="flex flex-wrap gap-x-5 gap-y-3 pt-1 border-t border-gray-100">
              {component.config.calculationBasis !== 'PER_UNIT' && (
                <SelectField
                  label="Base de calcul"
                  value={component.config.calculationBasis ?? 'REVENUE'}
                  onChange={(v) => updateConfig({ calculationBasis: v })}
                  options={[
                    { value: 'REVENUE', label: 'Montant de la vente (CA)' },
                    { value: 'MARGIN', label: 'Marge' },
                  ]}
                />
              )}
              <SelectField
                label="Fréquence"
                value={component.config.appliesToEventType ?? 'DEAL_WON'}
                onChange={(v) => updateConfig({ appliesToEventType: v })}
                options={[
                  { value: 'DEAL_WON', label: 'One-shot (à la vente)' },
                  { value: 'MISSION_MONTH', label: 'Récurrent (chaque mois de mission)' },
                ]}
              />
              <SelectField
                label="Versement"
                value={component.config.paymentTrigger ?? 'DEAL_WON'}
                onChange={(v) => updateConfig({ paymentTrigger: v })}
                options={[
                  { value: 'DEAL_WON', label: 'Dès la vente gagnée' },
                  { value: 'CLIENT_PAID', label: 'Quand le client a payé' },
                ]}
              />
              <NumberField
                label="Seuil minimum"
                suffix="€" step={100} allowEmpty
                value={component.config.floor ?? null}
                onChange={(v) => updateConfig({ floor: v ?? undefined })}
              />
              <NumberField
                label="Plafond"
                suffix="€" step={100} allowEmpty
                value={component.config.cap ?? null}
                onChange={(v) => updateConfig({ cap: v ?? undefined })}
              />
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-x-5 gap-y-3">
            <NumberField
              label="Cible"
              suffix={component.objective.unit === 'deals' ? 'ventes' : '€'}
              step={component.objective.unit === 'deals' ? 1 : 1000}
              value={component.objective.target}
              onChange={(v) => updateObjective({ target: v ?? 0 })}
            />
            <SelectField
              label="Mesuré sur"
              value={component.objective.unit}
              onChange={(v) => updateObjective({ unit: v })}
              options={[
                { value: '€', label: 'Chiffre d\'affaires (€)' },
                { value: 'marge', label: 'Marge (€)' },
                { value: 'deals', label: 'Ventes signées' },
              ]}
            />
            <SelectField
              label="Période"
              value={component.objective.periodType}
              onChange={(v) => updateObjective({ periodType: v })}
              options={[
                { value: 'monthly', label: 'Mensuelle' },
                { value: 'quarterly', label: 'Trimestrielle' },
                { value: 'semester', label: 'Semestrielle' },
                { value: 'annual', label: 'Annuelle' },
              ]}
            />
            <SelectField
              label="Récurrence"
              value={component.objective.recurrence ?? 'none'}
              onChange={(v) => updateObjective({ recurrence: v })}
              options={[
                { value: 'none', label: 'Ponctuel (une seule fois)' },
                { value: 'monthly', label: 'Se renouvelle chaque mois' },
                { value: 'quarterly', label: 'Se renouvelle chaque trimestre' },
                { value: 'semester', label: 'Se renouvelle chaque semestre' },
                { value: 'annual', label: 'Se renouvelle chaque année' },
              ]}
            />
          </div>

          {/* Prime : aucune / simple / par paliers */}
          <div className="pt-2 border-t border-gray-100 space-y-2">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-[11px] font-medium text-gray-500">Prime d'objectif :</span>
              <ChipSelector
                value={bonusMode}
                onChange={setBonusMode}
                options={[
                  { value: 'none', label: 'Aucune' },
                  { value: 'simple', label: 'Prime simple' },
                  { value: 'tiered', label: 'Par paliers' },
                ]}
              />
            </div>

            {bonusMode === 'simple' && component.objective.bonus && (
              <div className="flex flex-wrap gap-x-5 gap-y-3">
                <SelectField
                  label="Type de prime"
                  value={component.objective.bonus.type}
                  onChange={(v) => updateObjective({ bonus: { ...component.objective.bonus!, type: v } })}
                  options={[
                    { value: 'fixed', label: 'Montant fixe (€)' },
                    { value: 'percentage', label: '% du dépassement' },
                  ]}
                />
                <NumberField
                  label={component.objective.bonus.type === 'fixed' ? 'Prime de dépassement' : 'Prime (% du dépassement)'}
                  suffix={component.objective.bonus.type === 'fixed' ? '€' : '%'}
                  step={component.objective.bonus.type === 'fixed' ? 50 : 1}
                  value={component.objective.bonus.value}
                  onChange={(v) => updateObjective({ bonus: { ...component.objective.bonus!, value: v ?? 0 } })}
                />
              </div>
            )}

            {bonusMode === 'tiered' && (
              <div className="w-full space-y-1.5">
                {(component.objective.bonusTiers ?? []).map((tier, ti) => (
                  <div key={ti} className="flex items-center gap-2 text-xs text-gray-500 flex-wrap">
                    <span>dès</span>
                    <input
                      type="number" min={0} value={tier.threshold}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateBonusTier(ti, { threshold: v }); }}
                      className="w-16 border border-gray-300 rounded px-1.5 py-0.5 text-right bg-white"
                    />
                    <span>% d'atteinte :</span>
                    <input
                      type="number" min={0} value={tier.reward.value}
                      onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateBonusTier(ti, { rewardValue: v }); }}
                      className="w-20 border border-gray-300 rounded px-1.5 py-0.5 text-right bg-white"
                    />
                    <select
                      value={tier.reward.type}
                      onChange={(e) => updateBonusTier(ti, { rewardType: e.target.value as 'fixed' | 'percentage' })}
                      className="border border-gray-300 rounded px-1.5 py-0.5 bg-white"
                    >
                      <option value="fixed">€</option>
                      <option value="percentage">% du réalisé</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => removeBonusTier(ti)}
                      className="p-0.5 rounded text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors"
                      title="Supprimer ce palier"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addBonusTier}
                  className="text-xs font-medium text-primary-600 hover:text-primary-700 hover:underline"
                >
                  + Ajouter un palier de prime
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {validationError && (
        <p className="mt-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
          {validationError}
        </p>
      )}
    </Card>
  );
}
