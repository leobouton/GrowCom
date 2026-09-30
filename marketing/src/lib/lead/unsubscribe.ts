/**
 * Désinscription en un clic (POST /api/unsubscribe). Deux façons d'arriver ici :
 *  - la page growcom.fr/desinscription (bouton « Confirmer ») : JSON { token }, même origine ;
 *  - le bouton « Se désabonner » de Gmail, Outlook… (norme RFC 8058) : formulaire
 *    « List-Unsubscribe=One-Click » envoyé par la messagerie, jeton dans l'adresse (?t=).
 * Le jeton chiffré fait office d'autorisation : sans le secret du serveur, impossible d'en fabriquer un.
 */
import { SITE } from '../site';
import { blacklistContact, BrevoError } from './brevo';
import type { LeadEnv } from './handler';
import { checkRateLimit } from './protection';
import { createUnsubscribeToken, readUnsubscribeToken } from './unsubscribe-token';

export const UNSUBSCRIBE_PAGE = '/desinscription';
export const UNSUBSCRIBE_API = '/api/unsubscribe';

/** Secret de chiffrement des jetons : dédié s'il existe, sinon dérivé de la clé Brevo. */
export function unsubscribeSecret(env: LeadEnv): string | null {
  return env.UNSUBSCRIBE_SECRET || env.BREVO_API_KEY || null;
}

export interface UnsubscribeLinks {
  /** Lien pour l'email : le jeton est après « # », il n'est jamais envoyé ni journalisé par un serveur. */
  page: string;
  /** En-têtes pour le bouton « Se désabonner » des messageries (RFC 2369 / RFC 8058). */
  headers: Record<string, string>;
}

export async function buildUnsubscribeLinks(email: string, secret: string): Promise<UnsubscribeLinks> {
  const token = await createUnsubscribeToken(email, secret);
  return {
    page: `${SITE.url}${UNSUBSCRIBE_PAGE}#t=${token}`,
    headers: {
      'List-Unsubscribe': `<${SITE.url}${UNSUBSCRIBE_API}?t=${token}>, <mailto:${SITE.contactEmail}?subject=D%C3%A9sinscription>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

interface Deps {
  env: LeadEnv;
  fetch: typeof fetch;
  log?: (level: 'info' | 'warn' | 'error', message: string) => void;
}

const reply = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export async function handleUnsubscribeRequest(request: Request, deps: Deps): Promise<Response> {
  const { env } = deps;
  const log = deps.log ?? ((level, message) => console[level](`[desinscription] ${message}`));

  if (request.method !== 'POST') return reply(405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

  const contentType = request.headers.get('content-type') ?? '';
  const raw = await request.text();
  if (raw.length > 2048) return reply(413, { ok: false, error: 'PAYLOAD_TOO_LARGE' });

  let token: string | null = null;
  if (contentType.includes('application/json')) {
    // Depuis la page de désinscription du site : même origine obligatoire
    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) return reply(403, { ok: false, error: 'FORBIDDEN_ORIGIN' });
    try {
      const body = JSON.parse(raw) as { token?: unknown };
      token = typeof body.token === 'string' ? body.token : null;
    } catch {
      return reply(400, { ok: false, error: 'BAD_JSON' });
    }
  } else if (contentType.includes('application/x-www-form-urlencoded')) {
    // Depuis une messagerie (RFC 8058) : le corps doit être exactement « List-Unsubscribe=One-Click »
    if (new URLSearchParams(raw).get('List-Unsubscribe') !== 'One-Click') return reply(400, { ok: false, error: 'BAD_REQUEST' });
    token = new URL(request.url).searchParams.get('t');
  } else {
    return reply(415, { ok: false, error: 'UNSUPPORTED_MEDIA_TYPE' });
  }

  const ip = request.headers.get('cf-connecting-ip');
  if (!(await checkRateLimit(`unsub:${ip ?? 'unknown'}`, env.LEAD_RATE_LIMITER))) {
    return reply(429, { ok: false, error: 'RATE_LIMITED', message: 'Trop de demandes. Réessayez dans quelques minutes.' });
  }

  const invalidToken = {
    ok: false,
    error: 'INVALID_TOKEN',
    message: `Ce lien de désinscription n'est pas valide. Écrivez-nous à ${SITE.contactEmail}, nous vous désinscrirons.`,
  };
  const secret = unsubscribeSecret(env);
  const email = token && secret ? await readUnsubscribeToken(token, secret) : null;

  if (!env.BREVO_API_KEY) {
    if (env.LEAD_TEST_MODE === '1') {
      log('info', `mode test : désinscription ${email ? 'valide' : 'avec un lien invalide'}, rien envoyé à Brevo`);
      return email ? reply(200, { ok: true, test: true }) : reply(400, invalidToken);
    }
    log('error', 'BREVO_API_KEY manquante : désinscription impossible');
    return reply(500, { ok: false, error: 'NOT_CONFIGURED' });
  }

  if (!email) return reply(400, invalidToken);

  try {
    await blacklistContact(deps.fetch, env.BREVO_API_KEY, email);
  } catch (error) {
    log('error', `désinscription impossible : ${error instanceof BrevoError ? error.message : String(error)}`);
    return reply(502, { ok: false, error: 'UPSTREAM_ERROR', message: 'Le service est momentanément indisponible. Réessayez dans un instant.' });
  }
  log('info', 'contact désinscrit');
  return reply(200, { ok: true });
}
