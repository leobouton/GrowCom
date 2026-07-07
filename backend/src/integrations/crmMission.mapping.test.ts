/**
 * crmMission.mapping.test.ts
 * Tests unitaires — mapping CRM (HubSpot line items / Odoo abonnements) → Mission.
 */

import { describe, it, expect } from 'vitest';
import {
  hubspotFreqToMonths,
  parseIso8601Months,
  mapHubspotLineItemsToMission,
  mapHubspotLineItemToConsultantMissions,
  mapOdooSubscriptionStatus,
  mapOdooSubscriptionToMission,
  mapOdooSubscriptionToConsultantMissions,
  type HubspotLineItem,
  type OdooSubscriptionOrder,
} from './crmMission.mapping';
import { MissionStatus, MissionType } from '@prisma/client';

const NOW = new Date('2026-07-01T00:00:00Z');

function lineItem(partial: Partial<HubspotLineItem>): HubspotLineItem {
  return {
    id: 'li1',
    dealId: 'deal1',
    recurringBillingFrequency: 'monthly',
    recurringBillingPeriod: null,
    quantity: 1,
    hsMrr: null,
    price: null,
    amount: null,
    costOfGoodsSold: null,
    billingStartDate: null,
    ...partial,
  };
}

// ─── Helpers de fréquence / durée ────────────────────────────────────────────

describe('hubspotFreqToMonths', () => {
  it('mappe les fréquences connues', () => {
    expect(hubspotFreqToMonths('monthly')).toBe(1);
    expect(hubspotFreqToMonths('quarterly')).toBe(3);
    expect(hubspotFreqToMonths('per_six_months')).toBe(6);
    expect(hubspotFreqToMonths('annually')).toBe(12);
  });
  it('retombe sur 1 pour une valeur inconnue ou nulle', () => {
    expect(hubspotFreqToMonths(null)).toBe(1);
    expect(hubspotFreqToMonths('weekly')).toBe(1);
  });
});

describe('parseIso8601Months', () => {
  it('parse les durées en mois/années', () => {
    expect(parseIso8601Months('P24M')).toBe(24);
    expect(parseIso8601Months('P2Y')).toBe(24);
    expect(parseIso8601Months('P1Y6M')).toBe(18);
  });
  it('retourne null si absent ou invalide', () => {
    expect(parseIso8601Months(null)).toBeNull();
    expect(parseIso8601Months('bogus')).toBeNull();
  });
});

// ─── HubSpot ─────────────────────────────────────────────────────────────────

