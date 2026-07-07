import { MissionStatus, MissionType } from '@prisma/client';

/**
 * Fonctions de mapping PURES (sans réseau) CRM → Mission.
 * Isolées ici pour être testables unitairement (Lot 2 : tests de mapping).
 *
 * Note produit : `Mission.type` est descriptif et vaut MARGIN_MENSUELLE par défaut.
 * Le mode de rémunération réel (% de marge vs forfait par consultant) est choisi
 * au niveau du composant de plan, PAS figé dans la Mission. On capte donc TOUJOURS
 * `consultantCount` pour que le forfait/consultant reste calculable quel que soit le type.
 */

export interface MissionMapping {
  monthlyAmount: number;
  consultantCount: number;
  startDate: Date;
  expectedEndDate: Date | null;
  status: MissionStatus;
  marginAmount: number | null;
  marginSource: string | null;
  type: MissionType;
}

// ─── Helpers de fréquence / durée ────────────────────────────────────────────

/** Convertit une fréquence de facturation HubSpot en nombre de mois par période. */
export function hubspotFreqToMonths(freq: string | null): number {
  switch ((freq ?? '').toLowerCase()) {
    case 'monthly': return 1;
    case 'quarterly': return 3;
    case 'per_six_months': return 6;
    case 'annually': return 12;
    default: return 1;
  }
}

/** Parse une durée ISO-8601 (ex: "P24M", "P2Y", "P1Y6M") en nombre de mois. */
export function parseIso8601Months(period: string | null): number | null {
  if (!period) return null;
  const m = /^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?$/.exec(period.trim());
  if (!m) return null;
  const years = m[1] ? parseInt(m[1], 10) : 0;
  const months = m[2] ? parseInt(m[2], 10) : 0;
  const weeks = m[3] ? parseInt(m[3], 10) : 0;
  const days = m[4] ? parseInt(m[4], 10) : 0;
  const total = years * 12 + months + weeks * (7 / 30.44) + days / 30.44;
  return total > 0 ? total : null;
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const whole = Math.round(months);
  d.setMonth(d.getMonth() + whole);
  return d;
}

// ─── HubSpot ─────────────────────────────────────────────────────────────────

export interface HubspotLineItem {
  id: string;
  dealId: string | null;
  recurringBillingFrequency: string | null; // 'monthly' | 'quarterly' | 'per_six_months' | 'annually'
  recurringBillingPeriod: string | null;    // ISO-8601, ex: 'P24M'
  quantity: number;
  hsMrr: number | null;                      // monthly recurring revenue de la ligne
  price: number | null;                      // prix unitaire
  amount: number | null;                     // montant de la ligne
  costOfGoodsSold: number | null;            // coût unitaire (hs_cost_of_goods_sold)
  billingStartDate: string | null;
}

/**
 * Agrège les line items récurrents d'un deal HubSpot en une Mission.
 * Retourne null si aucun line item récurrent (→ pas de mission, pas de crash).
 */
