import { logger } from '../config/logger';
import { dealRepository } from '../repositories/deal.repository';
import { userRepository } from '../repositories/user.repository';
import { tenantRepository } from '../repositories/tenant.repository';
import { auditLogRepository } from '../repositories/auditLog.repository';
import { commissionService } from '../services/commission.service';
import { emailService } from './email.service';
import { AppError } from '../middlewares/errorHandler';
import { DealStatus as PrismaDealStatus, CommissionStatus as PrismaCommissionStatus, UserRole } from '@prisma/client';
import { prisma } from '../config/prisma';

const ODOO_DEAL_LIMIT = 1000;
const ODOO_DEAL_WARN_THRESHOLD = 950;

interface OdooCrmLead {
  id: number;
  name: string;
  partner_id: [number, string] | false;  // [id, "Nom du client"]
  expected_revenue: number;
  probability: number;
  stage_id: [number, string] | false;
  user_id: [number, string] | false;
  date_closed: string | false;
  write_date: string | false;  // Date de dernière modif (≈ date de passage WON si date_closed absent)
  active: boolean;
}

// ─── XML-RPC builder ─────────────────────────────────────────────────────────

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function toXmlValue(val: unknown): string {
  if (val === null || val === undefined) return '<nil/>';
  if (typeof val === 'boolean') return `<boolean>${val ? '1' : '0'}</boolean>`;
  if (typeof val === 'number' && Number.isInteger(val)) return `<int>${val}</int>`;
  if (typeof val === 'number') return `<double>${val}</double>`;
  if (typeof val === 'string') return `<string>${escapeXml(val)}</string>`;
  if (Array.isArray(val)) {
    const items = val.map((v) => `<value>${toXmlValue(v)}</value>`).join('');
    return `<array><data>${items}</data></array>`;
  }
  if (typeof val === 'object') {
    const members = Object.entries(val as Record<string, unknown>)
      .map(([k, v]) => `<member><name>${escapeXml(k)}</name><value>${toXmlValue(v)}</value></member>`)
      .join('');
    return `<struct>${members}</struct>`;
  }
  return `<string>${escapeXml(String(val))}</string>`;
}

function buildXmlRpcRequest(method: string, params: unknown[]): string {
  const paramsXml = params.map((p) => `<param><value>${toXmlValue(p)}</value></param>`).join('');
  return `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${paramsXml}</params></methodCall>`;
}

// ─── XML-RPC parser (recursive descent) ─────────────────────────────────────

class XmlRpcParser {
  private pos = 0;

  constructor(private readonly xml: string) {}

  parse(): unknown {
    this.skipXmlDecl();
    this.ws();
    this.eat('<methodResponse>');
    this.ws();

    if (this.starts('<fault>')) {
      this.eat('<fault>');
      this.ws();
      this.eat('<value>');
      const fault = this.parseValue() as Record<string, unknown>;
      this.ws();
      this.eat('</value>');
      const msg = String(fault['faultString'] ?? 'Odoo XML-RPC fault');
      throw new AppError(502, 'ODOO_FAULT', msg);
    }

    this.eat('<params>');
    this.ws();
    this.eat('<param>');
    this.ws();
    this.eat('<value>');
    const result = this.parseValue();
    return result;
  }

  private parseValue(): unknown {
    this.ws();

    if (this.starts('<int>') || this.starts('<i4>')) {
      const tag = this.starts('<int>') ? 'int' : 'i4';
      this.eat(`<${tag}>`);
      const text = this.until(`</${tag}>`);
      this.eat(`</${tag}>`);
      return parseInt(text, 10);
    }
    if (this.starts('<i8>')) {
      this.eat('<i8>');
      const text = this.until('</i8>');
      this.eat('</i8>');
      return parseInt(text, 10);
    }
    if (this.starts('<double>')) {
      this.eat('<double>');
      const text = this.until('</double>');
      this.eat('</double>');
      return parseFloat(text);
    }
    if (this.starts('<boolean>')) {
      this.eat('<boolean>');
      const text = this.until('</boolean>');
      this.eat('</boolean>');
      return text.trim() === '1';
    }
    if (this.starts('<string/>')) {
      this.eat('<string/>');
      return '';
    }
    if (this.starts('<string>')) {
      this.eat('<string>');
      const text = this.until('</string>');
      this.eat('</string>');
      return text;
    }
    if (this.starts('<nil/>') || this.starts('<nil>')) {
      this.eat(this.starts('<nil/>') ? '<nil/>' : '<nil>');
      return null;
    }
    if (this.starts('<array>')) {
      return this.parseArray();
    }
    if (this.starts('<struct>')) {
      return this.parseStruct();
    }

    // Raw untagged string (edge case in XML-RPC)
    const raw = this.until('<').trim();
    return raw;
  }

