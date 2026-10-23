/**
 * Détails dépliables des cartes du tableau de bord manager / responsable de secteur
 * (« En attente de validation », « Payées »). Fonctions pures, testées à part.
 */
import type { PaidSellerBreakdown, PendingTeamBreakdown } from '../../../shared/types';

interface PendingItem {
  id: string;
  userId: string;
  amount: number;
}

interface TeamInfo {
  id: string;
  name: string;
  color: string | null;
  leadId: string | null;
  leadName: string | null;
}

interface SellerInfo {
  groupId: string | null;
  isTeamLead: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Équipe d'un vendeur : celle dont il est membre ; à défaut, un responsable
 * d'équipe qui n'est membre d'aucune équipe est rattaché à celle qu'il dirige.
 */
function teamResolver(teams: TeamInfo[]) {
  const teamById = new Map(teams.map((t) => [t.id, t]));
  const teamLedBy = new Map<string, TeamInfo>();
  for (const t of teams) if (t.leadId) teamLedBy.set(t.leadId, t);
  return (userId: string, groupId: string | null | undefined): TeamInfo | undefined =>
    (groupId ? teamById.get(groupId) : undefined) ?? teamLedBy.get(userId);
}

/**
 * Ventile les commissions en attente (hors paiements différés) par équipe, pour
 * le détail de la carte « En attente de validation ».
 *
 * - `mineIds` = commissions présentes dans la file de validation du demandeur :
 *   tout le reste est validé par quelqu'un d'autre (`delegatedTo`).
 * - Toutes les équipes du périmètre sont listées, même à 0 € (« à jour ») ;
 *   la ligne « Sans équipe » n'apparaît que si elle a des ventes en attente.
 */
export function buildPendingByTeam(params: {
  due: PendingItem[];
  mineIds: Set<string>;
  sellers: Map<string, SellerInfo>;
  teams: TeamInfo[];
  callerId: string;
}): PendingTeamBreakdown[] {
  const { due, mineIds, sellers, teams, callerId } = params;
  const resolveTeam = teamResolver(teams);

  const NO_TEAM = '__none__';
  const rows = new Map<string, PendingTeamBreakdown>();
  for (const t of teams) {
    rows.set(t.id, {
      groupId: t.id,
      groupName: t.name,
      color: t.color,
      leadName: t.leadName,
      leadIsCaller: t.leadId === callerId,
      amount: 0,
      count: 0,
      myAmount: 0,
      myCount: 0,
      delegatedTo: null,
    });
  }

  for (const c of due) {
    const seller = sellers.get(c.userId);
    const team = resolveTeam(c.userId, seller?.groupId);
    const key = team?.id ?? NO_TEAM;

    let row = rows.get(key);
    if (!row) {
      row = {
        groupId: null,
        groupName: 'Sans équipe',
        color: null,
        leadName: null,
        leadIsCaller: false,
        amount: 0,
        count: 0,
        myAmount: 0,
        myCount: 0,
        delegatedTo: null,
      };
      rows.set(key, row);
    }

    row.amount += c.amount;
    row.count += 1;
    if (mineIds.has(c.id)) {
      row.myAmount += c.amount;
      row.myCount += 1;
    } else if (!row.delegatedTo && !seller?.isTeamLead && team?.leadId !== c.userId) {
      // Vente d'un membre : validée par le responsable de son équipe.
      // Vente d'un responsable : validée par le manager général (delegatedTo reste null).
      row.delegatedTo = team?.leadName ?? null;
    }
  }

  // Arrondi au centime (sommes de flottants)
  for (const row of rows.values()) {
    row.amount = round2(row.amount);
    row.myAmount = round2(row.myAmount);
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.amount - a.amount ||
      Number(a.groupId === null) - Number(b.groupId === null) ||
      a.groupName.localeCompare(b.groupName, 'fr'),
  );
}

/**
 * Commissions payées sur la période, par commercial (avec son équipe), pour le
 * détail de la carte « Payées ». Le front regroupe par équipe quand il y en a
 * plusieurs dans le périmètre, sinon il affiche les commerciaux.
 */
export function buildPaidBySeller(params: {
  paid: Array<{ userId: string; amount: number; count: number }>;
  sellers: Map<string, { name: string; groupId: string | null }>;
  teams: TeamInfo[];
}): PaidSellerBreakdown[] {
  const { paid, sellers, teams } = params;
  const resolveTeam = teamResolver(teams);

  return paid
    .filter((p) => p.count > 0)
    .map((p) => {
      const seller = sellers.get(p.userId);
      const team = resolveTeam(p.userId, seller?.groupId);
      return {
        userId: p.userId,
        name: seller?.name ?? 'Utilisateur supprimé',
        groupId: team?.id ?? null,
        groupName: team?.name ?? null,
        color: team?.color ?? null,
        amount: round2(p.amount),
        count: p.count,
      };
    })
    .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'fr'));
}
