/**
 * Commission de chaque vente sur une année (une seule série : barres encre, fines,
 * arrondies en haut, 2 px d'écart). Survol / focus = info-bulle ; le tableau
 * vente par vente reste disponible en dessous pour la lecture sans graphique.
 */
import { useState } from 'react';
import type { AnnualProjection } from '@shared/commission-engine';
import { formatEur, formatEurSmart, formatPercent } from '../../lib/format';

interface Props {
  projection: AnnualProjection;
  showNet: boolean;
}

const CHART_HEIGHT = 128;

export function ProjectionChart({ projection, showNet }: Props) {
  const [active, setActive] = useState<number | null>(null);
  const values = projection.sales.map((s) => (showNet ? s.net : s.gross));
  const max = Math.max(...values, 1);
  const activeSale = active !== null ? projection.sales[active] : null;
  // Ventes où un nouveau palier est atteint : repérées sous l'axe
  const tierChanges = new Set(
    projection.sales.filter((s, i) => i > 0 && s.reachedRate !== projection.sales[i - 1].reachedRate).map((s) => s.index),
  );

  if (projection.sales.length === 0) return null;

  return (
    <figure className="mt-4">
      <figcaption className="text-[0.78rem] font-medium text-muted">
        Commission {showNet ? 'nette' : 'brute'} de chaque vente, de janvier à décembre
      </figcaption>

      <div className="relative mt-3" onMouseLeave={() => setActive(null)}>
        {/* Info-bulle */}
        <div
          aria-hidden="true"
          className={[
            'pointer-events-none absolute -top-2 left-0 right-0 z-10 flex justify-center transition-opacity',
            activeSale ? 'opacity-100' : 'opacity-0',
          ].join(' ')}
        >
          {activeSale && (
            <div className="num -translate-y-full rounded-lg bg-ink px-3 py-2 text-[0.78rem] leading-snug text-paper shadow-lg">
              <span className="font-semibold">Vente {activeSale.index}</span> · {formatEurSmart(showNet ? activeSale.net : activeSale.gross)}
              <br />
              <span className="text-paper/70">
                CA cumulé {formatEur(activeSale.cumulativeFees)}
                {activeSale.reachedRate !== null && ` · palier ${formatPercent(activeSale.reachedRate)}`}
              </span>
            </div>
          )}
        </div>

        <div className="flex items-end gap-[2px] border-b border-line-strong" style={{ height: CHART_HEIGHT }}>
          {projection.sales.map((sale, i) => {
            const value = values[i];
            const height = value > 0 ? Math.max(3, (value / max) * CHART_HEIGHT) : 0;
            const isActive = active === i;
            return (
              // Survol à la souris uniquement : au clavier et au lecteur d'écran, le tableau ci-dessous fait foi
              <div
                key={sale.index}
                aria-hidden="true"
                onMouseEnter={() => setActive(i)}
                className="flex h-full min-w-0 flex-1 items-end"
              >
                <span
                  className={['block w-full rounded-t-[4px] transition-colors', isActive ? 'bg-primary-600' : 'bg-ink'].join(' ')}
                  style={{ height }}
                />
              </div>
            );
          })}
        </div>

        <div className="num mt-1.5 flex gap-[2px] text-[0.68rem] text-muted" aria-hidden="true">
          {projection.sales.map((sale) => (
            <span key={sale.index} className="min-w-0 flex-1 text-center">
              {tierChanges.has(sale.index) ? (
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-lime ring-1 ring-ink" />
              ) : projection.sales.length <= 14 || sale.index === 1 || sale.index === projection.sales.length ? (
                sale.index
              ) : null}
            </span>
          ))}
        </div>
      </div>

      {tierChanges.size > 0 && (
        <p className="mt-2 flex items-center gap-2 text-[0.75rem] text-muted">
          <span aria-hidden="true" className="inline-block h-1.5 w-1.5 rounded-full bg-lime ring-1 ring-ink" />
          nouveau palier atteint
        </p>
      )}

      <details className="mt-3 text-[0.8rem]">
        <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">Voir le détail vente par vente</summary>
        <div className="mt-2 max-h-64 overflow-auto rounded-lg border border-line">
          <table className="num w-full text-left text-[0.78rem]">
            <thead className="sticky top-0 bg-paper text-ink">
              <tr>
                <th scope="col" className="px-2.5 py-1.5 font-semibold">Vente</th>
                <th scope="col" className="px-2.5 py-1.5 font-semibold">CA cumulé HT</th>
                <th scope="col" className="px-2.5 py-1.5 text-right font-semibold">Commission</th>
              </tr>
            </thead>
            <tbody>
              {projection.sales.map((sale) => (
                <tr key={sale.index} className="border-t border-line">
                  <td className="px-2.5 py-1.5">{sale.index}</td>
                  <td className="px-2.5 py-1.5">{formatEur(sale.cumulativeFees)}</td>
                  <td className="px-2.5 py-1.5 text-right">{formatEurSmart(showNet ? sale.net : sale.gross)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}
