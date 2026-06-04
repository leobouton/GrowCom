import { useState } from 'react';
import axios from 'axios';
import { Button } from '../ui/Button';
import { contestApiService } from '../../services/contest.service';
import type { Contest, PublicUser } from '@shared/types';
import { ContestMetric, RuleScope } from '@shared/types';
import { format } from 'date-fns';

// ─── Types ────────────────────────────────────────────────────────────────

type WizardStep = 1 | 2 | 3 | 4;

type ParticipantMode = 'all' | 'selection';

interface ContestWizardState {
  step: WizardStep;
  name: string;
  prize: string;
  description: string;
  metric: ContestMetric | null;
  anonymousLeaderboard: boolean;
  participantMode: ParticipantMode;
  participantIds: string[];
  periodStart: string;
  periodEnd: string;
}

export interface ContestGroup {
  id: string;
  name: string;
  color: string;
  members: PublicUser[];
}

interface ContestWizardProps {
  teamMembers: PublicUser[];
  groups?: ContestGroup[];
  isTeamLead?: boolean;
  onSuccess: (contest: Contest) => void;
  onCancel: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function metricLabel(metric: ContestMetric): string {
  if (metric === ContestMetric.REVENUE) return 'CA (chiffre d\'affaires)';
  if (metric === ContestMetric.MARGIN) return 'Marge realisee';
  return 'Deals signes';
}

// ─── Composant ────────────────────────────────────────────────────────────

export function ContestWizard({ teamMembers, groups = [], isTeamLead = false, onSuccess, onCancel }: ContestWizardProps) {
  const [state, setState] = useState<ContestWizardState>({
    step: 1,
    name: '',
    prize: '',
    description: '',
    metric: null,
    anonymousLeaderboard: false,
    participantMode: isTeamLead ? 'selection' : 'all',
    participantIds: [],
    periodStart: '',
    periodEnd: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const update = (patch: Partial<ContestWizardState>) =>
    setState((prev) => ({ ...prev, ...patch }));

  const goToStep = (step: WizardStep) => update({ step });

  // ── Validation ──

  const canGoToStep2 = state.name.trim().length > 0 && state.prize.trim().length > 0;
  const canGoToStep3 = state.metric !== null;
  const canGoToStep4 = (() => {
    if (!state.periodStart || !state.periodEnd) return false;
    if (new Date(state.periodEnd) <= new Date(state.periodStart)) return false;
    if (state.participantMode === 'selection' && state.participantIds.length === 0) return false;
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

  const toggleGroup = (group: ContestGroup) => {
    const groupMemberIds = group.members.map((m) => m.id);
    const allSelected = groupMemberIds.every((id) => state.participantIds.includes(id));
    if (allSelected) {
      // Deselect all members of this group
      update({ participantIds: state.participantIds.filter((id) => !groupMemberIds.includes(id)) });
    } else {
      // Select all members of this group (add those not yet selected)
      const newIds = new Set([...state.participantIds, ...groupMemberIds]);
      update({ participantIds: [...newIds] });
    }
  };

  const isGroupFullySelected = (group: ContestGroup) =>
    group.members.length > 0 && group.members.every((m) => state.participantIds.includes(m.id));

  // ── Filtre recherche ──
  const filteredMembers = search.trim()
    ? teamMembers.filter((m) =>
        `${m.firstName} ${m.lastName}`.toLowerCase().includes(search.toLowerCase()),
      )
    : teamMembers;

  // ── Soumission ──

  const handleSubmit = async () => {
    if (!state.metric) return;
    setSubmitting(true);
    setError(null);
    try {
      const isAll = state.participantMode === 'all';
      const contest = await contestApiService.create({
        name: state.name,
        description: state.description,
        prize: state.prize,
        metric: state.metric,
        scope: isAll ? RuleScope.GLOBAL : RuleScope.INDIVIDUAL,
        teamName: null,
        participantIds: isAll ? [] : state.participantIds,
        periodStart: `${state.periodStart}T00:00:00.000Z`,
        periodEnd: `${state.periodEnd}T23:59:59.999Z`,
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

  // ── Recapitulatif participants ──
  const participantSummary = (() => {
    if (state.participantMode === 'all') return `Toute l'equipe (${teamMembers.length} personnes)`;
    return `${state.participantIds.length} participant${state.participantIds.length > 1 ? 's' : ''} selectionne${state.participantIds.length > 1 ? 's' : ''}`;
  })();

  return (
    <div className="space-y-5">
      {/* Stepper */}
      <div className="flex items-center gap-1">
        {([
          [1, 'Quoi'],
          [2, 'Comment'],
          [3, 'Qui & quand'],
          [4, 'Recap'],
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

      {/* ── Etape 1 : Quoi ── */}
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
            <label className="block text-xs font-medium text-gray-600 mb-1">Lot / Recompense</label>
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
              placeholder="Details supplementaires sur le concours..."
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

      {/* ── Etape 2 : Comment ── */}
      {state.step === 2 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Comment departager les participants ?</h3>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Metrique de classement</label>
            <div className="grid grid-cols-3 gap-3">
              {([
                { value: ContestMetric.REVENUE, label: 'CA realise', desc: 'Montant total des deals' },
                { value: ContestMetric.MARGIN, label: 'Marge realisee', desc: 'Marge totale des deals' },
                { value: ContestMetric.DEAL_COUNT, label: 'Deals signes', desc: 'Nombre de deals gagnes' },
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

      {/* ── Etape 3 : Qui et quand ── */}
      {state.step === 3 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Participants et duree</h3>
          </div>

          {/* Mode de selection */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-2">Qui participe ?</label>
            {isTeamLead ? (
              <p className="text-xs text-gray-400 mb-2 italic">Selectionnez les membres de votre equipe qui participent.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 mb-3">
                <button
                  type="button"
                  onClick={() => update({ participantMode: 'all', participantIds: [] })}
                  className={`p-3 border-2 rounded-xl text-left transition-colors ${
                    state.participantMode === 'all' ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-800">Toute l'equipe</p>
                  <p className="text-xs text-gray-400 mt-0.5">Tous les commerciaux actifs ({teamMembers.length})</p>
                </button>
                <button
                  type="button"
                  onClick={() => update({ participantMode: 'selection', participantIds: [] })}
                  className={`p-3 border-2 rounded-xl text-left transition-colors ${
                    state.participantMode === 'selection' ? 'border-primary-400 bg-primary-50' : 'border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <p className="text-sm font-semibold text-gray-800">Selection personnalisee</p>
                  <p className="text-xs text-gray-400 mt-0.5">Choisir par equipe ou individuellement</p>
                </button>
              </div>
            )}

            {/* Selection personnalisee */}
            {(isTeamLead || state.participantMode === 'selection') && (
              <div className="space-y-3">
                {/* Selection rapide par equipe */}
                {groups.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-gray-500 mb-1.5">Selection rapide par equipe</p>
                    <div className="flex flex-wrap gap-2">
                      {groups.map((g) => {
                        const selected = isGroupFullySelected(g);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => toggleGroup(g)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
                              selected
                                ? 'bg-primary-100 border-primary-300 text-primary-700'
                                : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            <span
                              className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                              style={{ backgroundColor: g.color || '#9CA3AF' }}
                            />
                            {g.name}
                            <span className="text-gray-400">({g.members.length})</span>
                            {selected && <span className="text-primary-600">{'\u2713'}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Barre de recherche + tout selectionner */}
                <div className="flex items-center gap-2">
                  <div className="flex-1 relative">
                    <input
                      type="text"
                      placeholder="Rechercher..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg pl-8 pr-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
                    />
                    <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <button type="button" onClick={toggleAll} className="text-xs text-primary-600 hover:underline whitespace-nowrap">
                    {state.participantIds.length === teamMembers.length ? 'Tout deselectionner' : 'Tout selectionner'}
                  </button>
                </div>

                {/* Liste des membres */}
                {teamMembers.length === 0 ? (
                  <p className="text-xs text-gray-400 italic">Aucun commercial dans votre equipe</p>
                ) : (
                  <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-48 overflow-y-auto">
                    {filteredMembers.map((m) => {
                      const memberGroup = groups.find((g) => g.members.some((gm) => gm.id === m.id));
                      return (
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
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-800 truncate">{m.firstName} {m.lastName}</p>
                          </div>
                          {memberGroup && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full"
                              style={{ backgroundColor: `${memberGroup.color}20`, color: memberGroup.color }}
                            >
                              {memberGroup.name}
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}

                {state.participantIds.length > 0 && (
                  <p className="text-xs text-primary-600 font-medium">
                    {state.participantIds.length} participant{state.participantIds.length > 1 ? 's' : ''} selectionne{state.participantIds.length > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date de debut</label>
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
            <p className="text-xs text-red-500">La date de fin doit etre posterieure a la date de debut</p>
          )}

          <div className="flex justify-between gap-3 pt-2">
            <Button variant="secondary" onClick={() => goToStep(2)}>Retour</Button>
            <Button onClick={() => goToStep(4)} disabled={!canGoToStep4}>Suivant</Button>
          </div>
        </div>
      )}

      {/* ── Etape 4 : Recapitulatif ── */}
      {state.step === 4 && (
        <div className="space-y-4">
          <div className="border-b border-gray-200 pb-3">
            <h3 className="text-sm font-semibold text-gray-800">Recapitulatif</h3>
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
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Metrique</p>
                  <p className="text-sm text-gray-800 font-medium">{metricLabel(state.metric)}</p>
                </div>
              </div>
            )}

            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83D\uDC65'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Participants</p>
                <p className="text-sm text-gray-800 font-medium">{participantSummary}</p>
                {state.participantMode === 'selection' && state.participantIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {state.participantIds.map((id) => {
                      const member = teamMembers.find((m) => m.id === id);
                      return member ? (
                        <span key={id} className="inline-flex items-center gap-1 text-xs bg-primary-50 text-primary-700 px-2 py-0.5 rounded-full">
                          {member.firstName} {member.lastName}
                        </span>
                      ) : null;
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-start gap-3">
              <span className="text-base mt-0.5">{'\uD83D\uDCC5'}</span>
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Periode</p>
                <p className="text-sm text-gray-800 font-medium">
                  {state.periodStart && state.periodEnd
                    ? `${format(new Date(state.periodStart), 'dd/MM/yyyy')} \u2192 ${format(new Date(state.periodEnd), 'dd/MM/yyyy')}`
                    : '\u2014'}
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
