/**
 * Résultat de la simulation, présenté comme un bordereau de commission :
 * honoraires, détail palier par palier, retenues, net, répartition, part agence,
 * prochain palier et projection annuelle. Affichage uniquement : les montants
 * viennent tels quels de simulateAgencySale.
 */
import type { AgencySaleSimulationResult, CalculationLine, CommissionTier, SimulationIssue } from '@shared/commission-engine';
import { formatEur, formatEurSmart, formatPercent } from '../../lib/format';
import { ProjectionChart } from './ProjectionChart';
import type { Status } from '../../simulator/state';

const eur2 = (value: number) => formatEur(value, 2);

function tierRange(tier?: CommissionTier): string {
  if (!tier) return '';
  return tier.max === null ? `au-delà de ${formatEur(tier.min)}` : `${formatEur(tier.min)} → ${formatEur(tier.max)}`;
}

function LineDetail({ line }: { line: CalculationLine }) {
  let title: string;
  let subtitle: string | null = null;
  let formula: string | null = null;

  switch (line.kind) {
    case 'TIER':
      title = `Palier ${formatPercent(line.rate ?? 0)}`;
      subtitle = tierRange(line.tier);
      formula = `${formatEurSmart(line.base ?? 0)} × ${formatPercent(line.rate ?? 0)}`;
      break;
    case 'RETROACTIVE_CATCH_UP':
      title = 'Rattrapage rétroactif';
      subtitle = 'sur le CA déjà réalisé';
      formula = `${formatEur(line.base ?? 0)} × ${formatPercent(line.rate ?? 0)} d'écart de taux`;
      break;
    case 'PERCENTAGE':
      title = `${formatPercent(line.rate ?? 0)} des honoraires HT`;
      formula = `${formatEurSmart(line.base ?? 0)} × ${formatPercent(line.rate ?? 0)}`;
      break;
    default:
      title = 'Forfait par vente';
  }

  return (
    <li className="flex items-start justify-between gap-4 text-[0.9rem]">
      <div className="min-w-0">
        <p className="font-medium text-ink">
          {title}
          {subtitle && <span className="block font-normal text-muted sm:inline"><span className="hidden sm:inline"> · </span>{subtitle}</span>}
        </p>
        {formula && <p className="num mt-0.5 text-muted">{formula}</p>}
      </div>
      <p className="num shrink-0 font-semibold text-ink">{eur2(line.amount)}</p>
    </li>
  );
}

function Row({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className="leader text-[0.9rem]">
      <dt className={muted ? 'text-muted' : 'text-ink-soft'}>{label}</dt>
      <dd className={['num', strong ? 'font-semibold text-ink' : muted ? 'text-muted' : 'font-medium text-ink'].join(' ')}>{value}</dd>
    </div>
  );
}

const Divider = () => (
  <div className="relative my-5" aria-hidden="true">
    <div className="border-t-[1.5px] border-dashed border-line-strong" />
  </div>
);

interface Props {
  result: AgencySaleSimulationResult | null;
  issues: SimulationIssue[];
  status: Status;
  salesPerYear: number;
  actions?: React.ReactNode;
}

