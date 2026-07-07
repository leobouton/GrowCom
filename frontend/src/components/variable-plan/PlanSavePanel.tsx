import { useEffect, useState } from 'react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { api } from '../../services/api';
import { variablePlanApiService } from '../../services/variablePlan.service';
import { useVariablePlanStore } from '../../stores/variablePlan.store';
import { getApiErrorMessage, validateComponent } from './planDisplay';
import type { PublicUser } from '@shared/types';

/**
 * Volet 2 — Sauvegarde : choix des membres concernés (assignation simple,
 * sans overrides — chantier suivant) puis enregistrement via l'API.
 */
export function PlanSavePanel() {
  const { draft, loading, error, setLoading, setError, setSavedPlanName } = useVariablePlanStore();
  const [members, setMembers] = useState<PublicUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [membersError, setMembersError] = useState<string | null>(null);

  useEffect(() => {
    const loadMembers = async () => {
      try {
        const res = await api.get<{ success: true; data: PublicUser[] }>('/auth/team');
        const eligible = res.data.data.filter((m) =>
          m.role === 'COMMERCIAL' || m.role === 'RECRUITER' || m.role === 'TEAM_LEAD',
        );
        setMembers(eligible);
      } catch (err: unknown) {
        setMembersError(getApiErrorMessage(err));
      }
    };
    void loadMembers();
  }, []);

  if (!draft) return null;

  const hasInvalidComponent = draft.components.some((c) => validateComponent(c) !== null);

  const toggleMember = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setLoading('save', true);
    setError('save', null);
    try {
      const saved = await variablePlanApiService.save(draft, [...selectedIds]);
      setSavedPlanName(saved.name);
    } catch (err: unknown) {
      setError('save', getApiErrorMessage(err));
    } finally {
      setLoading('save', false);
    }
  };

  return (
    <Card>
      <h3 className="text-sm font-semibold text-gray-900 mb-1">💾 Enregistrer le plan</h3>
      <p className="text-xs text-gray-400 mb-4">
        Les règles de commission deviennent actives et sont assignées aux membres choisis ;
        les objectifs sont ajoutés à leur tableau de bord. Vous pouvez aussi enregistrer
        sans assigner personne pour le moment.
      </p>

      {membersError && <p className="text-xs text-red-600 mb-3">{membersError}</p>}

      {members.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] font-medium text-gray-500 mb-2">S'applique à :</p>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const selected = selectedIds.has(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => toggleMember(m.id)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                    selected
                      ? 'bg-primary-600 text-white border-primary-600'
                      : 'bg-white text-gray-600 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  {selected ? '✓ ' : ''}{m.firstName} {m.lastName}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {error.save && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-red-600">{error.save}</p>
          <Button size="sm" variant="secondary" onClick={() => void handleSave()} disabled={loading.save}>
            Réessayer
          </Button>
        </div>
      )}
      {hasInvalidComponent && (
        <p className="mb-3 text-xs text-amber-600">
          Corrigez d'abord les valeurs signalées en rouge dans les composants ci-dessus.
        </p>
      )}

      <div className="flex justify-end">
        <Button onClick={() => void handleSave()} disabled={loading.save || hasInvalidComponent} loading={loading.save}>
          {loading.save ? 'Enregistrement…' : selectedIds.size > 0
            ? `Enregistrer et assigner à ${selectedIds.size} membre${selectedIds.size > 1 ? 's' : ''}`
            : 'Enregistrer le plan'}
        </Button>
      </div>
    </Card>
  );
}