describe('mapHubspotLineItemsToMission', () => {
  it('retourne null si aucun line item récurrent', () => {
    const result = mapHubspotLineItemsToMission(
      [lineItem({ recurringBillingFrequency: null })],
      { closeDate: null },
      NOW,
    );
    expect(result).toBeNull();
  });

  it('mappe un line item mensuel avec hs_mrr', () => {
    const result = mapHubspotLineItemsToMission(
      [lineItem({ hsMrr: 3000, quantity: 2, billingStartDate: '2026-01-01' })],
      { closeDate: null },
      NOW,
    );
    expect(result).not.toBeNull();
    expect(result!.monthlyAmount).toBe(3000);
    expect(result!.consultantCount).toBe(2);
    expect(result!.status).toBe(MissionStatus.ACTIVE);
    expect(result!.type).toBe(MissionType.MARGIN_MENSUELLE);
  });

  it('normalise un abonnement annuel sans hs_mrr (prix × quantité / 12)', () => {
    const result = mapHubspotLineItemsToMission(
      [lineItem({ recurringBillingFrequency: 'annually', hsMrr: null, price: 12000, quantity: 1 })],
      { closeDate: null },
      NOW,
    );
    expect(result!.monthlyAmount).toBe(1000); // 12000 / 12
  });

  it('somme les quantités sur plusieurs lignes récurrentes', () => {
    const result = mapHubspotLineItemsToMission(
      [
        lineItem({ id: 'a', hsMrr: 1000, quantity: 1 }),
        lineItem({ id: 'b', hsMrr: 2000, quantity: 3 }),
      ],
      { closeDate: null },
      NOW,
    );
    expect(result!.monthlyAmount).toBe(3000);
    expect(result!.consultantCount).toBe(4);
  });

  it('calcule la marge mensuelle si un coût est présent', () => {
    const result = mapHubspotLineItemsToMission(
      [lineItem({ hsMrr: 5000, quantity: 1, costOfGoodsSold: 3000 })],
      { closeDate: null },
      NOW,
    );
    expect(result!.marginAmount).toBe(2000); // 5000 - 3000
    expect(result!.marginSource).toBe('HUBSPOT');
  });

  it('laisse la marge nulle si aucun coût', () => {
    const result = mapHubspotLineItemsToMission(
      [lineItem({ hsMrr: 5000 })],
      { closeDate: null },
      NOW,
    );
    expect(result!.marginAmount).toBeNull();
    expect(result!.marginSource).toBeNull();
  });

  it('déduit la date de fin depuis le terme et marque ENDED si dépassé', () => {
    const result = mapHubspotLineItemsToMission(
      [lineItem({ hsMrr: 1000, billingStartDate: '2024-01-01', recurringBillingPeriod: 'P12M' })],
      { closeDate: null },
      NOW,
    );
    expect(result!.expectedEndDate).not.toBeNull();
    expect(result!.status).toBe(MissionStatus.ENDED); // fin 2025-01, avant NOW (2026-07)
  });

  it('utilise la date de clôture du deal si aucune date de début de facturation', () => {
    const result = mapHubspotLineItemsToMission(
      [lineItem({ hsMrr: 1000, billingStartDate: null })],
      { closeDate: '2026-03-15' },
      NOW,
    );
    expect(result!.startDate.getUTCFullYear()).toBe(2026);
    expect(result!.startDate.getUTCMonth()).toBe(2); // mars
  });
});

// ─── Odoo ────────────────────────────────────────────────────────────────────

describe('mapOdooSubscriptionStatus', () => {
  it('actif pour un abonnement en cours', () => {
    expect(mapOdooSubscriptionStatus('3_progress', null, NOW)).toBe(MissionStatus.ACTIVE);
  });
  it('terminé pour churn ou renewed', () => {
    expect(mapOdooSubscriptionStatus('6_churn', null, NOW)).toBe(MissionStatus.ENDED);
    expect(mapOdooSubscriptionStatus('5_renewed', null, NOW)).toBe(MissionStatus.ENDED);
  });
  it('terminé si la date de fin est dépassée, même en cours', () => {
    expect(mapOdooSubscriptionStatus('3_progress', new Date('2025-01-01'), NOW)).toBe(MissionStatus.ENDED);
  });
});

describe('mapOdooSubscriptionToMission', () => {
  const baseOrder: OdooSubscriptionOrder = {
    id: 42,
    recurringMonthly: 4500,
    subscriptionState: '3_progress',
    startDate: '2026-05-01',
    nextInvoiceDate: '2026-08-01',
    endDate: null,
  };

  it('mappe un abonnement actif', () => {
    const result = mapOdooSubscriptionToMission(baseOrder, 3, NOW);
    expect(result.monthlyAmount).toBe(4500);
    expect(result.consultantCount).toBe(3);
    expect(result.status).toBe(MissionStatus.ACTIVE);
    expect(result.marginAmount).toBeNull(); // marge mensuelle non fiable côté Odoo
    expect(result.type).toBe(MissionType.MARGIN_MENSUELLE);
  });

  it('force consultantCount à au moins 1', () => {
    const result = mapOdooSubscriptionToMission(baseOrder, 0, NOW);
    expect(result.consultantCount).toBe(1);
  });

  it('utilise next_invoice_date si start_date absent', () => {
    const result = mapOdooSubscriptionToMission(
      { ...baseOrder, startDate: null, nextInvoiceDate: '2026-06-01' },
      1,
      NOW,
    );
    expect(result.startDate.getUTCMonth()).toBe(5); // juin
  });

  it('marque ENDED si la date de fin est passée', () => {
    const result = mapOdooSubscriptionToMission(
      { ...baseOrder, endDate: '2026-01-01' },
      1,
      NOW,
    );
    expect(result.status).toBe(MissionStatus.ENDED);
  });
});

