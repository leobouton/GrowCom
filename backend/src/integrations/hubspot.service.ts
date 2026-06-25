import { logger } from '../config/logger';
import { dealRepository } from '../repositories/deal.repository';
import { dealAssignmentRepository } from '../repositories/dealAssignment.repository';
import { userRepository } from '../repositories/user.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { commissionService } from '../services/commission.service';
import { AppError } from '../middlewares/errorHandler';
import { DealStatus as PrismaDealStatus, CommissionStatus as PrismaCommissionStatus } from '@prisma/client';
import { prisma } from '../config/prisma';

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

        deals.push({
          id: d.id,
          name: p['dealname'] ?? '(Sans nom)',
          amount: Number(p['amount'] ?? 0),
          stageId: p['dealstage'] ?? '',
          closeDate: p['closedate'] && p['closedate'] !== '' ? p['closedate'] : null,
          ownerId: p['hubspot_owner_id'] && p['hubspot_owner_id'] !== '' ? p['hubspot_owner_id'] : null,
          companyId,
          margin: margin != null && !Number.isNaN(margin) ? margin : null,
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

    const result = {
      synced,
      created,
      updated,
      errors,
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
