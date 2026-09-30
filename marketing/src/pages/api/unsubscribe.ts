/**
 * POST /api/unsubscribe — désinscription en un clic (page du site ou bouton des messageries).
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import type { LeadEnv } from '../../lib/lead/handler';
import { handleUnsubscribeRequest } from '../../lib/lead/unsubscribe';

export const prerender = false;

export const POST: APIRoute = ({ request }) => handleUnsubscribeRequest(request, { env: env as unknown as LeadEnv, fetch });

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }), {
    status: 405,
    headers: { allow: 'POST', 'content-type': 'application/json' },
  });
