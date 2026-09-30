/**
 * Simulateur de commission (îlot React). Recalcul instantané à chaque saisie, dans le
 * navigateur, sans aucun appel réseau. Les paramètres sont gardés dans l'URL pour
 * recharger ou partager la simulation.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { simulateAgencySale } from '@shared/commission-engine';
import {
  DEDUCTION_KINDS,
  DEFAULT_STATE,
  MAX_DEDUCTIONS,
  MAX_PARTICIPANTS,
  MAX_TIERS,
  ROLES,
  SCENARIOS,
  cloneState,
  decodeState,
  encodeState,
  evenShares,
  toSimulationInput,
  type SimulatorState,
} from '../../simulator/state';
import { formatEurSmart } from '../../lib/format';
import { AddButton, ChoiceCards, FormSection, IconButton, NumberField, RemoveIcon, Segmented, SelectField } from './fields';
import { ResultsPanel } from './ResultsPanel';
import { LeadDialog } from '../lead/LeadDialog';
import { DEMO_HREF } from '../../lib/site';
import { withoutAttribution } from '../../lib/attribution';

/** Paramètres d'URL gérés par le simulateur (les autres, comme les UTM, sont préservés). */
const SIM_KEYS = ['prix', 'hon', 'honu', 'tva', 'statut', 'rem', 'taux', 'forfait', 'pal', 'mode', 'ca', 'parts', 'ret', 'ventes'];

