/**
 * POST /api/lead — demande de document (PDF du calcul + modèle de grille).
 * Seule route exécutée côté serveur (Cloudflare Worker) : tout le reste du site est statique.
 */
import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { handleLeadRequest, type LeadEnv } from '../../lib/lead/handler';

export const prerender = false;

export const POST: APIRoute = ({ request }) => handleLeadRequest(request, { env: env as unknown as LeadEnv, fetch });

export const ALL: APIRoute = () =>
  new Response(JSON.stringify({ ok: false, error: 'METHOD_NOT_ALLOWED' }), {
    status: 405,
    headers: { allow: 'POST', 'content-type': 'application/json' },
  });
