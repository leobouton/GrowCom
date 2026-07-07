import { logger } from '../config/logger';
import { dealRepository } from '../repositories/deal.repository';
import { dealAssignmentRepository } from '../repositories/dealAssignment.repository';
import { missionRepository } from '../repositories/mission.repository';
import { userRepository } from '../repositories/user.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { commissionService } from '../services/commission.service';
import { AppError } from '../middlewares/errorHandler';
import { DealStatus as PrismaDealStatus, CommissionStatus as PrismaCommissionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { HubspotLineItem, mapHubspotLineItemToConsultantMissions } from './crmMission.mapping';

const HUBSPOT_API = 'https://api.hubapi.com';
const HUBSPOT_PAGE_SIZE = 100;
const HUBSPOT_MAX_PAGES = 100; // garde-fou : 100 pages * 100 = 10 000 deals max
const REQUEST_TIMEOUT_MS = 30_000;

// Propriétés HubSpot demandées sur chaque deal.
// growcom_margin est une propriété custom optionnelle : si elle n'existe pas, HubSpot l'ignore simplement.
const DEAL_PROPERTIES = [
  'dealname',
  'amount',
  'dealstage',
  'closedate',
  'hubspot_owner_id',
  'pipeline',
  'growcom_margin',
  'dealtype',        // Type de vente natif HubSpot (ou valeurs custom : Recrutement, Formation, Portage…)
  'growcom_dealtype', // Propriété custom optionnelle, prioritaire sur dealtype si présente
];

// ─── Types HubSpot ──────────────────────────────────────────────────────────

interface HubspotDeal {
  id: string;
  properties: Record<string, string | null>;
  associations?: {
    companies?: { results?: Array<{ id: string }> };
  };
}

interface HubspotPagedResponse<T> {
  results: T[];
  paging?: { next?: { after?: string } };
}

interface HubspotLineItemRaw {
  id: string;
  properties: Record<string, string | null>;
  associations?: {
    deals?: { results?: Array<{ id: string }> };
  };
}

// Deal normalisé interne (proche d'OdooCrmLead)
interface NormalizedHubspotDeal {
  id: string;
  name: string;
  amount: number;
  stageId: string;
  closeDate: string | null;
  ownerId: string | null;
  companyId: string | null;
  margin: number | null;
  dealType: string | null; // growcom_dealtype > dealtype (type de vente pour le moteur de règles)
}

// ─── Appels HTTP ──────────────────────────────────────────────────────────────

async function hubspotFetch<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(`${HUBSPOT_API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError(504, 'HUBSPOT_TIMEOUT', 'HubSpot ne répond pas (timeout 30s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) {
    throw new AppError(401, 'HUBSPOT_AUTH_FAILED', 'Token HubSpot invalide ou périmètres insuffisants — vérifiez votre Private App');
  }
  if (!response.ok) {
    let detail = '';
    try {
      const body = (await response.json()) as { message?: string };
      detail = body?.message ? ` (${body.message})` : '';
    } catch {
      /* corps non JSON */
    }
    throw new AppError(502, 'HUBSPOT_HTTP', `Erreur HubSpot (HTTP ${response.status})${detail}`);
  }

  return (await response.json()) as T;
}

// ─── Mapping stage → statut GrowCom ───────────────────────────────────────────

function mapHubspotStageToStatus(
  stageId: string,
  stageMap: Map<string, PrismaDealStatus>,
): PrismaDealStatus {
  return stageMap.get(stageId) ?? PrismaDealStatus.OPEN;
}

// ─── Service public ───────────────────────────────────────────────────────────

export const hubspotService = {
  /**
   * Vérifie la validité du token via un appel léger (1 deal).
   * Lève une AppError 401 si le token est invalide.
   */
  async authenticate(token: string): Promise<void> {
    await hubspotFetch(token, '/crm/v3/objects/deals?limit=1');
  },

  /**
   * Récupère l'identifiant du portail (hub_id) lié au token.
   * Renvoie null en cas d'échec (champ purement informatif).
   */
  async fetchPortalId(token: string): Promise<string | null> {
    try {
      const info = await hubspotFetch<{ portalId?: number }>(token, '/account-info/v3/details');
      return info.portalId != null ? String(info.portalId) : null;
    } catch {
      return null;
    }
  },

  /**
   * Construit la carte stageId → statut GrowCom à partir des pipelines de deals.
   * Un stage fermé (isClosed) avec une probabilité de 1 = WON, sinon LOST. Les autres = OPEN.
   */
  async fetchStageMap(token: string): Promise<Map<string, PrismaDealStatus>> {
    const map = new Map<string, PrismaDealStatus>();
    const data = await hubspotFetch<HubspotPagedResponse<{
      stages?: Array<{ id: string; label?: string; metadata?: { isClosed?: string; probability?: string } }>;
    }>>(token, '/crm/v3/pipelines/deals');

    for (const pipeline of data.results ?? []) {
      for (const stage of pipeline.stages ?? []) {
        const isClosed = String(stage.metadata?.isClosed ?? '').toLowerCase() === 'true';
        const probability = Number(stage.metadata?.probability ?? 0);
        const label = (stage.label ?? '').toLowerCase();

        let status: PrismaDealStatus;
        if (isClosed) {
          // Fermé gagné si proba = 1 ou libellé "won/gagné", sinon fermé perdu.
          if (probability >= 1 || label.includes('won') || label.includes('gagn')) {
            status = PrismaDealStatus.WON;
          } else {
            status = PrismaDealStatus.LOST;
          }
        } else {
          status = PrismaDealStatus.OPEN;
        }
        map.set(stage.id, status);
      }
    }
    return map;
  },

  /**
   * Récupère tous les deals HubSpot (pagination via paging.next.after).
   */
  async fetchDeals(token: string): Promise<NormalizedHubspotDeal[]> {
    const deals: NormalizedHubspotDeal[] = [];
    const propsParam = DEAL_PROPERTIES.join(',');
    let after: string | undefined;
    let pages = 0;

    do {
      const afterParam = after ? `&after=${encodeURIComponent(after)}` : '';
      const path = `/crm/v3/objects/deals?limit=${HUBSPOT_PAGE_SIZE}&properties=${propsParam}&associations=companies${afterParam}`;
      const data = await hubspotFetch<HubspotPagedResponse<HubspotDeal>>(token, path);

      for (const d of data.results ?? []) {
        const p = d.properties ?? {};
        const companyId = d.associations?.companies?.results?.[0]?.id ?? null;
        const rawMargin = p['growcom_margin'];
        const margin = rawMargin != null && rawMargin !== '' ? Number(rawMargin) : null;

        const rawDealType = p['growcom_dealtype'] || p['dealtype'];

        deals.push({
          id: d.id,
          name: p['dealname'] ?? '(Sans nom)',
          amount: Number(p['amount'] ?? 0),
          stageId: p['dealstage'] ?? '',
          closeDate: p['closedate'] && p['closedate'] !== '' ? p['closedate'] : null,
          ownerId: p['hubspot_owner_id'] && p['hubspot_owner_id'] !== '' ? p['hubspot_owner_id'] : null,
          companyId,
          margin: margin != null && !Number.isNaN(margin) ? margin : null,
          dealType: rawDealType && rawDealType.trim() !== '' ? rawDealType.trim() : null,
        });
      }

      after = data.paging?.next?.after;
      pages++;
    } while (after && pages < HUBSPOT_MAX_PAGES);

    return deals;
  },

  /**
   * Récupère les propriétaires HubSpot → Map ownerId → email (en minuscules).
   * Permet de matcher les commerciaux GrowCom par email, comme fetchUserEmails côté Odoo.
   */
  async fetchOwners(token: string): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    let after: string | undefined;
    let pages = 0;

    do {
      const afterParam = after ? `&after=${encodeURIComponent(after)}` : '';
      const data = await hubspotFetch<HubspotPagedResponse<{ id: string; email?: string }>>(
        token,
        `/crm/v3/owners?limit=${HUBSPOT_PAGE_SIZE}${afterParam}`,
      );
      for (const owner of data.results ?? []) {
        if (owner.id && owner.email) map.set(owner.id, owner.email.toLowerCase().trim());
      }
      after = data.paging?.next?.after;
      pages++;
    } while (after && pages < HUBSPOT_MAX_PAGES);

    return map;
  },

  /**
   * Récupère les noms des sociétés à partir de leurs IDs (batch read, 100 max par appel).
   * Retourne une Map companyId → nom.
   */
  async fetchCompanyNames(token: string, companyIds: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    const uniqueIds = [...new Set(companyIds)];
    if (uniqueIds.length === 0) return map;

    for (let i = 0; i < uniqueIds.length; i += 100) {
      const batch = uniqueIds.slice(i, i + 100);
      const data = await hubspotFetch<{ results?: Array<{ id: string; properties?: { name?: string } }> }>(
        token,
        '/crm/v3/objects/companies/batch/read',
        {
          method: 'POST',
          body: JSON.stringify({
            properties: ['name'],
            inputs: batch.map((id) => ({ id })),
          }),
        },
      );
      for (const c of data.results ?? []) {
        if (c.id && c.properties?.name) map.set(c.id, c.properties.name);
      }
    }
    return map;
  },

  /**
   * Récupère tous les line items avec leurs propriétés de facturation récurrente,
   * associés à leur deal. Propriétés récurrentes optionnelles : si le portail ne les
   * expose pas, HubSpot renvoie null et aucune mission n'est créée (détection propre).
   */
  async fetchLineItems(token: string): Promise<HubspotLineItem[]> {
    const props = [
      'name', 'quantity', 'price', 'amount', 'hs_mrr',
      'recurringbillingfrequency', 'hs_recurring_billing_period',
      'hs_recurring_billing_start_date', 'hs_cost_of_goods_sold',
    ].join(',');

    const items: HubspotLineItem[] = [];
    let after: string | undefined;
    let pages = 0;

    const numOrNull = (v: string | null | undefined): number | null => {
      if (v == null || v === '') return null;
      const n = Number(v);
      return Number.isNaN(n) ? null : n;
    };

    do {
      const afterParam = after ? `&after=${encodeURIComponent(after)}` : '';
      const path = `/crm/v3/objects/line_items?limit=${HUBSPOT_PAGE_SIZE}&properties=${props}&associations=deals${afterParam}`;
      const data = await hubspotFetch<HubspotPagedResponse<HubspotLineItemRaw>>(token, path);

      for (const li of data.results ?? []) {
        const p = li.properties ?? {};
        const dealId = li.associations?.deals?.results?.[0]?.id ?? null;
        items.push({
          id: li.id,
          dealId,
          recurringBillingFrequency: p['recurringbillingfrequency'] || null,
          recurringBillingPeriod: p['hs_recurring_billing_period'] || null,
          quantity: numOrNull(p['quantity']) ?? 0,
          hsMrr: numOrNull(p['hs_mrr']),
          price: numOrNull(p['price']),
          amount: numOrNull(p['amount']),
          costOfGoodsSold: numOrNull(p['hs_cost_of_goods_sold']),
          billingStartDate: p['hs_recurring_billing_start_date'] || null,
        });
      }

      after = data.paging?.next?.after;
      pages++;
    } while (after && pages < HUBSPOT_MAX_PAGES);

    return items;
  },

  /**
   * Phase ADDITIONNELLE : synchronise les missions récurrentes ESN depuis les line items.
   * N'impacte jamais le sync deal one-shot (appelée en try/catch dans sync()).
   * Une mission est ancrée sur le Deal déjà synchronisé et gagné (WON) auquel le line item
   * récurrent est associé ; sinon skip + log propre (aucune mission fabriquée).
   */
  async syncMissions(tenantId: string, token: string): Promise<{ missionsSynced: number; missionsSkipped: number }> {
    const lineItems = await hubspotService.fetchLineItems(token);

    // Regrouper les line items par deal HubSpot
    const byDeal = new Map<string, HubspotLineItem[]>();
    for (const li of lineItems) {
      if (!li.dealId) continue;
      const arr = byDeal.get(li.dealId) ?? [];
      arr.push(li);
      byDeal.set(li.dealId, arr);
    }

    let missionsSynced = 0;
    let missionsSkipped = 0;

    for (const [hubspotDealId, items] of byDeal) {
      const deal = await dealRepository.findByHubspotId(hubspotDealId, tenantId);
      if (!deal) {
        missionsSkipped++;
        logger.info('[HubSpot] Mission ignorée : deal non synchronisé', { tenantId, hubspotDealId });
        continue;
      }

      // UNE MISSION PAR CONSULTANT PLACÉ : chaque line item récurrent (et chaque
      // unité de quantité) devient sa propre mission → une ligne par consultant
      // dans le dashboard, même client / même contrat ou pas.
      const missions = items.flatMap((li) =>
        mapHubspotLineItemToConsultantMissions(li, {
          closeDate: deal.closedAt ? deal.closedAt.toISOString() : null,
        }),
      );
      if (missions.length === 0) continue; // aucun line item récurrent sur ce deal

      // Une mission active suppose un deal gagné (revenu récurrent effectif)
      if (deal.status !== PrismaDealStatus.WON) {
        missionsSkipped++;
        continue;
      }

      for (const { missionKey, ...mapping } of missions) {
        await missionRepository.upsertHubspot({
          tenantId,
          hubspotId: missionKey,
          dealId: deal.id,
          userId: deal.assignedToId,
          source: 'HUBSPOT',
          ...mapping,
        });
        missionsSynced++;
      }

      // Nettoyage des missions obsolètes de ce deal (ancien format agrégé keyé sur
      // le deal, ou line item disparu du CRM) : purge du PENDING puis suppression,
      // avec repli en ENDED si un historique payé y est encore rattaché.
      const currentKeys = missions.map((m) => m.missionKey);
      const staleMissions = await prisma.mission.findMany({
        where: { tenantId, dealId: deal.id, source: 'HUBSPOT', hubspotId: { notIn: currentKeys } },
        select: { id: true },
      });
      for (const stale of staleMissions) {
        await prisma.commission.deleteMany({
          where: { missionId: stale.id, tenantId, status: PrismaCommissionStatus.PENDING },
        });
        try {
          await prisma.commissionableEvent.deleteMany({ where: { missionId: stale.id, tenantId } });
          await prisma.mission.delete({ where: { id: stale.id } });
        } catch {
          // Historique validé/payé encore rattaché → on termine la mission au lieu de la supprimer
          await prisma.mission.update({ where: { id: stale.id }, data: { status: 'ENDED' } });
        }
      }
    }

    if (missionsSynced === 0 && missionsSkipped === 0) {
      logger.info('[HubSpot] Aucun line item récurrent détecté — aucune mission', { tenantId });
    }

    return { missionsSynced, missionsSkipped };
  },

  async sync(tenantId: string, userId: string, token: string) {
    logger.info('Démarrage synchronisation HubSpot', { tenantId });

    const errors: string[] = [];
    let synced = 0;
    let created = 0;
    let updated = 0;

    try {
      // 1. Récupération en parallèle : deals, owners, mapping des stages
      const [deals, ownerEmailMap, stageMap] = await Promise.all([
        hubspotService.fetchDeals(token),
        hubspotService.fetchOwners(token),
        hubspotService.fetchStageMap(token),
      ]);

      // 2. Noms des sociétés (association companies)
      const companyIds = deals.map((d) => d.companyId).filter((id): id is string => !!id);
      const companyNameMap = await hubspotService.fetchCompanyNames(token, companyIds);

      // 3. Index GrowCom : email → utilisateur (matching par email du propriétaire HubSpot)
      const tenantUsers = await userRepository.findByTenantId(tenantId);
      const growcomByEmail = new Map(tenantUsers.map((u) => [u.email.toLowerCase().trim(), u]));

      for (const deal of deals) {
        try {
          // Matching commercial par email du propriétaire HubSpot
          let assignedToId: string | null = null;
          if (deal.ownerId) {
            const ownerEmail = ownerEmailMap.get(deal.ownerId);
            if (ownerEmail) {
              const matched = growcomByEmail.get(ownerEmail);
              if (matched) assignedToId = matched.id;
            }
          }

          const status = mapHubspotStageToStatus(deal.stageId, stageMap);
          const existingDeal = await dealRepository.findByHubspotId(deal.id, tenantId);

          const closedAt = deal.closeDate ? new Date(deal.closeDate) : null;
          const clientName = deal.companyId ? (companyNameMap.get(deal.companyId) ?? null) : null;

          // Marge : pas native chez HubSpot. Utilise la propriété custom growcom_margin si présente,
          // sinon laisse la marge nulle (commission calculée sur le montant / les honoraires).
          let costAmount: number | null = null;
          let marginAmount: number | null = null;
          let marginSource: string | null = null;
          if (deal.margin != null && deal.margin > 0) {
            marginAmount = deal.margin;
            marginSource = 'HUBSPOT';
            costAmount = deal.amount - deal.margin;
          }

          const probability = status === PrismaDealStatus.WON ? 100 : status === PrismaDealStatus.LOST ? 0 : 50;

          const upsertedDeal = await dealRepository.upsertHubspot({
            tenantId,
            hubspotId: deal.id,
            title: deal.name,
            clientName,
            amount: deal.amount,
            status,
            probability,
            assignedToId,
            closedAt,
            costAmount,
            marginAmount,
            marginSource,
            ...(deal.dealType !== null ? { dealType: deal.dealType } : {}),
          });

          // DealAssignment : créer une assignation 100% si aucune n'existe encore
          if (assignedToId) {
            try {
              const existingAssignments = await dealAssignmentRepository.findByDealId(upsertedDeal.id, tenantId);
              if (existingAssignments.length === 0) {
                await dealAssignmentRepository.upsertForDeal(upsertedDeal.id, tenantId, [
                  { userId: assignedToId, share: 1.0 },
                ]);
              }
            } catch (assignErr) {
              logger.warn('Impossible de créer DealAssignment HubSpot', {
                dealId: upsertedDeal.id,
                error: assignErr instanceof Error ? assignErr.message : String(assignErr),
              });
            }
          }

          // Commission : créée/mise à jour si WON et assigné, supprimée (PENDING) sinon
          if (status === PrismaDealStatus.WON && assignedToId) {
            try {
              await commissionService.recalculateForDeal(upsertedDeal.id, tenantId);
            } catch (commErr) {
              logger.warn('Impossible de calculer la commission pour le deal HubSpot', {
                dealId: upsertedDeal.id,
                error: commErr instanceof Error ? commErr.message : String(commErr),
              });
            }
          } else if (status !== PrismaDealStatus.WON) {
            await prisma.commission.deleteMany({
              where: { dealId: upsertedDeal.id, tenantId, status: PrismaCommissionStatus.PENDING },
            });
          }

          existingDeal ? updated++ : created++;
          synced++;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Erreur inconnue';
          errors.push(`Deal ${deal.id}: ${message}`);
          logger.warn('Erreur sync deal HubSpot', { dealId: deal.id, error: message });
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      throw new AppError(502, 'HUBSPOT_SYNC_FAILED', `Échec de la synchronisation : ${message}`);
    }

    // Phase ADDITIONNELLE : missions récurrentes ESN. Isolée en try/catch pour ne jamais
    // faire échouer le sync deal one-shot.
    let missionsSynced = 0;
    let missionsSkipped = 0;
    try {
      const missionResult = await hubspotService.syncMissions(tenantId, token);
      missionsSynced = missionResult.missionsSynced;
      missionsSkipped = missionResult.missionsSkipped;
    } catch (missionErr) {
      logger.warn('[HubSpot] Sync des missions récurrentes échouée (sync deals non impactée)', {
        tenantId,
        error: missionErr instanceof Error ? missionErr.message : String(missionErr),
      });
    }

    const result = {
      synced,
      created,
      updated,
      errors,
      missionsSynced,
      missionsSkipped,
      syncedAt: new Date().toISOString(),
    };

    await auditLogRepository.create({
      tenantId,
      userId,
      action: 'HUBSPOT_SYNC',
      entity: 'Deal',
      entityId: tenantId,
      metadata: result as unknown as Record<string, unknown>,
    });

    logger.info('Synchronisation HubSpot terminée', result);
    return result;
  },
};