export function mapHubspotLineItemsToMission(
  lineItems: HubspotLineItem[],
  deal: { closeDate: string | null },
  now: Date = new Date(),
): MissionMapping | null {
  const recurring = lineItems.filter(
    (li) => li.recurringBillingFrequency && li.recurringBillingFrequency.trim() !== '',
  );
  if (recurring.length === 0) return null;

  let monthlyAmount = 0;
  let monthlyCost = 0;
  let hasCost = false;
  let consultantCount = 0;
  let startDate: Date | null = null;
  let maxTermMonths: number | null = null;

  for (const li of recurring) {
    const months = hubspotFreqToMonths(li.recurringBillingFrequency);
    const qty = Number.isFinite(li.quantity) ? li.quantity : 0;
    consultantCount += qty;

    // Revenu mensuel : hs_mrr si présent, sinon (prix × quantité) normalisé par la fréquence
    const lineMrr = li.hsMrr != null
      ? li.hsMrr
      : ((li.price ?? li.amount ?? 0) * (qty || 1)) / months;
    monthlyAmount += lineMrr;

    if (li.costOfGoodsSold != null) {
      hasCost = true;
      monthlyCost += (li.costOfGoodsSold * (qty || 1)) / months;
    }

    if (li.billingStartDate) {
      const d = new Date(li.billingStartDate);
      if (!Number.isNaN(d.getTime()) && (startDate === null || d < startDate)) startDate = d;
    }

    const term = parseIso8601Months(li.recurringBillingPeriod);
    if (term != null && (maxTermMonths === null || term > maxTermMonths)) maxTermMonths = term;
  }

  if (startDate === null) {
    startDate = deal.closeDate ? new Date(deal.closeDate) : new Date(now);
    if (Number.isNaN(startDate.getTime())) startDate = new Date(now);
  }

  const expectedEndDate = maxTermMonths != null ? addMonths(startDate, maxTermMonths) : null;
  const status = expectedEndDate != null && expectedEndDate < now ? MissionStatus.ENDED : MissionStatus.ACTIVE;

  const marginAmount = hasCost ? monthlyAmount - monthlyCost : null;
  const marginSource = hasCost ? 'HUBSPOT' : null;

  return {
    monthlyAmount: round2(monthlyAmount),
    consultantCount: Math.max(1, Math.round(consultantCount)),
    startDate,
    expectedEndDate,
    status,
    marginAmount: marginAmount != null ? round2(marginAmount) : null,
    marginSource,
    type: MissionType.MARGIN_MENSUELLE,
  };
}

/**
 * Éclate un line item récurrent HubSpot en UNE MISSION PAR CONSULTANT placé.
 * Un line item de quantité N (N consultants du même profil) produit N missions
 * de 1 consultant chacune, avec revenu/marge mensuels divisés par N.
 * Retourne [] si le line item n'est pas récurrent.
 *
 * `missionKey` sert de hubspotId de mission (stable et idempotent) :
 * l'id du line item, suffixé -cN si la quantité dépasse 1.
 */
export function mapHubspotLineItemToConsultantMissions(
  li: HubspotLineItem,
  deal: { closeDate: string | null },
  now: Date = new Date(),
): Array<MissionMapping & { missionKey: string }> {
  if (!li.recurringBillingFrequency || li.recurringBillingFrequency.trim() === '') return [];

  const months = hubspotFreqToMonths(li.recurringBillingFrequency);
  const qty = Math.max(1, Math.round(Number.isFinite(li.quantity) && li.quantity > 0 ? li.quantity : 1));

  // Revenu mensuel de la ligne : hs_mrr si présent, sinon (prix × quantité) normalisé
  const lineMrr = li.hsMrr != null
    ? li.hsMrr
    : ((li.price ?? li.amount ?? 0) * qty) / months;
  const perConsultantMrr = lineMrr / qty;

  // costOfGoodsSold est un coût UNITAIRE par période de facturation
  const perConsultantCost = li.costOfGoodsSold != null ? li.costOfGoodsSold / months : null;
  const marginAmount = perConsultantCost != null ? round2(perConsultantMrr - perConsultantCost) : null;

  let startDate: Date | null = li.billingStartDate ? new Date(li.billingStartDate) : null;
  if (startDate === null || Number.isNaN(startDate.getTime())) {
    startDate = deal.closeDate ? new Date(deal.closeDate) : new Date(now);
    if (Number.isNaN(startDate.getTime())) startDate = new Date(now);
  }

  const term = parseIso8601Months(li.recurringBillingPeriod);
  const expectedEndDate = term != null ? addMonths(startDate, term) : null;
  const status = expectedEndDate != null && expectedEndDate < now ? MissionStatus.ENDED : MissionStatus.ACTIVE;

  return Array.from({ length: qty }, (_, i) => ({
    missionKey: qty > 1 ? `${li.id}-c${i + 1}` : li.id,
    monthlyAmount: round2(perConsultantMrr),
    consultantCount: 1,
    startDate: startDate!,
    expectedEndDate,
    status,
    marginAmount,
    marginSource: perConsultantCost != null ? 'HUBSPOT' : null,
    type: MissionType.MARGIN_MENSUELLE,
  }));
}

