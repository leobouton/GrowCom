import { useState } from 'react';
import axios from 'axios';
import { Button } from '../ui/Button';
import { contestApiService } from '../../services/contest.service';
import type { Contest, PublicUser } from '@shared/types';
import { ContestMetric, RuleScope } from '@shared/types';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

interface ContestWizardState {
  step: WizardStep;
  name: string;
  prize: string;
  description: string;
  metric: ContestMetric | null;
  anonymousLeaderboard: boolean;
  scope: RuleScope;
  teamName: string;
  participantIds: string[];
  periodStart: string;
  periodEnd: string;
}

interface ContestWizardProps {
  teamMembers: PublicUser[];
  isTeamLead?: boolean;
  onSuccess: (contest: Contest) => void;
  onCancel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function metricLabel(metric: ContestMetric): string {
  if (metric === ContestMetric.REVENUE) return 'CA (chiffre d\'affaires)';
  if (metric === ContestMetric.MARGIN) return 'Marge réalisée';
  return 'Deals signés';
}

function scopeLabel(scope: RuleScope, teamName: string, count: number): string {
  if (scope === RuleScope.GLOBAL) return 'Toute l\'équipe';
  if (scope === RuleScope.TEAM) return `Équipe : ${teamName || '—'}`;
  return `${count} participant${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`;
}

// ─── Composant ────────────────────────────────────────────────────────────

export function ContestWizard({ teamMembers, isTeamLead = false, onSuccess, onCancel }: ContestWizardProps) {
  const [state, setState] = useState<ContestWizardState>({
    step: 1,
    name: '',
    prize: '',
    description: '',
    metric: null,
    anonymousLeaderboard: false,
    scope: isTeamLead ? RuleScope.INDIVIDUAL : RuleScope.GLOBAL,
    teamName: '',
    participantIds: [],
    periodStart: '',
    periodEnd: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (patch: Partial<ContestWizardState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  const goToStep = (step: WizardStep) => update({ step });

  // ── Validation ──

  const canGoToStep2 = state.name.trim().length > 0 && state.prize.trim().length > 0;
  const canGoToStep3 = state.metric !== null;
  const canGoToStep4 = (() => {
    if (!state.periodStart || !state.periodEnd) return false;
    if (new Date(state.periodEnd) <= new Date(state.periodStart)) return false;
    if (state.scope === RuleScope.INDIVIDUAL && state.participantIds.length === 0) return false;
    return true;
  })();

  // ── Participants ──

  const toggleParticipant = (id: string) => {
    update({
      participantIds: state.participantIds.includes(id)
        ? state.participantIds.filter((pid) => pid !== id)
        : [...state.participantIds, id],
    });
  };

  const toggleAll = () => {
    if (state.participantIds.length === teamMembers.length) {
      update({ participantIds: [] });
    } else {
      update({ participantIds: teamMembers.map((m) => m.id) });
    }
  };

  // ── Soumission ──

  const handleSubmit = async () => {
    if (!state.metric) return;
    setSubmitting(true);
    setError(null);
    try {
      const contest = await contestApiService.create({
        name: state.name,
        description: state.description,
        prize: state.prize,
        metric: state.metric,
        scope: state.scope,
        teamName: state.scope === RuleScope.TEAM ? (state.teamName || null) : null,
        participantIds: state.scope === RuleScope.INDIVIDUAL ? state.participantIds : [],
        periodStart: new Date(state.periodStart).toISOString(),
        periodEnd: new Date(state.periodEnd).toISOString(),
        anonymousLeaderboard: state.anonymousLeaderboard,
      });
      onSuccess(contest);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const apiMsg = (err.response?.data as { error?: { message?: string } } | undefined)?.error?.message;
        setError(apiMsg ?? err.message);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Erreur inconnue');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-1">
        {([
          [1, 'Quoi'],
          [2, 'Comment'],
          [3, 'Qui & quand'],
          [4, 'Récapitulatif'],
        ] as [WizardStep, string][]).map(([s, label], i) => (
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
            {i < 3 && <div className={`flex-1 h-0.5 rounded ${s < state.step ? 'bg-green-300' : 'bg-gray-200'}`} />}
          </div>
        ))}
      </div>

      {/* ── Étape 1 : Quoi ── */}
      {state.step === 1 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">De quoi s'agit-il ?</h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Nom du concours</label>
            <input
              type="text"
              placeholder="ex : Meilleur commercial du mois"
              value={state.name}
              onChange={(e) => update({ name: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lot / Récompense</label>
            <input
              type="text"
              placeholder="ex : iPhone 17, Bon cadeau 500\u20AC..."
              value={state.prize}
              onChange={(e) => update({ prize: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Description (optionnel)</label>
            <textarea
              rows={2}
              placeholder="Détails supplémentaires sur le concours..."
              value={state.description}
              onChange={(e) => update({ description: e.target.value })}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={onCancel}>Annuler</Button>
            <Button onClick={() => goToStep(2)} disabled={!canGoToStep2}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Étape 2 : Comment ── */}
      {state.step === 2 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Comment départager les participants ?</h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Métrique de classement</label>
            <div className="grid grid-cols-3 gap-3">
              {([
                { value: ContestMetric.REVENUE, label: 'CA réalisé', desc: 'Montant total des deals' },
                { value: ContestMetric.MARGIN, label: 'Marge réalisée', desc: 'Marge totale des deals' },
                { value: ContestMetric.DEAL_COUNT, label: 'Deals signés', desc: 'Nombre de deals gagnés' },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => update({ metric: opt.value })}
                  className={`p-3 border-2 rounded-xl text-left transition-colors ${
                    state.metric === opt.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-800">{opt.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-200 p-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={state.anonymousLeaderboard}
                onChange={(e) => update({ anonymousLeaderboard: e.target.checked })}
                className="w-4 h-4 rounded text-primary-600 border-gray-300 focus:ring-primary-400 mt-0.5"
              />
              <div>
                <p className="text-sm font-medium text-gray-800">Classement anonyme</p>
                <p className="text-xs text-gray-500 mt-0.5">
                  Les commerciaux ne voient que leur position, pas les scores des autres.
                  Vous voyez toujours le classement complet.
                </p>
              </div>
            </label>
          </div>

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={() => goToStep(1)}>Retour</Button>
            <Button onClick={() => goToStep(3)} disabled={!canGoToStep3}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Étape 3 : Qui et quand ── */}
      {state.step === 3 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Participants et durée</h3>
          </div>

          {/* Scope */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Participants</label>
            {isTeamLead ? (
              <p className="text-xs text-gray-400 mb-2 italic">Vous pouvez sélectionner uniquement les membres de votre équipe.</p>
            ) : (
              <div className="grid grid-cols-3 gap-2">
                {([
                  { scope: RuleScope.GLOBAL, label: 'Toute l\'équipe', desc: 'Tous les commerciaux' },
                  { scope: RuleScope.TEAM, label: 'Une équipe', desc: 'Un groupe spécifique' },
                  { scope: RuleScope.INDIVIDUAL, label: 'Sélection manuelle', desc: 'Choisir les participants' },
                ]).map((opt) => (
                  <button
                    key={opt.scope}
                    type="button"
                    onClick={() => update({ scope: opt.scope, participantIds: [] })}
                    className={`p-3 border-2 rounded-xl text-left transition-colors ${
                      state.scope === opt.scope ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                    }`}
                  >
                    <p className="text-xs font-semibold text-gray-800">{opt.label}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                  </button>
                ))}
              </div>
            )}

            {/* Nom d'équipe pour scope TEAM */}
            {!isTeamLead && state.scope === RuleScope.TEAM && (
              <div className="mt-3">
                <label className="block text-xs font-medium text-gray-700 mb-1">Nom de l'équipe</label>
                <input
                  type="text"
                  placeholder="ex : Équipe Paris"
                  value={state.teamName}
                  onChange={(e) => update({ teamName: e.target.value })}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                />
              </div>
            )}

            {/* Sélection individuelle */}
            {(isTeamLead || state.scope === RuleScope.INDIVIDUAL) && (
              <div className="mt-3">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-700">Sélectionner les participants</label>
                  <button type="button" onClick={toggleAll} className="text-xs text-primary-600 hover:underline">
                    {state.participantIds.length === teamMembers.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </button>
                </div>
                {teamMembers.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Aucun commercial dans votre équipe</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {teamMembers.map((m) => (
                      <label key={m.id} className={`flex items-center gap-3 px-3 py-2.5 cursor-pointer transition-colors ${state.participantIds.includes(m.id) ? 'bg-primary-50' : 'hover:bg-gray-50'}`}>
                        <input
                          type="checkbox"
                          checked={state.participantIds.includes(m.id)}
                          onChange={() => toggleParticipant(m.id)}
                          className="w-4 h-4 rounded text-primary-600 border-gray-300 focus:ring-primary-400"
                        />
                        <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                          <span className="text-primary-700 font-semibold text-xs">{m.firstName[0]}{m.lastName[0]}</span>
                        </div>
                        <p className="text-sm text-gray-800">{m.firstName} {m.lastName}</p>
                      </label>
                    ))}
                  </div>
                )}
                {state.participantIds.length > 0 && (
                  <p className="text-xs text-primary-600 mt-1.5 font-medium">
                    {state.participantIds.length} participant{state.participantIds.length > 1 ? 's' : ''} sélectionné{state.participantIds.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date de début</label>
              <input
                type="date"
                value={state.periodStart}
                onChange={(e) => update({ periodStart: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date de fin</label>
              <input
                type="date"
                value={state.periodEnd}
                min={state.periodStart || undefined}
                onChange={(e) => update({ periodEnd: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
              />
            </div>
          </div>
          {state.periodStart && state.periodEnd && new Date(state.periodEnd) <= new Date(state.periodStart) && (
            <p className="text-xs text-red-500">La date de fin doit être postérieure à la date de début</p>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={() => goToStep(2)}>Retour</Button>
            <Button onClick={() => goToStep(4)} disabled={!canGoToStep4}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Étape 4 : Récapitulatif ── */}
      {state.step === 4 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Récapitulatif</h3>
          </div>

          <div className="bg-gray-50 rounded-xl border border-gray-200 p-5 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83C\uDFC6'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nom</p>
                <p className="text-sm text-gray-800 font-medium">{state.name}</p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83C\uDF81'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Lot</p>
                <p className="text-sm text-gray-800 font-medium">{state.prize}</p>
              </div>
            </div>

            {state.metric && (
              <div className="flex items-start gap-3">
                <span className="text-base mt-0.5">{'\uD83D\uDCCA'}</span>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Métrique</p>
                  <p className="text-sm text-gray-800 font-medium">{metricLabel(state.metric)}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83D\uDC65'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Participants</p>
                <p className="text-sm text-gray-800 font-medium">
                  {scopeLabel(state.scope, state.teamName, state.participantIds.length)}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83D\uDCC5'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Période</p>
                <p className="text-sm text-gray-800 font-medium">
                  {state.periodStart && state.periodEnd
                    ? `${format(new Date(state.periodStart), 'dd/MM/yyyy')} \u2192 ${format(new Date(state.periodEnd), 'dd/MM/yyyy')}`
                    : '—'}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{state.anonymousLeaderboard ? '\uD83D\uDD12' : '\uD83D\uDD13'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Classement</p>
                <p className="text-sm text-gray-800 font-medium">
                  {state.anonymousLeaderboard ? 'Anonyme (seule la position est visible)' : 'Public (les scores sont visibles)'}
                </p>
              </div>
            </div>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={() => goToStep(3)}>Modifier</Button>
            <Button onClick={() => void handleSubmit()} loading={submitting}>
              Lancer le concours
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
