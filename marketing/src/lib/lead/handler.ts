/**
 * Traitement d'une demande de document : écrit sans dépendance à Cloudflare pour être testé
 * (l'environnement et fetch sont injectés par l'endpoint src/pages/api/lead.ts).
 *
 * Ordre : méthode → même origine → format → limitation d'envois → validation → anti-robot
 *         → contact Brevo (liste) → email du document → alerte de rappel.
 */
import { SITE, ROUTES, TEMPLATE_FILES } from '../site';
import { decodeState, encodeState, DEFAULT_STATE } from '../../simulator/state';
import { upsertContact, sendTransactionalEmail, BrevoError, type BrevoAttributes } from './brevo';
import { buildCallbackNotification, buildDeliveryEmail } from './emails';
import { checkRateLimit, verifyTurnstile, type RateLimiterBinding } from './protection';
import { validateLead, type Lead, type LeadRequestBody } from './validation';

export interface LeadEnv {
  /** Clé API Brevo (secret). */
  BREVO_API_KEY?: string;
  /** Identifiant numérique de la liste Brevo des contacts du site. */
  BREVO_LIST_ID?: string;
  /** Expéditeur des emails (adresse validée dans Brevo). */
  BREVO_SENDER_EMAIL?: string;
  BREVO_SENDER_NAME?: string;
  /** Adresse qui reçoit les alertes « demande de rappel » (facultatif). */
  LEAD_NOTIFY_EMAIL?: string;
  /** Clé secrète Turnstile (secret) ; si absente, pas de vérification anti-robot. */
  TURNSTILE_SECRET_KEY?: string;
  /** Nom de l'attribut « prénom » dans Brevo : PRENOM (compte en français, défaut) ou FIRSTNAME. */
  BREVO_FIRSTNAME_ATTRIBUTE?: string;
  /** « 1 » : sans clé Brevo, la demande est acceptée sans rien envoyer (développement local). */
  LEAD_TEST_MODE?: string;
  LEAD_RATE_LIMITER?: RateLimiterBinding;
}

export interface LeadDeps {
  env: LeadEnv;
  fetch: typeof fetch;
  now?: () => number;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

export const MAX_BODY_BYTES = 8 * 1024;

type ErrorCode =
  | 'METHOD_NOT_ALLOWED'
  | 'FORBIDDEN_ORIGIN'
  | 'UNSUPPORTED_MEDIA_TYPE'
  | 'PAYLOAD_TOO_LARGE'
  | 'BAD_JSON'
  | 'RATE_LIMITED'
  | 'INVALID_FIELDS'
  | 'CAPTCHA_FAILED'
  | 'NOT_CONFIGURED'
  | 'UPSTREAM_ERROR';

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
  });

const fail = (status: number, error: ErrorCode, message: string, extra: Record<string, unknown> = {}) =>
  json(status, { ok: false, error, message, ...extra });

/** Lien vers la simulation, reconstruit à partir de paramètres nettoyés (jamais recopiés tels quels). */
export function simulationLink(query: string | null): string | null {
  if (!query) return null;
  const state = decodeState(query.startsWith('?') ? query : `?${query}`);
  const link = `${SITE.url}${ROUTES.simulator}`;
  return JSON.stringify(state) === JSON.stringify(DEFAULT_STATE) ? link : `${link}?${encodeState(state)}`;
}

/** Attributs Brevo : seuls les champs renseignés sont envoyés (on n'efface jamais une valeur existante). */
export function brevoAttributes(lead: Lead, link: string | null, today: string, firstNameAttribute = 'PRENOM'): BrevoAttributes {
  const attributes: BrevoAttributes = { SOURCE: lead.source, DATE_DEMANDE: today };
  const optional: Record<string, string | null | undefined> = {
    [firstNameAttribute]: lead.firstName,
    AGENCE: lead.agency,
    VILLE: lead.city,
    TELEPHONE: lead.phone,
    LIEN_SIMULATION: link,
    UTM_SOURCE: lead.attribution.utm_source,
    UTM_MEDIUM: lead.attribution.utm_medium,
    UTM_CAMPAIGN: lead.attribution.utm_campaign,
    UTM_CONTENT: lead.attribution.utm_content,
    UTM_TERM: lead.attribution.utm_term,
    CAMPAGNE_ID: lead.attribution.cid,
  };
  for (const [key, value] of Object.entries(optional)) if (value) attributes[key] = value;
  if (lead.phone) attributes.RAPPEL_DEMANDE = true;
  return attributes;
}

