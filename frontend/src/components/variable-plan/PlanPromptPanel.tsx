import { useState } from 'react';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { variablePlanApiService } from '../../services/variablePlan.service';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { getApiErrorMessage } from './planDisplay';

const EXAMPLE_PROMPT =
  '15% de la marge sur chaque recrutement à la signature, 100€ par mois et par consultant placé '
  + 'tant que la mission tourne, et un objectif de 150 000€ de CA par trimestre avec 1 000€ de prime.';

/**
 * Volet 1 — Le manager décrit son plan en langage naturel (commissions one-shot,
 * récurrent ESN, objectifs, tout mélangé). L'IA renvoie un brouillon structuré.
 */
export function PlanPromptPanel() {
  const [text, setText] = useState('');
  const { loading, error, setDraft, setLoading, setError } = useVariablePlanStore();

  const canGenerate = text.trim().length >= 10 && !loading.generate;

  const handleGenerate = async () => {
    setLoading('generate', true);
    setError('generate', null);
    try {
      const draft = await variablePlanApiService.generate(text.trim());
      setDraft(draft);
    } catch (err: unknown) {
      setError('generate', getApiErrorMessage(err));
    } finally {
      setLoading('generate', false);
    }
  };

  return (
    <Card>
      <div className="border-b border-gray-200 pb-3 mb-4">
        <h2 className="text-base font-semibold text-gray-900">✨ Décrivez votre plan de variable</h2>
        <p className="text-xs text-gray-400 mt-1">
          Écrivez-le comme vous l'expliqueriez à votre équipe : commissions à la vente, récurrent
          sur les missions, objectifs avec primes… tout en une fois. L'assistant le structure,
          puis vous le vérifiez sur des scénarios chiffrés avant d'enregistrer.
        </p>
      </div>

      <textarea
        rows={5}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={`ex : ${EXAMPLE_PROMPT}`}
        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white resize-y"
        disabled={loading.generate}
      />
      <p className="mt-1 text-xs text-gray-400">
        Vous pouvez mentionner : pourcentages, montants fixes, base CA ou marge, paliers, plafonds,
        seuils, paiement au règlement client, objectifs et primes.
      </p>

      {error.generate && (
        <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-red-600">{error.generate}</p>
          <Button size="sm" variant="secondary" onClick={() => void handleGenerate()} disabled={!canGenerate}>
            Réessayer
          </Button>
        </div>
      )}

      <div className="flex justify-end mt-4">
        <Button onClick={() => void handleGenerate()} disabled={!canGenerate} loading={loading.generate}>
          {loading.generate ? 'Génération en cours…' : 'Générer mon plan'}
        </Button>
      </div>
    </Card>
  );
}