// ─── Odoo ────────────────────────────────────────────────────────────────────

export interface OdooSubscriptionOrder {
  id: number;
  recurringMonthly: number;           // recurring_monthly (MRR)
  subscriptionState: string | null;   // subscription_state (ex: '3_progress', '6_churn')
  startDate: string | null;           // start_date
  nextInvoiceDate: string | null;     // next_invoice_date
  endDate: string | null;             // end_date
}

/**
 * Statut Odoo subscription_state → MissionStatus.
 * Actif : '3_progress', '7_upsell'. Terminé : '5_renewed', '6_churn'.
 * Une date de fin dépassée force ENDED.
 */
export function mapOdooSubscriptionStatus(
  subscriptionState: string | null,
  expectedEndDate: Date | null,
  now: Date = new Date(),
): MissionStatus {
  if (expectedEndDate != null && expectedEndDate < now) return MissionStatus.ENDED;
  const s = (subscriptionState ?? '').toLowerCase();
  if (s === '5_renewed' || s === '6_churn') return MissionStatus.ENDED;
  return MissionStatus.ACTIVE;
}

/**
 * Mappe un abonnement Odoo (sale.order) + nb de consultants (somme des quantités
 * de lignes) en Mission. `consultantCount` est fourni par l'appelant (lecture des
 * sale.order.line). La marge mensuelle Odoo n'étant pas fiable au niveau mensuel,
 * marginAmount reste null → une règle « % de marge » donne 0 € sur ces missions
 * (décision Léo 2026-07-06 : marge inconnue = commission à 0, pas de repli CA).
 * Les règles sur CA (REVENUE) et forfait/consultant (PER_UNIT) ne sont pas affectées.
 */
export function mapOdooSubscriptionToMission(
  order: OdooSubscriptionOrder,
  consultantCount: number,
  now: Date = new Date(),
): MissionMapping {
  const startDate = order.startDate
    ? new Date(order.startDate)
    : order.nextInvoiceDate
      ? new Date(order.nextInvoiceDate)
      : new Date(now);
  const start = Number.isNaN(startDate.getTime()) ? new Date(now) : startDate;

  const expectedEndDate = order.endDate ? new Date(order.endDate) : null;
  const end = expectedEndDate && !Number.isNaN(expectedEndDate.getTime()) ? expectedEndDate : null;

  return {
    monthlyAmount: round2(order.recurringMonthly ?? 0),
    consultantCount: Math.max(1, Math.round(consultantCount)),
    startDate: start,
    expectedEndDate: end,
    status: mapOdooSubscriptionStatus(order.subscriptionState, end, now),
    marginAmount: null,
    marginSource: null,
    type: MissionType.MARGIN_MENSUELLE,
  };
}

/**
 * Éclate un abonnement Odoo en UNE MISSION PAR CONSULTANT placé (une ligne par
 * consultant dans le dashboard). Le MRR de la commande est réparti à parts égales
 * entre les consultants (somme des quantités de lignes, minimum 1).
 * `missionKey` sert d'odooId de mission : l'id de la commande, suffixé -cN si
 * plusieurs consultants.
 */
export function mapOdooSubscriptionToConsultantMissions(
  order: OdooSubscriptionOrder,
  consultantCount: number,
  now: Date = new Date(),
): Array<MissionMapping & { missionKey: string }> {
  const count = Math.max(1, Math.round(consultantCount));
  const base = mapOdooSubscriptionToMission(order, count, now);
  const perConsultantAmount = round2(base.monthlyAmount / count);

  return Array.from({ length: count }, (_, i) => ({
    ...base,
    missionKey: count > 1 ? `${order.id}-c${i + 1}` : String(order.id),
    monthlyAmount: perConsultantAmount,
    consultantCount: 1,
  }));
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