export async function handleLeadRequest(request: Request, deps: LeadDeps): Promise<Response> {
  const { env } = deps;
  const now = deps.now ?? Date.now;
  const log = deps.log ?? ((level, message) => console[level](`[lead] ${message}`));

  if (request.method !== 'POST') {
    return fail(405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
  }

  // Même origine uniquement : un autre site ne peut pas soumettre ce formulaire
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) {
    return fail(403, 'FORBIDDEN_ORIGIN', 'Origine non autorisée.');
  }

  if (!(request.headers.get('content-type') ?? '').includes('application/json')) {
    return fail(415, 'UNSUPPORTED_MEDIA_TYPE', 'Format de requête non pris en charge.');
  }

  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    return fail(413, 'PAYLOAD_TOO_LARGE', 'Requête trop volumineuse.');
  }

  let body: LeadRequestBody;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
    body = parsed as LeadRequestBody;
  } catch {
    return fail(400, 'BAD_JSON', 'Requête illisible.');
  }

  const ip = request.headers.get('cf-connecting-ip');
  if (!(await checkRateLimit(`lead:${ip ?? 'unknown'}`, env.LEAD_RATE_LIMITER))) {
    return fail(429, 'RATE_LIMITED', 'Trop de demandes en peu de temps. Réessayez dans quelques minutes.');
  }

  const validation = validateLead(body, now());
  if (!validation.ok) {
    return fail(400, 'INVALID_FIELDS', 'Certains champs sont invalides.', { fields: validation.errors });
  }
  const { lead, suspicious } = validation;

  // Robot probable (champ piège rempli, envoi instantané) : réponse normale, rien n'est enregistré
  if (suspicious) {
    log('warn', 'demande ignorée (piège anti-robot)');
    return json(200, { ok: true });
  }

  if (env.TURNSTILE_SECRET_KEY) {
    const token = typeof body.turnstileToken === 'string' ? body.turnstileToken : '';
    if (!token || !(await verifyTurnstile(deps.fetch, env.TURNSTILE_SECRET_KEY, token, ip))) {
      return fail(400, 'CAPTCHA_FAILED', 'La vérification anti-robot a échoué. Rechargez la page et réessayez.');
    }
  }

  const link = simulationLink(lead.simulation);

  if (!env.BREVO_API_KEY) {
    if (env.LEAD_TEST_MODE === '1') {
      log('info', `mode test : demande acceptée sans envoi à Brevo (source ${lead.source}, rappel ${lead.phone ? 'oui' : 'non'})`);
      return json(200, { ok: true, emailSent: false, test: true });
    }
    log('error', 'BREVO_API_KEY manquante : la demande ne peut pas être enregistrée');
    return fail(500, 'NOT_CONFIGURED', 'Le service est momentanément indisponible. Réessayez plus tard.');
  }

  const listId = Number(env.BREVO_LIST_ID);
  const listIds = Number.isInteger(listId) && listId > 0 ? [listId] : [];
  if (listIds.length === 0) log('warn', 'BREVO_LIST_ID absent ou invalide : contact créé hors liste');

  try {
    const today = new Date(now()).toISOString().slice(0, 10);
    const result = await upsertContact(deps.fetch, env.BREVO_API_KEY, {
      email: lead.email,
      attributes: brevoAttributes(lead, link, today, env.BREVO_FIRSTNAME_ATTRIBUTE || 'PRENOM'),
      listIds,
    });
    if (result.degraded) log('warn', `attributs refusés par Brevo, contact enregistré sans eux (${result.detail})`);
  } catch (error) {
    log('error', `enregistrement du contact impossible : ${error instanceof BrevoError ? error.message : String(error)}`);
    return fail(502, 'UPSTREAM_ERROR', 'Nous n’avons pas pu enregistrer votre demande. Réessayez dans un instant.');
  }

  const sender = env.BREVO_SENDER_EMAIL
    ? { email: env.BREVO_SENDER_EMAIL, name: env.BREVO_SENDER_NAME || 'GrowCom' }
    : null;
  let emailSent = false;

  if (sender) {
    const links = {
      simulation: link,
      templateXlsx: `${SITE.url}${TEMPLATE_FILES.xlsx}`,
      templatePdf: `${SITE.url}${TEMPLATE_FILES.pdf}`,
      simulator: `${SITE.url}${ROUTES.simulator}`,
    };
    const delivery = buildDeliveryEmail(lead, links, SITE.url, SITE.contactEmail);
    try {
      await sendTransactionalEmail(deps.fetch, env.BREVO_API_KEY, {
        sender,
        to: [{ email: lead.email, ...(lead.firstName ? { name: lead.firstName } : {}) }],
        replyTo: { email: SITE.contactEmail, name: 'GrowCom' },
        subject: delivery.subject,
        htmlContent: delivery.html,
        textContent: delivery.text,
        tags: ['lead-magnet', lead.source],
      });
      emailSent = true;
    } catch (error) {
      // Le contact est enregistré et les documents sont téléchargeables tout de suite : pas bloquant
      log('error', `email du document non envoyé : ${String(error)}`);
    }

    if (lead.phone && env.LEAD_NOTIFY_EMAIL) {
      const alert = buildCallbackNotification(lead, link);
      try {
        await sendTransactionalEmail(deps.fetch, env.BREVO_API_KEY, {
          sender,
          to: [{ email: env.LEAD_NOTIFY_EMAIL }],
          replyTo: { email: lead.email },
          subject: alert.subject,
          htmlContent: alert.html,
          textContent: alert.text,
          tags: ['rappel'],
        });
      } catch (error) {
        log('error', `alerte de rappel non envoyée : ${String(error)}`);
      }
    }
  } else {
    log('warn', 'BREVO_SENDER_EMAIL absent : aucun email envoyé');
  }

  return json(200, { ok: true, emailSent });
}