// ─── Éclatement par consultant (une ligne par consultant placé) ──────────────

describe('mapHubspotLineItemToConsultantMissions', () => {
  it('retourne [] si le line item n\'est pas récurrent', () => {
    const result = mapHubspotLineItemToConsultantMissions(
      lineItem({ recurringBillingFrequency: null }),
      { closeDate: null },
      NOW,
    );
    expect(result).toEqual([]);
  });

  it('produit une mission unique (clé = id du line item) pour quantité 1', () => {
    const result = mapHubspotLineItemToConsultantMissions(
      lineItem({ id: 'li42', hsMrr: 6000, quantity: 1 }),
      { closeDate: '2026-05-01' },
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].missionKey).toBe('li42');
    expect(result[0].monthlyAmount).toBe(6000);
    expect(result[0].consultantCount).toBe(1);
  });

  it('éclate une quantité de 2 en 2 missions de 1 consultant avec MRR divisé', () => {
    const result = mapHubspotLineItemToConsultantMissions(
      lineItem({ id: 'li7', hsMrr: 12000, quantity: 2, costOfGoodsSold: 4000 }),
      { closeDate: '2026-05-01' },
      NOW,
    );
    expect(result).toHaveLength(2);
    expect(result.map((m) => m.missionKey)).toEqual(['li7-c1', 'li7-c2']);
    for (const m of result) {
      expect(m.monthlyAmount).toBe(6000);
      expect(m.consultantCount).toBe(1);
      // coût unitaire 4000/mois → marge par consultant = 6000 - 4000
      expect(m.marginAmount).toBe(2000);
      expect(m.marginSource).toBe('HUBSPOT');
    }
  });

  it('déduit le MRR par consultant depuis prix × quantité si hs_mrr absent', () => {
    const result = mapHubspotLineItemToConsultantMissions(
      lineItem({ id: 'li9', hsMrr: null, price: 9000, quantity: 3, recurringBillingFrequency: 'quarterly' }),
      { closeDate: '2026-05-01' },
      NOW,
    );
    // (9000 × 3) / 3 mois = 9000 de MRR total → 3000 par consultant
    expect(result).toHaveLength(3);
    expect(result[0].monthlyAmount).toBe(3000);
  });
});

describe('mapOdooSubscriptionToConsultantMissions', () => {
  const order: OdooSubscriptionOrder = {
    id: 555,
    recurringMonthly: 15000,
    subscriptionState: '3_progress',
    startDate: '2026-06-01',
    nextInvoiceDate: null,
    endDate: null,
  };

  it('produit une mission unique (clé = id de commande) pour 1 consultant', () => {
    const result = mapOdooSubscriptionToConsultantMissions(order, 1, NOW);
    expect(result).toHaveLength(1);
    expect(result[0].missionKey).toBe('555');
    expect(result[0].monthlyAmount).toBe(15000);
    expect(result[0].consultantCount).toBe(1);
  });

  it('éclate 3 consultants en 3 missions avec MRR réparti à parts égales', () => {
    const result = mapOdooSubscriptionToConsultantMissions(order, 3, NOW);
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.missionKey)).toEqual(['555-c1', '555-c2', '555-c3']);
    for (const m of result) {
      expect(m.monthlyAmount).toBe(5000);
      expect(m.consultantCount).toBe(1);
      expect(m.status).toBe(MissionStatus.ACTIVE);
    }
  });

  it('force au moins 1 consultant', () => {
    const result = mapOdooSubscriptionToConsultantMissions(order, 0, NOW);
    expect(result).toHaveLength(1);
  });
});