  private parseArray(): unknown[] {
    this.eat('<array>');
    this.ws();
    this.eat('<data>');
    const items: unknown[] = [];
    this.ws();
    while (this.starts('<value>')) {
      this.eat('<value>');
      items.push(this.parseValue());
      this.ws();
      this.eat('</value>');
      this.ws();
    }
    this.eat('</data>');
    this.ws();
    this.eat('</array>');
    return items;
  }

  private parseStruct(): Record<string, unknown> {
    this.eat('<struct>');
    const obj: Record<string, unknown> = {};
    this.ws();
    while (this.starts('<member>')) {
      this.eat('<member>');
      this.ws();
      this.eat('<name>');
      const name = this.until('</name>');
      this.eat('</name>');
      this.ws();
      this.eat('<value>');
      obj[name] = this.parseValue();
      this.ws();
      this.eat('</value>');
      this.ws();
      this.eat('</member>');
      this.ws();
    }
    this.eat('</struct>');
    return obj;
  }

  private skipXmlDecl() {
    this.ws();
    if (this.xml.startsWith('<?', this.pos)) {
      const end = this.xml.indexOf('?>', this.pos);
      if (end !== -1) this.pos = end + 2;
    }
  }

  private ws() {
    while (this.pos < this.xml.length && /\s/.test(this.xml[this.pos])) this.pos++;
  }

  private starts(s: string): boolean {
    return this.xml.startsWith(s, this.pos);
  }

  private eat(s: string) {
    if (!this.xml.startsWith(s, this.pos)) {
      const ctx = this.xml.slice(this.pos, this.pos + 80).replace(/\s+/g, ' ');
      throw new AppError(502, 'ODOO_PARSE', `Réponse Odoo inattendue (attendu: "${s}", reçu: "${ctx}")`);
    }
    this.pos += s.length;
  }

  private until(marker: string): string {
    const end = this.xml.indexOf(marker, this.pos);
    if (end === -1) {
      throw new AppError(502, 'ODOO_PARSE', `Marqueur XML-RPC introuvable: "${marker}"`);
    }
    const text = this.xml.slice(this.pos, end);
    this.pos = end;
    return text;
  }
}

async function xmlRpcCall(endpoint: string, method: string, params: unknown[]): Promise<unknown> {
  const body = buildXmlRpcRequest(method, params);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000); // 30 secondes max
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml', Accept: 'text/xml' },
      body,
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError(504, 'ODOO_TIMEOUT', 'Odoo ne répond pas (timeout 30s)');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new AppError(502, 'ODOO_HTTP', `Impossible de contacter Odoo (HTTP ${response.status})`);
  }

  const text = await response.text();
  return new XmlRpcParser(text).parse();
}

// ─── Mapping stage → statut GrowCom ──────────────────────────────────────────

function mapOdooStageToStatus(probability: number, stageName: string): PrismaDealStatus {
  const s = stageName.toLowerCase();
  if (s.includes('gagn') || s.includes('won') || probability === 100) return PrismaDealStatus.WON;
  // probability === 0 retiré volontairement : certains stages actifs démarrent à 0% (ex: "Nouveau contact")
  if (s.includes('perdu') || s.includes('lost')) return PrismaDealStatus.LOST;
  return PrismaDealStatus.OPEN;
}

// ─── Service public ───────────────────────────────────────────────────────────

