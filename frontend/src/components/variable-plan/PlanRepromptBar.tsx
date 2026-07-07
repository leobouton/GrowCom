import { useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { variablePlanApiService } from '../../services/variablePlan.service';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { getApiErrorMessage } from './planDisplay';

/**
 * Volet 2 — Modifications STRUCTURELLES (ajouter/supprimer un composant,
 * changer la logique) : instruction en texte libre → generate en mode édition
 * (plan courant + instruction ⇒ plan complet mis à jour).
 */
export function PlanRepromptBar() {
  const [instruction, setInstruction] = useState('');
  const { draft, loading, error, setDraft, setLoading, setError } = useVariablePlanStore();

  if (!draft) return null;
  const canSend = instruction.trim().length >= 10 && !loading.generate;

  const handleReprompt = async () => {
    setLoading('generate', true);
    setError('generate', null);
    try {
      const updated = await variablePlanApiService.generate(instruction.trim(), draft);
      setDraft(updated);
      setInstruction('');
    } catch (err: unknown) {
      setError('generate', getApiErrorMessage(err));
    } finally {
      setLoading('generate', false);
    }
  };

  return (
    <Card padding="sm">
      <p className="text-xs font-medium text-gray-600 mb-2">
        ✏️ Besoin de changer la structure du plan ? Décrivez la modification :
      </p>
      <div className="flex gap-2">
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && canSend) void handleReprompt(); }}
          placeholder="ex : ajoute une prime de 500€ par recrutement senior, et retire l'objectif trimestriel"
          className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
          disabled={loading.generate}
        />
        <Button onClick={() => void handleReprompt()} disabled={!canSend} loading={loading.generate}>
          Modifier
        </Button>
      </div>
      {error.generate && (
        <div className="mt-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-red-600">{error.generate}</p>
          <Button size="sm" variant="secondary" onClick={() => void handleReprompt()} disabled={!canSend}>
            Réessayer
          </Button>
        </div>
      )}
    </Card>
  );
}