export function ResultsPanel({ result, issues, status, salesPerYear, actions }: Props) {
  const salaried = status === 'salarie';

  if (!result) {
    return (
      <div className="rounded-[1.4rem] border border-line bg-card p-6 shadow-[var(--shadow-slip)] sm:p-7">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted">Résultat</p>
        <p className="mt-3 font-display text-[1.35rem] leading-snug" style={{ fontWeight: 480 }}>
          Quelques valeurs sont à corriger pour lancer le calcul.
        </p>
        <ul className="mt-4 space-y-2" role="alert">
          {issues.map((issue) => (
            <li key={issue.field + issue.message} className="flex gap-2 text-[0.9rem] text-[#9a3412]">
              <span aria-hidden="true">•</span>
              {issue.message}
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { fees, commission, deductions, netCommission, participants, agencyShare, projection } = result;
  const progress = commission.tierProgress;
  const hasDeductions = deductions.length > 0;
  const multi = participants.length > 1;
  const payee = multi ? 'des intervenants' : 'du négociateur';

  return (
    <div className="rounded-[1.4rem] border border-line bg-card shadow-[var(--shadow-slip)]">
      <div className="px-6 pb-6 pt-6 sm:px-7">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted">Bordereau de commission</p>
          <span className="shrink-0 rounded-full border border-line-strong px-2.5 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">
            {salaried ? 'Salarié' : 'Agent commercial'}
          </span>
        </div>

        <dl className="mt-4 space-y-2">
          <Row label="Honoraires TTC" value={eur2(fees.inclTax)} muted />
          <Row label="Honoraires HT" value={eur2(fees.exclTax)} strong />
        </dl>

        <Divider />

        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted">Détail du calcul</p>
        {commission.lines.length > 0 ? (
          <ol className="mt-3 space-y-3">
            {commission.lines.map((line, i) => (
              <LineDetail key={i} line={line} />
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-[0.9rem] text-muted">Aucun palier atteint avec cette vente.</p>
        )}

        {/* Commission brute */}
        <div className="mt-5 flex items-end justify-between gap-4 border-t-2 border-ink pt-4">
          <p className="pb-1 text-[0.9rem] font-semibold leading-snug">
            Commission {payee}
            <span className="block text-[0.78rem] font-normal text-muted">{salaried ? 'brute' : 'HT, à facturer'}</span>
          </p>
          <p aria-live="polite" className="num font-display text-[2.1rem] leading-none tracking-tight" style={{ fontWeight: 520 }}>
            {formatEurSmart(commission.totalAmount)}
          </p>
        </div>

        {hasDeductions && (
          <dl className="mt-4 space-y-2">
            {deductions.map((d) => (
              <Row
                key={d.id}
                label={`${d.label}${d.mode === 'PERCENT_OF_COMMISSION' ? ` (${formatPercent(d.value)})` : ''}`}
                value={`− ${eur2(d.amount)}`}
                muted
              />
            ))}
            {result.deductionsCapped && (
              <p className="text-[0.78rem] text-[#9a3412]">Les retenues dépassent la commission : le net est ramené à 0 €.</p>
            )}
            <Row label="Commission nette de retenues" value={eur2(netCommission)} strong />
          </dl>
        )}

        {multi && (
          <div className="mt-5 rounded-xl bg-paper px-4 py-3">
            <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted">Répartition</p>
            <table className="num mt-2 w-full text-[0.88rem]">
              <caption className="sr-only">Répartition de la commission entre les intervenants</caption>
              <tbody>
                {participants.map((p) => (
                  <tr key={p.id}>
                    <th scope="row" className="py-1 text-left font-medium text-ink">
                      {p.label} <span className="font-normal text-muted">· {formatPercent(p.share)}</span>
                    </th>
                    <td className="py-1 text-right font-semibold text-ink">{eur2(hasDeductions ? p.net : p.gross)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <dl className="mt-5 space-y-2">
          <Row label="Reste à l'agence (HT)" value={eur2(agencyShare)} />
        </dl>

        <p className="mt-4 text-[0.78rem] leading-snug text-muted">
          {salaried
            ? 'Montant brut, avant cotisations salariales, versé avec le salaire.'
            : 'Montant hors taxes que l’agent facture à l’agence, avant cotisations sociales et impôt.'}
        </p>
      </div>

      {/* Prochain palier */}
      {progress && (
        <div className="mx-3 rounded-2xl bg-lime-soft px-4 py-4 sm:mx-4 sm:px-5">
          {progress.nextTier && progress.remainingToNextTier !== null ? (
            <>
              <p className="text-[0.88rem] leading-snug text-ink">
                Encore <strong className="num font-semibold">{formatEur(progress.remainingToNextTier)}</strong> d'honoraires pour passer à{' '}
                <strong className="font-semibold">{formatPercent(progress.nextTier.rate)}</strong>
              </p>
              <div
                className="relative mt-3 h-2.5 rounded-full bg-[#dfe6c4]"
                role="img"
                aria-label={`Progression vers le prochain palier : ${Math.round(progress.progressToNextTier * 100)} %`}
              >
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-ink transition-[width] duration-500 ease-out"
                  style={{ width: `${Math.max(4, progress.progressToNextTier * 100)}%` }}
                >
                  <span className="absolute -right-2 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border-2 border-ink bg-lime" />
                </div>
              </div>
              <div className="num mt-2 flex justify-between text-[0.75rem] text-muted">
                <span>{formatEur(progress.currentTier?.min ?? 0)}</span>
                <span>{formatEur(progress.nextTier.min)}</span>
              </div>
            </>
          ) : (
            <p className="text-[0.88rem] leading-snug text-ink">
              <strong className="font-semibold">Dernier palier atteint</strong> ({formatPercent(progress.currentTier?.rate ?? 0)}) avec{' '}
              <span className="num">{formatEur(progress.cumulativeBasis)}</span> d'honoraires cumulés.
            </p>
          )}
        </div>
      )}

      {/* Projection annuelle */}
      <div className="px-6 pb-6 pt-6 sm:px-7">
        <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-muted">Projection sur une année</p>
        <p className="mt-2 text-[0.9rem] leading-snug text-ink-soft">
          À ce rythme, sur <strong className="text-ink">{salesPerYear} vente{salesPerYear > 1 ? 's' : ''}</strong> comparable
          {salesPerYear > 1 ? 's' : ''} dans l'année :
        </p>
        <dl className="mt-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-paper px-3.5 py-3">
            <dt className="text-[0.75rem] text-muted">Honoraires HT</dt>
            <dd className="num mt-1 text-[1.05rem] font-semibold text-ink">{formatEur(projection.totalFeesExclTax)}</dd>
          </div>
          <div className="rounded-xl bg-paper px-3.5 py-3">
            <dt className="text-[0.75rem] text-muted">
              Rémunération {hasDeductions ? 'nette' : salaried ? 'brute' : 'HT'}
              {multi ? ' (équipe)' : ''}
            </dt>
            <dd className="num mt-1 text-[1.05rem] font-semibold text-ink">
              {formatEur(hasDeductions ? projection.netCommission : projection.grossCommission)}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[0.78rem] text-muted">
          Soit <span className="num">{formatPercent(Math.round(projection.effectiveRate * 1000) / 1000)}</span> des honoraires en moyenne
          (avant retenues).
        </p>
        <ProjectionChart projection={projection} showNet={hasDeductions} />
      </div>

      {actions && <div className="border-t border-line px-6 py-5 sm:px-7">{actions}</div>}
    </div>
  );
}