export const odooService = {
  /**
   * Authentification via XML-RPC /xmlrpc/2/common.
   * Les clés API Odoo fonctionnent uniquement avec cet endpoint (pas avec /web/session).
   * Retourne l'uid de l'utilisateur.
   */
  async authenticate(
    odooUrl: string,
    odooDatabase: string,
    odooLogin: string,
    odooApiKey: string,
  ): Promise<number> {
    const uid = await xmlRpcCall(
      `${odooUrl}/xmlrpc/2/common`,
      'authenticate',
      [odooDatabase, odooLogin, odooApiKey, {}],
    );

    if (!uid || uid === false || uid === 0) {
      throw new AppError(401, 'ODOO_AUTH_FAILED', 'Email ou clé API invalides — vérifiez vos identifiants Odoo');
    }

    return uid as number;
  },

  /**
   * Récupère les opportunités CRM via XML-RPC /xmlrpc/2/object.
   * Inclut les deals archivés (active = false) pour détecter les deals perdus/supprimés dans Odoo.
   */
  async fetchLeads(
    odooUrl: string,
    odooDatabase: string,
    uid: number,
    odooApiKey: string,
  ): Promise<OdooCrmLead[]> {
    const result = await xmlRpcCall(
      `${odooUrl}/xmlrpc/2/object`,
      'execute_kw',
      [
        odooDatabase,
        uid,
        odooApiKey,
        'crm.lead',
        'search_read',
        // active IN (true, false) : récupère actifs ET archivés (deals perdus dans Odoo)
        [[['active', 'in', [true, false]]]],
        {
          fields: ['id', 'name', 'partner_id', 'expected_revenue', 'probability', 'stage_id', 'user_id', 'date_closed', 'write_date', 'active'],
          limit: ODOO_DEAL_LIMIT,
        },
      ],
    );

    const records = result as Record<string, unknown>[];
    return records.map((r) => ({
      id: r['id'] as number,
      name: (r['name'] as string) ?? '',
      partner_id: Array.isArray(r['partner_id']) ? (r['partner_id'] as [number, string]) : false,
      expected_revenue: Number(r['expected_revenue'] ?? 0),
      probability: Number(r['probability'] ?? 0),
      stage_id: Array.isArray(r['stage_id']) ? (r['stage_id'] as [number, string]) : false,
      user_id: Array.isArray(r['user_id']) ? (r['user_id'] as [number, string]) : false,
      date_closed: typeof r['date_closed'] === 'string' && r['date_closed'] ? r['date_closed'] : false,
      write_date: typeof r['write_date'] === 'string' && r['write_date'] ? r['write_date'] : false,
      active: Boolean(r['active']),
    }));
  },

  /**
   * Récupère les emails des utilisateurs Odoo à partir de leurs IDs.
   * Le champ "login" dans res.users est toujours l'adresse email dans Odoo.
   * Retourne un Map : odooUserId → email
   */
  async fetchUserEmails(
    odooUrl: string,
    odooDatabase: string,
    uid: number,
    odooApiKey: string,
    userIds: number[],
  ): Promise<Map<number, string>> {
    if (userIds.length === 0) return new Map();

    const result = await xmlRpcCall(
      `${odooUrl}/xmlrpc/2/object`,
      'execute_kw',
      [
        odooDatabase,
        uid,
        odooApiKey,
        'res.users',
        'read',
        [userIds],
        { fields: ['id', 'login'] },
      ],
    );

    const map = new Map<number, string>();
    const records = result as Record<string, unknown>[];
    for (const r of records) {
      const userId = r['id'] as number;
      const login = r['login'] as string;
      if (userId && login) map.set(userId, login.toLowerCase().trim());
    }
    return map;
  },

  async sync(
    tenantId: string,
    userId: string,
    odooUrl: string,
    odooDatabase: string,
    odooLogin: string,
    odooApiKey: string,
  ) {
    logger.info('Démarrage synchronisation Odoo', { tenantId });

    const errors: string[] = [];
    let synced = 0;
    let created = 0;
    let updated = 0;
    let deleted = 0;
    let dealsCount = 0;

    try {
      const uid = await odooService.authenticate(odooUrl, odooDatabase, odooLogin, odooApiKey);
      const leads = await odooService.fetchLeads(odooUrl, odooDatabase, uid, odooApiKey);
      dealsCount = leads.length;

      // Alerte approche de la limite : email envoyé aux managers, au maximum 1 fois tous les 2 jours
      if (leads.length >= ODOO_DEAL_WARN_THRESHOLD) {
        const restant = ODOO_DEAL_LIMIT - leads.length;
        logger.warn(`Seuil d'alerte Odoo atteint : ${leads.length}/${ODOO_DEAL_LIMIT} deals`, { tenantId });
        try {
          const tenant = await tenantRepository.findById(tenantId);
          const deuxJoursEnMs = 2 * 24 * 60 * 60 * 1000;
          const dernierEnvoi = tenant?.odooLimitWarningSentAt;
          const peutEnvoyer = !dernierEnvoi || (Date.now() - dernierEnvoi.getTime()) >= deuxJoursEnMs;

          if (peutEnvoyer) {
            const managers = await userRepository.findByTenantIdAndRoles(tenantId, [UserRole.MANAGER, UserRole.BU_MANAGER]);
            for (const manager of managers) {
              await emailService.sendOdooLimitWarning(manager.email, manager.firstName, leads.length, restant);
            }
            await tenantRepository.update(tenantId, { odooLimitWarningSentAt: new Date() });
            logger.info('Email d\'alerte limite Odoo envoyé', { tenantId, dealsCount: leads.length });
          } else {
            const prochainEnvoi = new Date((dernierEnvoi?.getTime() ?? 0) + deuxJoursEnMs);
            logger.info('Alerte limite Odoo déjà envoyée récemment — prochain envoi le ' + prochainEnvoi.toISOString(), { tenantId });
          }
        } catch (emailErr) {
          logger.warn('Impossible d\'envoyer l\'alerte limite Odoo par email', {
            tenantId,
            error: emailErr instanceof Error ? emailErr.message : String(emailErr),
          });
        }
      }

      // Blocage si la limite maximale est atteinte (des deals sont manquants)
      if (leads.length === ODOO_DEAL_LIMIT) {
        logger.error(`Limite de ${ODOO_DEAL_LIMIT} deals Odoo atteinte — des deals sont manquants`, { tenantId });
      }

      const tenantUsers = await userRepository.findByTenantId(tenantId);

      // Fix 3 — Matching par email : récupérer les emails Odoo de tous les commerciaux assignés
      const odooUserIds = [...new Set(
        leads.filter((l) => l.user_id).map((l) => (l.user_id as [number, string])[0]),
      )];
      const odooEmailMap = await odooService.fetchUserEmails(odooUrl, odooDatabase, uid, odooApiKey, odooUserIds);

      // Index GrowCom : email → utilisateur (pour matching rapide)
      const growcomByEmail = new Map(tenantUsers.map((u) => [u.email.toLowerCase().trim(), u]));

      for (const lead of leads) {
        try {
          // Fix 1 — Deal archivé dans Odoo (perdu/supprimé) → supprimer dans GrowCom
          if (!lead.active) {
            const existingDeal = await dealRepository.findByOdooId(String(lead.id), tenantId);
            if (existingDeal) {
              await dealRepository.deleteByOdooId(String(lead.id), tenantId);
              deleted++;
              logger.info('Deal archivé dans Odoo supprimé de GrowCom', { odooId: lead.id, tenantId });
            }
            continue;
          }

          // Fix 3 — Matching par email Odoo → GrowCom
          let assignedToId: string | null = null;
          if (lead.user_id) {
            const odooUid = (lead.user_id as [number, string])[0];
            const odooEmail = odooEmailMap.get(odooUid);
            if (odooEmail) {
              const matched = growcomByEmail.get(odooEmail);
              if (matched) assignedToId = matched.id;
            }
          }

          const stageName = Array.isArray(lead.stage_id) ? lead.stage_id[1] : '';
          const status = mapOdooStageToStatus(lead.probability, stageName);
          const existingDeal = await dealRepository.findByOdooId(String(lead.id), tenantId);

          // Pour closedAt : date_closed en priorité, sinon write_date pour les deals WON
          // (write_date = dernière modif Odoo, soit quand le deal a été marqué WON)
          let closedAt: Date | null = null;
          if (lead.date_closed) {
            closedAt = new Date(lead.date_closed);
          } else if (status === PrismaDealStatus.WON && lead.write_date) {
            closedAt = new Date(lead.write_date);
          }

          const clientName = lead.partner_id ? lead.partner_id[1] : null;

          const upsertedDeal = await dealRepository.upsert({
            tenantId,
            odooId: String(lead.id),
            title: lead.name,
            clientName,
            amount: lead.expected_revenue,
            status,
            probability: lead.probability,
            assignedToId,
            closedAt,
          });

          // Créer/mettre à jour la commission si le deal est WON et assigné
          if (status === PrismaDealStatus.WON && assignedToId) {
            try {
              await commissionService.recalculateForDeal(upsertedDeal.id, tenantId);
            } catch (commErr) {
              logger.warn('Impossible de calculer la commission pour le deal', {
                dealId: upsertedDeal.id,
                error: commErr instanceof Error ? commErr.message : String(commErr),
              });
            }
          } else if (status !== PrismaDealStatus.WON) {
            // Si le deal n'est plus WON (LOST ou retour OPEN), supprimer les commissions PENDING associées
            // pour éviter de verser une commission sur une vente annulée
            await prisma.commission.deleteMany({
              where: { dealId: upsertedDeal.id, tenantId, status: PrismaCommissionStatus.PENDING },
            });
          }

          existingDeal ? updated++ : created++;
          synced++;
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Erreur inconnue';
          errors.push(`Lead ${lead.id}: ${message}`);
          logger.warn('Erreur sync deal Odoo', { leadId: lead.id, error: message });
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      const message = err instanceof Error ? err.message : 'Erreur inconnue';
      throw new AppError(502, 'ODOO_SYNC_FAILED', `Échec de la synchronisation : ${message}`);
    }

    const result = {
      synced,
      created,
      updated,
      deleted,
      errors,
      syncedAt: new Date().toISOString(),
      limitWarning: dealsCount >= ODOO_DEAL_WARN_THRESHOLD,
      limitReached: dealsCount === ODOO_DEAL_LIMIT,
      dealsCount,
    };

    await auditLogRepository.create({
      tenantId,
      userId,
      action: 'ODOO_SYNC',
      entity: 'Deal',
      entityId: tenantId,
      metadata: result as unknown as Record<string, unknown>,
    });

    logger.info('Synchronisation Odoo terminée', result);
    return result;
  },
};