function writeUrl(state: SimulatorState | null) {
  const params = new URLSearchParams(window.location.search);
  SIM_KEYS.forEach((key) => params.delete(key));
  const others = params.toString();
  const sim = state ? encodeState(state) : '';
  const query = [sim, others].filter(Boolean).join('&');
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

const sameState = (a: SimulatorState, b: SimulatorState) => JSON.stringify(a) === JSON.stringify(b);

export default function Simulator() {
  const [state, setState] = useState<SimulatorState>(() => cloneState(DEFAULT_STATE));
  const [copied, setCopied] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [resultVisible, setResultVisible] = useState(false);
  const resultRef = useRef<HTMLDivElement>(null);
  const touched = useRef(false);
  const hydrated = useRef(false);

  // Barre de résumé mobile : affichée seulement tant que le bordereau est plus bas dans la page
  // (masquée quand il est à l'écran ou déjà dépassé, y compris après un saut vers une ancre)
  useEffect(() => {
    const node = resultRef.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setResultVisible(node.getBoundingClientRect().top < window.innerHeight * 0.85);
    };
    const schedule = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);

  // Au chargement : reprendre la simulation contenue dans l'URL (lien partagé, rechargement)
  useEffect(() => {
    const fromUrl = decodeState(window.location.search);
    if (!sameState(fromUrl, DEFAULT_STATE)) setState(fromUrl);
    hydrated.current = true;
  }, []);

  // Après chaque modification par l'utilisateur : mettre l'URL à jour (sans recharger la page)
  useEffect(() => {
    if (!hydrated.current || !touched.current) return;
    const timer = window.setTimeout(() => writeUrl(state), 250);
    return () => window.clearTimeout(timer);
  }, [state]);

  const update = (patch: Partial<SimulatorState> | ((s: SimulatorState) => SimulatorState)) => {
    touched.current = true;
    setState((prev) => (typeof patch === 'function' ? patch(cloneState(prev)) : { ...prev, ...patch }));
  };

  const outcome = useMemo(() => simulateAgencySale(toSimulationInput(state)), [state]);
  const result = outcome.ok ? outcome.result : null;
  const issues = outcome.ok ? [] : outcome.issues;
  const issueFor = (field: string) => issues.find((i) => i.field === field)?.message;
  const activeScenario = SCENARIOS.find((s) => sameState(s.state, state))?.id ?? null;
  const sharesTotal = Math.round(state.participants.reduce((sum, p) => sum + p.share, 0) * 100) / 100;

  const copyLink = async () => {
    writeUrl(state);
    try {
      // Lien partagé sans les paramètres de campagne : un collègue n'est pas attribué à l'email d'un autre
      await navigator.clipboard.writeText(withoutAttribution(window.location.href));
      setCopied('copied');
    } catch {
      // Presse-papiers refusé par le navigateur : l'URL de la page est déjà à jour
      setCopied('failed');
    }
    window.setTimeout(() => setCopied('idle'), 3500);
  };

  const reset = () => {
    touched.current = false;
    setState(cloneState(DEFAULT_STATE));
    writeUrl(null);
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_25.5rem] lg:gap-10">
      {/* ═══ Saisie ═══ */}
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="mr-1 text-[0.85rem] font-medium text-muted">Partir d'un exemple :</span>
          {SCENARIOS.map((scenario) => (
            <button
              key={scenario.id}
              type="button"
              title={scenario.description}
              aria-pressed={activeScenario === scenario.id}
              onClick={() => update(() => cloneState(scenario.state))}
              className={[
                'rounded-full border px-3.5 py-1.5 text-[0.85rem] font-medium transition-colors',
                activeScenario === scenario.id
                  ? 'border-ink bg-ink text-paper'
                  : 'border-line-strong bg-card text-ink-soft hover:border-ink hover:text-ink',
              ].join(' ')}
            >
              {scenario.label}
            </button>
          ))}
          <button
            type="button"
            onClick={reset}
            className="ml-auto inline-flex items-center gap-1.5 rounded-full px-2 py-1.5 text-[0.85rem] font-medium text-muted transition-colors hover:text-ink"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v3h3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Réinitialiser
          </button>
        </div>

        {/* 1. La vente */}
        <FormSection step={1} title="La vente">
          <div className="grid gap-5 sm:grid-cols-2">
            <NumberField label="Prix de vente du bien" suffix="€" value={state.price} min={0} onChange={(price) => update({ price })} error={issueFor('salePrice')} />
            <div>
              <NumberField
                label="Honoraires de l'agence"
                suffix={state.feesUnit === 'pct' ? '%' : '€'}
                value={state.fees}
                min={0}
                onChange={(fees) => update({ fees })}
                error={issueFor('feesValue')}
              />
              <div className="mt-2">
                <Segmented
                  legend="Honoraires exprimés en"
                  hideLegend
                  size="sm"
                  value={state.feesUnit}
                  onChange={(feesUnit) =>
                    // Conversion de la valeur saisie pour garder le même montant d'honoraires
                    update({
                      feesUnit,
                      fees:
                        feesUnit === 'eur'
                          ? Math.round((state.price * state.fees) / 100)
                          : state.price > 0
                            ? Math.round((state.fees / state.price) * 10000) / 100
                            : DEFAULT_STATE.fees,
                    })
                  }
                  options={[
                    { value: 'pct', label: '% du prix' },
                    { value: 'eur', label: 'Montant en €' },
                  ]}
                />
              </div>
            </div>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Segmented
              legend="Les honoraires saisis sont"
              value={state.tax}
              onChange={(tax) => update({ tax })}
              options={[
                { value: 'ttc', label: 'TTC' },
                { value: 'ht', label: 'HT' },
              ]}
            />
            {result && (
              <p className="self-end rounded-xl bg-paper px-3.5 py-2.5 text-[0.85rem] leading-snug text-ink-soft">
                Soit <strong className="num text-ink">{formatEurSmart(result.fees.inclTax)} TTC</strong>, et{' '}
                <strong className="num text-ink">{formatEurSmart(result.fees.exclTax)} HT</strong> servant de base à la commission.
              </p>
            )}
          </div>
        </FormSection>

        {/* 2. Le négociateur */}
        <FormSection step={2} title="Le négociateur">
          <Segmented
            legend="Statut"
            value={state.status}
            onChange={(status) => update({ status })}
            options={[
              { value: 'agent', label: 'Agent commercial / mandataire' },
              { value: 'salarie', label: 'Salarié (VRP)' },
            ]}
          />
          <NumberField
            label="Honoraires HT déjà réalisés depuis janvier"
            suffix="€"
            value={state.prior}
            min={0}
            onChange={(prior) => update({ prior })}
            hint="Sert à situer le palier atteint. Laissez 0 pour une première vente."
            error={issueFor('priorRevenue')}
          />
        </FormSection>

        {/* 3. La rémunération */}
        <FormSection step={3} title="La rémunération">
          <Segmented
            legend="Mode de rémunération"
            value={state.rem}
            onChange={(rem) => update({ rem })}
            options={[
              { value: 'pal', label: 'Paliers' },
              { value: 'pct', label: '% des honoraires' },
              { value: 'fix', label: 'Forfait' },
            ]}
          />

          {state.rem === 'pct' && (
            <NumberField
              label="Part des honoraires HT reversée"
              suffix="%"
              value={state.rate}
              min={0}
              onChange={(rate) => update({ rate })}
              error={issueFor('remuneration.rate')}
              className="sm:max-w-xs"
            />
          )}

          {state.rem === 'fix' && (
            <NumberField
              label="Forfait par vente"
              suffix="€"
              value={state.fixed}
              min={0}
              onChange={(fixed) => update({ fixed })}
              error={issueFor('remuneration.fixedAmount')}
              className="sm:max-w-xs"
            />
          )}

          {state.rem === 'pal' && (
            <>
              <fieldset>
                <legend className="mb-2 text-[0.88rem] font-medium text-ink">Grille de paliers (honoraires HT cumulés dans l'année)</legend>
                <div className="overflow-hidden rounded-xl border border-line-strong">
                  <div className="grid grid-cols-[1fr_1fr_2.5rem] gap-2 bg-paper px-3 py-2 text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-muted sm:grid-cols-[1.3fr_1fr_2.5rem]">
                    <span>À partir de</span>
                    <span>Taux</span>
                    <span className="sr-only">Supprimer</span>
                  </div>
                  <ol className="divide-y divide-line">
                    {state.tiers.map((tier, index) => (
                      <li key={index} className="grid grid-cols-[1fr_1fr_2.5rem] items-center gap-2 px-3 py-2 sm:grid-cols-[1.3fr_1fr_2.5rem]">
                        <NumberField
                          label={`Palier ${index + 1} : à partir de`}
                          hideLabel
                          suffix="€"
                          value={tier.from}
                          min={0}
                          onChange={(from) => update((s) => ({ ...s, tiers: s.tiers.map((t, i) => (i === index ? { ...t, from } : t)) }))}
                        />
                        <NumberField
                          label={`Palier ${index + 1} : taux`}
                          hideLabel
                          suffix="%"
                          value={tier.rate}
                          min={0}
                          onChange={(rate) => update((s) => ({ ...s, tiers: s.tiers.map((t, i) => (i === index ? { ...t, rate } : t)) }))}
                        />
                        {state.tiers.length > 1 ? (
                          <IconButton label={`Supprimer le palier ${index + 1}`} onClick={() => update((s) => ({ ...s, tiers: s.tiers.filter((_, i) => i !== index) }))}>
                            <RemoveIcon />
                          </IconButton>
                        ) : (
                          <span />
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
                {issueFor('remuneration.tiers') && (
                  <p className="mt-2 text-[0.8rem] font-medium text-[#c2410c]">{issueFor('remuneration.tiers')}</p>
                )}
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <AddButton
                    disabled={state.tiers.length >= MAX_TIERS}
                    onClick={() =>
                      update((s) => {
                        const last = [...s.tiers].sort((a, b) => a.from - b.from).pop();
                        const from = last ? last.from + 20000 : 0;
                        return { ...s, tiers: [...s.tiers, { from, rate: last ? Math.min(100, last.rate + 5) : 30 }] };
                      })
                    }
                  >
                    Ajouter un palier
                  </AddButton>
                  <p className="text-[0.78rem] text-muted">Chaque palier s'arrête où commence le suivant.</p>
                </div>
              </fieldset>

              <ChoiceCards
                legend="Comment s'appliquent les paliers ?"
                value={state.tierMode}
                onChange={(tierMode) => update({ tierMode })}
                options={[
                  { value: 'tranche', label: 'Par tranche', description: 'Chaque tranche de CA est payée à son propre taux.' },
                  { value: 'atteint', label: 'Au taux atteint', description: 'Toute la vente au taux du palier atteint, sans effet rétroactif.' },
                  { value: 'retro', label: 'Rétroactif', description: 'En changeant de palier, tout le CA de l’année passe au nouveau taux.' },
                ]}
              />
            </>
          )}
        </FormSection>

        {/* 4. Partage et retenues */}
        <FormSection step={4} title="Partage et retenues">
          <fieldset>
            <legend className="mb-2 text-[0.88rem] font-medium text-ink">Intervenants sur la vente</legend>
            <ul className="space-y-2">
              {state.participants.map((participant, index) => (
                <li key={index} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_2.5rem] items-center gap-2">
                  <SelectField
                    label={`Rôle de l'intervenant ${index + 1}`}
                    hideLabel
                    value={participant.role}
                    options={ROLES}
                    onChange={(role) => update((s) => ({ ...s, participants: s.participants.map((p, i) => (i === index ? { ...p, role } : p)) }))}
                  />
                  <NumberField
                    label={`Part de l'intervenant ${index + 1}`}
                    hideLabel
                    suffix="%"
                    value={participant.share}
                    min={0}
                    max={100}
                    onChange={(share) => update((s) => ({ ...s, participants: s.participants.map((p, i) => (i === index ? { ...p, share } : p)) }))}
                  />
                  {state.participants.length > 1 ? (
                    <IconButton
                      label={`Retirer l'intervenant ${index + 1}`}
                      onClick={() =>
                        update((s) => {
                          const participants = s.participants.filter((_, i) => i !== index);
                          const shares = evenShares(participants.length);
                          return { ...s, participants: participants.map((p, i) => ({ ...p, share: shares[i] })) };
                        })
                      }
                    >
                      <RemoveIcon />
                    </IconButton>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <AddButton
                disabled={state.participants.length >= MAX_PARTICIPANTS}
                onClick={() =>
                  update((s) => {
                    const roles = s.participants.length === 1 ? (['mandat', 'vente'] as const) : null;
                    const participants = roles
                      ? roles.map((role) => ({ role, share: 0 }))
                      : [...s.participants, { role: 'apporteur' as const, share: 0 }];
                    const shares = evenShares(participants.length);
                    return { ...s, participants: participants.map((p, i) => ({ ...p, share: shares[i] })) };
                  })
                }
              >
                Partager la vente
              </AddButton>
              {state.participants.length > 1 && (
                <p className={['num text-[0.8rem]', issueFor('participants') ? 'font-medium text-[#c2410c]' : 'text-muted'].join(' ')}>
                  Total : {sharesTotal.toLocaleString('fr-FR')} %{issueFor('participants') ? ' (doit faire 100 %)' : ''}
                </p>
              )}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-[0.88rem] font-medium text-ink">Retenues sur la commission</legend>
            {state.deductions.length === 0 && (
              <p className="mb-2 text-[0.82rem] text-muted">Pack, redevance de réseau… Aucune retenue pour l'instant.</p>
            )}
            <ul className="space-y-2">
              {state.deductions.map((deduction, index) => (
                <li key={index} className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_2.5rem] items-start gap-2">
                  <SelectField
                    label={`Type de la retenue ${index + 1}`}
                    hideLabel
                    value={deduction.kind}
                    options={DEDUCTION_KINDS}
                    onChange={(kind) => update((s) => ({ ...s, deductions: s.deductions.map((d, i) => (i === index ? { ...d, kind } : d)) }))}
                  />
                  <div>
                    <NumberField
                      label={`Montant de la retenue ${index + 1}`}
                      hideLabel
                      suffix={deduction.unit === 'pct' ? '%' : '€'}
                      value={deduction.value}
                      min={0}
                      onChange={(value) => update((s) => ({ ...s, deductions: s.deductions.map((d, i) => (i === index ? { ...d, value } : d)) }))}
                      error={issueFor(`deductions.r${index + 1}`)}
                    />
                    <div className="mt-1.5">
                      <Segmented
                        legend={`Unité de la retenue ${index + 1}`}
                        hideLegend
                        size="sm"
                        value={deduction.unit}
                        onChange={(unit) => update((s) => ({ ...s, deductions: s.deductions.map((d, i) => (i === index ? { ...d, unit } : d)) }))}
                        options={[
                          { value: 'pct', label: '% comm.' },
                          { value: 'eur', label: '€ / vente' },
                        ]}
                      />
                    </div>
                  </div>
                  <IconButton label={`Supprimer la retenue ${index + 1}`} onClick={() => update((s) => ({ ...s, deductions: s.deductions.filter((_, i) => i !== index) }))}>
                    <RemoveIcon />
                  </IconButton>
                </li>
              ))}
            </ul>
            <div className="mt-2">
              <AddButton
                disabled={state.deductions.length >= MAX_DEDUCTIONS}
                onClick={() => update((s) => ({ ...s, deductions: [...s.deductions, { kind: 'reseau', unit: 'pct', value: 10 }] }))}
              >
                Ajouter une retenue
              </AddButton>
            </div>
          </fieldset>
        </FormSection>

        {/* 5. Projection */}
        <FormSection step={5} title="Projection sur l'année">
          <NumberField
            label="Nombre de ventes comparables par an"
            value={state.salesPerYear}
            integer
            min={1}
            max={200}
            onChange={(salesPerYear) => update({ salesPerYear })}
            error={issueFor('salesPerYear')}
            hint="Pour estimer la rémunération annuelle à ce rythme, en partant de janvier."
            className="sm:max-w-xs"
          />
        </FormSection>
      </div>

      {/* ═══ Résultat ═══ */}
      <div id="resultat" ref={resultRef} className="min-w-0 scroll-mt-20 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:self-start lg:overflow-y-auto lg:overscroll-contain lg:pb-2 lg:[scrollbar-width:thin]">
        <ResultsPanel
          result={result}
          issues={issues}
          status={state.status}
          salesPerYear={state.salesPerYear}
          actions={
            <div className="space-y-4">
            <LeadDialog simulation={result ? { state, result } : null} />
            <button
              type="button"
              onClick={copyLink}
              className="inline-flex items-center gap-2 text-[0.88rem] font-semibold text-primary-700 transition-colors hover:text-primary-900"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <path
                  d="M6.5 9.5l3-3M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
              <span aria-live="polite">
                {copied === 'copied'
                  ? 'Lien copié !'
                  : copied === 'failed'
                    ? "Copiez l'adresse de la page : elle contient votre simulation"
                    : 'Copier le lien de cette simulation'}
              </span>
            </button>
            {/* Appel secondaire, volontairement discret */}
            <p className="border-t border-line pt-4 text-[0.85rem] leading-snug text-muted">
              Vous gérez une équipe ?{' '}
              <a href={DEMO_HREF} className="font-semibold text-ink underline decoration-lime decoration-2 underline-offset-4 hover:decoration-ink">
                Automatiser ce calcul pour tous vos négociateurs
              </a>
            </p>
            </div>
          }
        />
      </div>

      {/* Barre de résumé mobile : le résultat reste visible pendant la saisie */}
      {result && (
        <a
          href="#resultat"
          aria-hidden={resultVisible ? true : undefined}
          tabIndex={resultVisible ? -1 : undefined}
          className={[
            'fixed inset-x-3 z-30 flex items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-3 text-paper shadow-[var(--shadow-slip)] transition-all duration-300 lg:hidden',
            resultVisible ? 'pointer-events-none translate-y-4 opacity-0' : 'opacity-100',
          ].join(' ')}
          style={{ bottom: 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}
        >
          <span className="text-[0.85rem] text-paper/75">
            Commission {result.participants.length > 1 ? 'totale' : ''}
            <span className="num ml-2 font-display text-[1.25rem] text-paper" style={{ fontWeight: 520 }}>
              {formatEurSmart(result.deductions.length > 0 ? result.netCommission : result.commission.totalAmount)}
            </span>
          </span>
          <span className="flex items-center gap-1.5 text-[0.82rem] font-semibold text-lime">
            Voir le détail
            <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
              <path d="M7 2.5v9M3 7.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </a>
      )}
    </div>
  );
}
