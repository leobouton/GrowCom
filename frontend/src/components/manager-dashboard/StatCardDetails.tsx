import { useState, type ReactNode } from 'react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import type { CommissionWithDetails, PaidSellerBreakdown, PendingTeamBreakdown } from '@shared/types';

/**
 * Détails dépliables (petite flèche) sous les cartes chiffrées du tableau de bord
 * manager / responsable de secteur : même bouton et même présentation des lignes
 * sur les trois cartes.
 */

export function formatEur(amount: number) {
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(amount);
}

const plural = (n: number, word: string, pluralWord = `${word}s`) => `${n} ${n > 1 ? pluralWord : word}`;

// Au-delà, les plus petites lignes sont regroupées en « + N autres »
const MAX_ROWS = 5;

function StatDetailsToggle({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-4 border-t border-gray-100 pt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors"
      >
        {label}
        <svg className={`w-4 h-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="mt-3">{children}</div>}
    </div>
  );
}

function DetailRow({ color, name, amount, children }: {
  color?: string | null;
  name: string;
  amount: number;
  children?: ReactNode;
}) {
  return (
    <li className="text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0">
          {color !== undefined && (
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color ?? '#9ca3af' }} />
          )}
          <span className="font-medium text-gray-900 truncate">{name}</span>
        </span>
        <span className="font-semibold text-gray-900 whitespace-nowrap">{formatEur(amount)}</span>
      </div>
      {children && <p className={`mt-0.5 text-xs text-gray-500 ${color !== undefined ? 'pl-4' : ''}`}>{children}</p>}
    </li>
  );
}

function EmptyDetails({ children }: { children: ReactNode }) {
  return <p className="text-xs text-gray-400">{children}</p>;
}

// ─── En attente de validation : par équipe ────────────────────────────────────

/** Montant en attente par équipe, et qui doit le valider (vous, ou le responsable de l'équipe). */
export function PendingByTeamDetails({ rows }: { rows: PendingTeamBreakdown[] }) {
  // Aucune équipe dans l'entreprise : rien à détailler
  if (!rows.some((r) => r.groupId !== null)) return null;

  const statusLabel = (row: PendingTeamBreakdown) => {
    if (row.count === 0) return <span className="text-green-600">à jour</span>;
    const sales = plural(row.count, 'vente');
    if (row.myCount === row.count) {
      return <>{sales} · <span className="text-yellow-700">à vous de valider</span></>;
    }
    if (row.myCount === 0) {
      return <>{sales} · à valider par {row.delegatedTo ?? 'le manager général'}</>;
    }
    return <>{sales} · <span className="text-yellow-700">dont {formatEur(row.myAmount)} à vous de valider</span></>;
  };

  return (
    <StatDetailsToggle label="Détail par équipe">
      <ul className="space-y-3">
        {rows.map((row) => (
          <DetailRow key={row.groupId ?? 'sans-equipe'} color={row.color} name={row.groupName} amount={row.amount}>
            {row.groupId !== null && (
              <>
                {row.leadIsCaller ? 'Resp. : vous' : row.leadName ? `Resp. : ${row.leadName}` : 'Sans responsable'}
                {' · '}
              </>
            )}
            {statusLabel(row)}
          </DetailRow>
        ))}
      </ul>
    </StatDetailsToggle>
  );
}

// ─── Paiements différés : échéancier ──────────────────────────────────────────

/** Prochain versement, puis montants à verser mois par mois. */
export function DeferredScheduleDetails({ commissions }: { commissions: CommissionWithDetails[] }) {
  const dated = commissions
    .filter((c) => c.scheduledPaymentAt)
    .map((c) => ({ amount: c.amount, date: new Date(c.scheduledPaymentAt!) }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (dated.length === 0) {
    return (
      <StatDetailsToggle label="Échéancier">
        <EmptyDetails>Aucun paiement programmé pour le moment.</EmptyDetails>
      </StatDetailsToggle>
    );
  }

  const nextDay = format(dated[0].date, 'yyyy-MM-dd');
  const nextAmount = dated
    .filter((d) => format(d.date, 'yyyy-MM-dd') === nextDay)
    .reduce((sum, d) => sum + d.amount, 0);

  const months = new Map<string, { label: string; amount: number; count: number }>();
  for (const d of dated) {
    const key = format(d.date, 'yyyy-MM');
    const month = months.get(key) ?? { label: format(d.date, 'MMMM yyyy', { locale: fr }), amount: 0, count: 0 };
    month.amount += d.amount;
    month.count += 1;
    months.set(key, month);
  }

  return (
    <StatDetailsToggle label="Échéancier">
      <p className="text-xs text-gray-500 mb-3">
        Prochain versement le{' '}
        <span className="font-medium text-gray-700">{format(dated[0].date, 'd MMM yyyy', { locale: fr })}</span>
        {' · '}{formatEur(nextAmount)}
      </p>
      <ul className="space-y-3">
        {[...months.entries()].map(([key, m]) => (
          <DetailRow key={key} name={m.label.charAt(0).toUpperCase() + m.label.slice(1)} amount={m.amount}>
            {plural(m.count, 'commission')}
          </DetailRow>
        ))}
      </ul>
    </StatDetailsToggle>
  );
}

// ─── Payées : par équipe (manager) ou par commercial (responsable d'équipe) ───

interface PaidLine {
  key: string;
  name: string;
  color: string | null;
  amount: number;
  sub: string;
}

/**
 * Plusieurs équipes dans le périmètre → total par équipe, y compris celles à 0 €
 * (le détail par personne est déjà dans « Meilleurs vendeurs ») ; une seule équipe
 * ou aucune → par commercial.
 */
export function PaidDetails({ rows, teams }: {
  rows: PaidSellerBreakdown[];
  /** Équipes du périmètre (fixe d'un mois à l'autre, contrairement aux payés) */
  teams: Array<{ id: string; name: string; color: string | null }>;
}) {
  const byTeam = teams.length >= 2;
  const label = byTeam ? 'Détail par équipe' : 'Détail par commercial';

  if (rows.length === 0 && !byTeam) {
    return (
      <StatDetailsToggle label={label}>
        <EmptyDetails>Aucune commission payée sur la période.</EmptyDetails>
      </StatDetailsToggle>
    );
  }

  let lines: PaidLine[];
  if (byTeam) {
    const totals = new Map<string, { name: string; color: string | null; amount: number; count: number; sellers: number }>();
    for (const t of teams) totals.set(t.id, { name: t.name, color: t.color, amount: 0, count: 0, sellers: 0 });
    for (const r of rows) {
      const key = r.groupId ?? 'sans-equipe';
      const team = totals.get(key) ?? { name: r.groupName ?? 'Sans équipe', color: r.color, amount: 0, count: 0, sellers: 0 };
      team.amount += r.amount;
      team.count += r.count;
      team.sellers += 1;
      totals.set(key, team);
    }
    lines = [...totals.entries()]
      .map(([key, t]) => ({
        key,
        name: t.name,
        color: t.color,
        amount: t.amount,
        sub: t.count === 0
          ? 'aucune commission payée'
          : `${plural(t.count, 'commission')} · ${plural(t.sellers, 'commercial', 'commerciaux')}`,
      }))
      .sort((a, b) => b.amount - a.amount || Number(a.key === 'sans-equipe') - Number(b.key === 'sans-equipe'));
  } else {
    lines = rows.map((r) => ({
      key: r.userId,
      name: r.name,
      color: r.color,
      amount: r.amount,
      sub: `${r.groupName ? `${r.groupName} · ` : ''}${plural(r.count, 'commission')}`,
    }));
  }

  const shown = lines.length > MAX_ROWS ? lines.slice(0, MAX_ROWS - 1) : lines;
  const rest = lines.slice(shown.length);

  return (
    <StatDetailsToggle label={label}>
      <ul className="space-y-3">
        {shown.map((l) => (
          <DetailRow key={l.key} color={l.color} name={l.name} amount={l.amount}>
            {l.sub}
          </DetailRow>
        ))}
        {rest.length > 0 && (
          <DetailRow name={`+ ${rest.length} autres`} amount={rest.reduce((sum, l) => sum + l.amount, 0)} />
        )}
      </ul>
    </StatDetailsToggle>
  );
}
