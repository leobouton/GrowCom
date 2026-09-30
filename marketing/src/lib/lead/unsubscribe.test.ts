import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createUnsubscribeToken, readUnsubscribeToken } from './unsubscribe-token';
import { buildUnsubscribeLinks, handleUnsubscribeRequest } from './unsubscribe';
import { handleLeadRequest, type LeadEnv } from './handler';
import { resetMemoryRateLimit } from './protection';

const SECRET = 'secret-de-test';
const ORIGIN = 'https://growcom.fr';

describe('jeton de désinscription', () => {
  it('aller-retour : le jeton redonne l\'adresse', async () => {
    const token = await createUnsubscribeToken('sophie@agence.fr', SECRET);
    expect(await readUnsubscribeToken(token, SECRET)).toBe('sophie@agence.fr');
  });

  it('l\'adresse n\'apparaît pas dans le jeton (chiffrée, sûre pour une URL)', async () => {
    const token = await createUnsubscribeToken('sophie@agence.fr', SECRET);
    expect(token).not.toContain('sophie');
    expect(atob(token.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('agence');
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('deux jetons pour la même adresse sont différents', async () => {
    expect(await createUnsubscribeToken('a@b.fr', SECRET)).not.toBe(await createUnsubscribeToken('a@b.fr', SECRET));
  });

  it('jeton falsifié, tronqué ou d\'un autre secret → refusé', async () => {
    const token = await createUnsubscribeToken('sophie@agence.fr', SECRET);
    const tampered = `${token.slice(0, -3)}${token.slice(-3) === 'AAA' ? 'BBB' : 'AAA'}`;
    expect(await readUnsubscribeToken(tampered, SECRET)).toBeNull();
    expect(await readUnsubscribeToken(token.slice(0, 20), SECRET)).toBeNull();
    expect(await readUnsubscribeToken(token, 'autre-secret')).toBeNull();
    expect(await readUnsubscribeToken('pas un jeton !', SECRET)).toBeNull();
  });

  it('liens : jeton après « # » sur la page, en-têtes RFC 8058 pour les messageries', async () => {
    const links = await buildUnsubscribeLinks('sophie@agence.fr', SECRET);
    expect(links.page).toMatch(/^https:\/\/growcom\.fr\/desinscription#t=[A-Za-z0-9_-]+$/);
    expect(links.headers['List-Unsubscribe']).toMatch(/^<https:\/\/growcom\.fr\/api\/unsubscribe\?t=[A-Za-z0-9_-]+>, <mailto:/);
    expect(links.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });
});

// ─── Endpoint /api/unsubscribe ───────────────────────────────────────────────

const env: LeadEnv = { BREVO_API_KEY: 'xkeysib-test', UNSUBSCRIBE_SECRET: SECRET };

function brevoMock(status = 204) {
  return vi.fn(async () => new Response(status === 204 ? null : JSON.stringify({ code: 'x', message: 'y' }), { status }));
}

const run = (req: Request, fetchFn = brevoMock(), e: LeadEnv = env) =>
  handleUnsubscribeRequest(req, { env: e, fetch: fetchFn as unknown as typeof fetch, log: () => {} });

const fromPage = (token: string, origin: string | null = ORIGIN) =>
  new Request(`${ORIGIN}/api/unsubscribe`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(origin ? { origin } : {}) },
    body: JSON.stringify({ token }),
  });

const fromMailbox = (token: string, body = 'List-Unsubscribe=One-Click') =>
  new Request(`${ORIGIN}/api/unsubscribe?t=${token}`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

describe('POST /api/unsubscribe', () => {
  beforeEach(() => resetMemoryRateLimit());

  it('depuis la page : le contact est marqué désinscrit dans Brevo', async () => {
    const fetchFn = brevoMock();
    const token = await createUnsubscribeToken('sophie@agence.fr', SECRET);
    const response = await run(fromPage(token), fetchFn);
    expect(response.status).toBe(200);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.brevo.com/v3/contacts/sophie%40agence.fr');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(String(init.body))).toEqual({ emailBlacklisted: true });
  });

  it('bouton « Se désabonner » d\'une messagerie (RFC 8058)', async () => {
    const token = await createUnsubscribeToken('sophie@agence.fr', SECRET);
    expect((await run(fromMailbox(token))).status).toBe(200);
    expect((await run(fromMailbox(token, 'autre=chose'))).status).toBe(400);
  });

  it('depuis un autre site → 403 ; méthode ou format inattendus → refusés', async () => {
    const token = await createUnsubscribeToken('a@b.fr', SECRET);
    expect((await run(fromPage(token, 'https://evil.example'))).status).toBe(403);
    expect((await run(new Request(`${ORIGIN}/api/unsubscribe`, { method: 'GET' }))).status).toBe(405);
    expect((await run(new Request(`${ORIGIN}/api/unsubscribe`, { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } }))).status).toBe(415);
  });

  it('jeton invalide → 400 avec une solution de repli (email de contact), sans appel à Brevo', async () => {
    const fetchFn = brevoMock();
    const response = await run(fromPage('jeton-bidon'), fetchFn);
    expect(response.status).toBe(400);
    expect((await response.json()).message).toContain('@');
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('contact inconnu de Brevo → considéré comme désinscrit', async () => {
    const token = await createUnsubscribeToken('inconnu@b.fr', SECRET);
    expect((await run(fromPage(token), brevoMock(404))).status).toBe(200);
  });

  it('Brevo en panne → 502', async () => {
    const token = await createUnsubscribeToken('a@b.fr', SECRET);
    expect((await run(fromPage(token), brevoMock(500))).status).toBe(502);
  });

  it('sans secret dédié : la clé Brevo sert de secret', async () => {
    const token = await createUnsubscribeToken('a@b.fr', 'xkeysib-test');
    expect((await run(fromPage(token), brevoMock(), { BREVO_API_KEY: 'xkeysib-test' })).status).toBe(200);
  });
});

// ─── Lien de désinscription dans l'email du document ─────────────────────────

describe('email du document', () => {
  beforeEach(() => resetMemoryRateLimit());

  const leadRequest = () =>
    new Request(`${ORIGIN}/api/lead`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: ORIGIN, 'cf-connecting-ip': '203.0.113.9' },
      body: JSON.stringify({ email: 'sophie@agence.fr', source: 'simulateur' }),
    });
  const leadEnv: LeadEnv = { ...env, BREVO_SENDER_EMAIL: 'bonjour@growcom.fr' };

  function mailMock(emailStatuses: number[]) {
    const statuses = [...emailStatuses];
    return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void init;
      if (String(url).endsWith('/contacts')) return new Response(JSON.stringify({ id: 1 }), { status: 201 });
      const status = statuses.shift() ?? 201;
      return new Response(JSON.stringify(status === 201 ? { messageId: 'x' } : { code: 'bad', message: 'header' }), { status });
    });
  }
  const sentEmails = (fetchFn: ReturnType<typeof mailMock>) =>
    fetchFn.mock.calls.filter(([url]) => String(url).endsWith('/smtp/email')).map(([, init]) => JSON.parse(String(init?.body)));

  it('contient le lien de désinscription en un clic et les en-têtes des messageries', async () => {
    const fetchFn = mailMock([201]);
    await handleLeadRequest(leadRequest(), { env: leadEnv, fetch: fetchFn as unknown as typeof fetch, log: () => {} });
    const [email] = sentEmails(fetchFn);
    expect(email.htmlContent).toContain('se désinscrire en un clic');
    const link = email.htmlContent.match(/https:\/\/growcom\.fr\/desinscription#t=([A-Za-z0-9_-]+)/);
    expect(await readUnsubscribeToken(link[1], SECRET)).toBe('sophie@agence.fr');
    expect(email.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
  });

  it('si Brevo refuse les en-têtes, l\'email part quand même (lien conservé dans le pied)', async () => {
    const fetchFn = mailMock([400, 201]);
    const response = await handleLeadRequest(leadRequest(), { env: leadEnv, fetch: fetchFn as unknown as typeof fetch, log: () => {} });
    expect(await response.json()).toEqual({ ok: true, emailSent: true });
    const emails = sentEmails(fetchFn);
    expect(emails).toHaveLength(2);
    expect(emails[1].headers).toBeUndefined();
    expect(emails[1].htmlContent).toContain('se désinscrire en un clic');
  });
});
