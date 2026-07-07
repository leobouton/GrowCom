import { useState } from 'react';
import { Button } from '../ui/Button';
import { ruleAssignmentApiService } from '../../services/ruleAssignment.service';
import { getApiErrorMessage, validateComponent } from '../variable-plan/planDisplay';
import type { RuleAssignment, CommissionRuleConfig, CommissionTier } from '@shared/types';
import { CommissionRuleType } from '@shared/types';

/**
 * Ajustement PAR PERSONNE des valeurs d'une règle assignée (taux, montant fixe,
 * plafond, seuil, paliers) via les overrides d'assignation — le barème de la
 * règle elle-même n'est jamais modifié. Le backend recalcule immédiatement les
 * commissions en attente du membre.
 */
export function AssignmentOverrideEditor({
  assignment,
  onSaved,
  onCancel,
}: {
  assignment: RuleAssignment;
  onSaved: (updated: RuleAssignment) => void;
  onCancel: () => void;
}) {
  const baseConfig = assignment.rule.config as CommissionRuleConfig;
  const effective: CommissionRuleConfig = { ...baseConfig, ...(assignment.overrides ?? {}) };

  const [rate, setRate] = useState<number>(Math.round((effective.rate ?? 0) * 100 * 100) / 100);
  const [fixedAmount, setFixedAmount] = useState<number>(effective.fixedAmount ?? 0);
  const [cap, setCap] = useState<number | null>(effective.cap ?? null);
  const [floor, setFloor] = useState<number | null>(effective.floor ?? null);
  const [tiers, setTiers] = useState<CommissionTier[]>(effective.tiers ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPercentage = baseConfig.type === CommissionRuleType.PERCENTAGE;
  const isFixed = baseConfig.type === CommissionRuleType.FIXED || baseConfig.calculationBasis === 'PER_UNIT';
  const isTiered = baseConfig.type === CommissionRuleType.TIERED;
  const hasOverrides = assignment.overrides !== null && Object.keys(assignment.overrides ?? {}).length > 0;

  const buildOverrides = (): Partial<CommissionRuleConfig> => {
    const overrides: Partial<CommissionRuleConfig> = {};
    if (isPercentage && rate / 100 !== (baseConfig.rate ?? 0)) overrides.rate = rate / 100;
    if (isFixed && fixedAmount !== (baseConfig.fixedAmount ?? 0)) overrides.fixedAmount = fixedAmount;
    if (cap !== null && cap !== (baseConfig.cap ?? null)) overrides.cap = cap;
    if (floor !== null && floor !== (baseConfig.floor ?? null)) overrides.floor = floor;
    if (isTiered && JSON.stringify(tiers) !== JSON.stringify(baseConfig.tiers ?? [])) overrides.tiers = tiers;
    return overrides;
  };

  const validationError = (() => {
    const candidate: CommissionRuleConfig = { ...baseConfig, ...buildOverrides() };
    return validateComponent({ kind: 'COMMISSION_RULE', name: assignment.rule.name, config: candidate });
  })();

  const handleSave = async (resetToStandard = false) => {
    setSaving(true);
    setError(null);
    try {
      const overrides = resetToStandard ? null : buildOverrides();
      const payload = overrides !== null && Object.keys(overrides).length === 0 ? null : overrides;
      const updated = await ruleAssignmentApiService.updateOverrides(assignment.id, payload);
      onSaved(updated);
    } catch (err: unknown) {
      setError(getApiErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const updateTier = (i: number, patch: Partial<CommissionTier>) => {
    setTiers((prev) => {
      const next = prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t));
      if (patch.max !== undefined && patch.max !== null && i < next.length - 1) {
        next[i + 1] = { ...next[i + 1], min: patch.max };
      }
      return next;
    });
  };

  return (
    <div className="mt-2 p-3 bg-white border border-primary-200 rounded-lg space-y-3">
      <p className="text-[11px] font-medium text-primary-700">
        Ajustement pour ce membre uniquement — le barème du plan reste inchangé.
      </p>

      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {isPercentage && (
          <label className="block">
            <span className="text-[11px] font-medium text-gray-500">
              Taux {baseConfig.rate != null && <span className="text-gray-300">(standard : {(baseConfig.rate * 100).toLocaleString('fr-FR')} %)</span>}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <input
                type="number" min={0} step={0.5} value={rate}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setRate(v); }}
                className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right bg-white"
              />
              <span className="text-xs text-gray-400">%</span>
            </div>
          </label>
        )}
        {isFixed && (
          <label className="block">
            <span className="text-[11px] font-medium text-gray-500">
              Montant {baseConfig.fixedAmount != null && <span className="text-gray-300">(standard : {baseConfig.fixedAmount.toLocaleString('fr-FR')} €)</span>}
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              <input
                type="number" min={0} step={10} value={fixedAmount}
                onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setFixedAmount(v); }}
                className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right bg-white"
              />
              <span className="text-xs text-gray-400">€</span>
            </div>
          </label>
        )}
        <label className="block">
          <span className="text-[11px] font-medium text-gray-500">Seuil minimum</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <input
              type="number" min={0} step={100} value={floor ?? ''} placeholder="—"
              onChange={(e) => {
                if (e.target.value === '') { setFloor(null); return; }
                const v = Number(e.target.value); if (Number.isFinite(v)) setFloor(v);
              }}
              className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right bg-white"
            />
            <span className="text-xs text-gray-400">€</span>
          </div>
        </label>
        <label className="block">
          <span className="text-[11px] font-medium text-gray-500">Plafond</span>
          <div className="flex items-center gap-1.5 mt-0.5">
            <input
              type="number" min={0} step={100} value={cap ?? ''} placeholder="—"
              onChange={(e) => {
                if (e.target.value === '') { setCap(null); return; }
                const v = Number(e.target.value); if (Number.isFinite(v)) setCap(v);
              }}
              className="w-24 border border-gray-300 rounded-lg px-2 py-1 text-sm text-right bg-white"
            />
            <span className="text-xs text-gray-400">€</span>
          </div>
        </label>
      </div>

      {isTiered && tiers.length > 0 && (
        <div className="space-y-1.5">
          <span className="text-[11px] font-medium text-gray-500">Paliers</span>
          {tiers.map((tier, ti) => (
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
                disabled={ti === tiers.length - 1}
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
            </div>
          ))}
        </div>
      )}

      {validationError && (
        <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-2 py-1">{validationError}</p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center justify-end gap-2">
        {hasOverrides && (
          <Button size="sm" variant="ghost" onClick={() => void handleSave(true)} disabled={saving}>
            Revenir au barème standard
          </Button>
        )}
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>Annuler</Button>
        <Button size="sm" onClick={() => void handleSave(false)} disabled={saving || validationError !== null} loading={saving}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}
