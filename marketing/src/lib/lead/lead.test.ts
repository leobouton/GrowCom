import { describe, it, expect, beforeEach, vi } from 'vitest';
import { normalizeEmail, normalizePhone, validateLead, cleanAttribution } from './validation';
import { handleLeadRequest, simulationLink, brevoAttributes, type LeadEnv } from './handler';
import { resetMemoryRateLimit, MEMORY_LIMIT } from './protection';

// ─── Validation ──────────────────────────────────────────────────────────────

describe('normalizeEmail', () => {
  it.each([
    ['Sophie.Martin@Agence-Horizon.fr', 'sophie.martin@agence-horizon.fr'],
    ['  contact+simu@gmail.com ', 'contact+simu@gmail.com'],
  ])('accepte %s', (input, expected) => expect(normalizeEmail(input)).toBe(expected));

  it.each(['', 'sophie', 'sophie@', '@agence.fr', 'sophie@agence', 'so phie@agence.fr', 'sophie@@agence.fr', 'a..b@agence.fr', 'sophie@agence.f', `${'a'.repeat(65)}@agence.fr`, 'x@-agence.fr'])(
    'refuse « %s »',
    (input) => expect(normalizeEmail(input)).toBeNull(),
  );
});

describe('normalizePhone', () => {
  it.each([
    ['06 12 34 56 78', '+33612345678'],
    ['06.12.34.56.78', '+33612345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['0033612345678', '+33612345678'],
    ['01-23-45-67-89', '+33123456789'],
    ['+32 470 12 34 56', '+32470123456'],
  ])('%s → %s', (input, expected) => expect(normalizePhone(input)).toBe(expected));

  it.each(['12345', '06 12 34', '+33 0 12 34 56 78', 'appelez-moi', '00 12'])('refuse « %s »', (input) =>
    expect(normalizePhone(input)).toBeNull(),
  );
});

describe('validateLead', () => {
  const base = { email: 'sophie@agence.fr', source: 'simulateur' };

  it('email seul : valide, pas de rappel', () => {
    const result = validateLead(base);
    expect(result.ok && result.lead).toMatchObject({ email: 'sophie@agence.fr', phone: null, firstName: null });
  });

  it('champs facultatifs nettoyés (balises, espaces, contrôles)', () => {
    const result = validateLead({ ...base, firstName: '  Sophie <b>  ', agency: 'Agence\u0000 Horizon', city: 'Nantes', phone: '06 12 34 56 78' });
    expect(result.ok && result.lead).toMatchObject({ firstName: 'Sophie b', agency: 'Agence Horizon', city: 'Nantes', phone: '+33612345678' });
  });

  it('erreurs par champ', () => {
    const result = validateLead({ email: 'pas-un-email', phone: '123', agency: 'x'.repeat(101), source: 'autre' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['agency', 'email', 'phone', 'source']);
  });

  it('champ piège rempli ou envoi en moins de 2 s → suspect', () => {
    const now = 1_000_000;
    expect(validateLead({ ...base, website: 'http://spam' }, now)).toMatchObject({ ok: true, suspicious: true });
    expect(validateLead({ ...base, startedAt: now - 500 }, now)).toMatchObject({ ok: true, suspicious: true });
    expect(validateLead({ ...base, startedAt: now - 15000 }, now)).toMatchObject({ ok: true, suspicious: false });
  });

  it('attribution : clés connues uniquement, caractères sûrs', () => {
    expect(cleanAttribution({ utm_source: 'lemlist', utm_campaign: 'immo<script>', evil: 'x', cid: 'A-12' })).toEqual({
      utm_source: 'lemlist',
      utm_campaign: 'immoscript',
      cid: 'A-12',
    });
  });
});

describe('simulationLink', () => {
  it('reconstruit un lien propre à partir des paramètres', () => {
    const link = simulationLink('prix=300000&hon=5&injection=<x>');
    expect(link).toContain('https://growcom.fr/simulateur-commission-negociateur-immobilier?prix=300000');
    expect(link).not.toContain('injection');
  });

  it('simulation par défaut ou absente → lien simple ou rien', () => {
    expect(simulationLink('utm_source=x')).toBe('https://growcom.fr/simulateur-commission-negociateur-immobilier');
    expect(simulationLink(null)).toBeNull();
  });
});

describe('brevoAttributes', () => {
  it('n\'envoie que les champs renseignés et marque la demande de rappel', () => {
    const result = validateLead({ email: 'a@b.fr', source: 'simulateur', phone: '0612345678', attribution: { utm_campaign: 'sept' } });
    if (!result.ok) throw new Error('invalide');
    expect(brevoAttributes(result.lead, null, '2026-09-29')).toEqual({
      SOURCE: 'simulateur',
      DATE_DEMANDE: '2026-09-29',
      TELEPHONE: '+33612345678',
      UTM_CAMPAIGN: 'sept',
      RAPPEL_DEMANDE: true,
    });
  });
});

// ─── Endpoint ────────────────────────────────────────────────────────────────

const ORIGIN = 'https://growcom.fr';
const NOW = 1_700_000_000_000;

function request(body: unknown, init: { origin?: string | null; contentType?: string; method?: string; ip?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': init.contentType ?? 'application/json', 'cf-connecting-ip': init.ip ?? '203.0.113.7' };
  if (init.origin !== null) headers.origin = init.origin ?? ORIGIN;
  return new Request(`${ORIGIN}/api/lead`, {
    method: init.method ?? 'POST',
    headers,
    body: init.method === 'GET' ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

const validBody = {
  email: 'Sophie@Agence.fr',
  firstName: 'Sophie',
  agency: 'Agence Horizon',
  phone: '06 12 34 56 78',
  source: 'simulateur',
  simulation: 'prix=300000&hon=5',
  attribution: { utm_source: 'lemlist', utm_campaign: 'rentree' },
  website: '',
  startedAt: NOW - 30000,
  turnstileToken: 'token-ok',
};

const fullEnv: LeadEnv = {
  BREVO_API_KEY: 'xkeysib-test',
  BREVO_LIST_ID: '7',
  BREVO_SENDER_EMAIL: 'bonjour@growcom.fr',
  BREVO_SENDER_NAME: 'GrowCom',
  LEAD_NOTIFY_EMAIL: 'leo@growcom.fr',
  TURNSTILE_SECRET_KEY: 'secret',
};

function mockFetch(overrides: { contact?: number[]; email?: number; turnstile?: boolean } = {}) {
  const contactStatuses = [...(overrides.contact ?? [201])];
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    if (href.includes('turnstile')) return new Response(JSON.stringify({ success: overrides.turnstile ?? true }));
    if (href.endsWith('/contacts')) {
      const status = contactStatuses.shift() ?? 201;
      return new Response(status === 201 ? JSON.stringify({ id: 1 }) : status === 204 ? null : JSON.stringify({ code: 'invalid_parameter', message: 'attribute not found' }), { status });
    }
    if (href.endsWith('/smtp/email')) return new Response(JSON.stringify({ messageId: 'x' }), { status: overrides.email ?? 201 });
    void init;
    return new Response('not found', { status: 404 });
  });
}

const run = (req: Request, env: LeadEnv = fullEnv, fetchFn = mockFetch()) =>
  handleLeadRequest(req, { env, fetch: fetchFn as unknown as typeof fetch, now: () => NOW, log: () => {} });

const bodyOf = (fetchFn: ReturnType<typeof mockFetch>, suffix: string) =>
  fetchFn.mock.calls.filter(([url]) => String(url).endsWith(suffix)).map(([, init]) => JSON.parse(String(init?.body)));

describe('POST /api/lead', () => {
  beforeEach(() => resetMemoryRateLimit());

  it('demande valide : contact Brevo dans la liste, email du document, alerte de rappel', async () => {
    const fetchFn = mockFetch();
    const response = await run(request(validBody), fullEnv, fetchFn);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, emailSent: true });

    const [contact] = bodyOf(fetchFn, '/contacts');
    expect(contact).toMatchObject({
      email: 'sophie@agence.fr',
      listIds: [7],
      updateEnabled: true,
      attributes: { PRENOM: 'Sophie', AGENCE: 'Agence Horizon', TELEPHONE: '+33612345678', RAPPEL_DEMANDE: true, SOURCE: 'simulateur', UTM_SOURCE: 'lemlist', UTM_CAMPAIGN: 'rentree' },
    });
    expect(contact.attributes.LIEN_SIMULATION).toContain('prix=300000');

    const emails = bodyOf(fetchFn, '/smtp/email');
    expect(emails).toHaveLength(2);
    expect(emails[0].to).toEqual([{ email: 'sophie@agence.fr', name: 'Sophie' }]);
    expect(emails[0].htmlContent).toContain('grille-de-commissionnement-growcom.xlsx');
    expect(emails[0].htmlContent).toContain('STOP');
    expect(emails[1].to).toEqual([{ email: 'leo@growcom.fr' }]);
    expect(emails[1].textContent).toContain('+33612345678');
  });

  it('sans téléphone : pas d\'alerte de rappel', async () => {
    const fetchFn = mockFetch();
    await run(request({ ...validBody, phone: '' }), fullEnv, fetchFn);
    expect(bodyOf(fetchFn, '/smtp/email')).toHaveLength(1);
    expect(bodyOf(fetchFn, '/contacts')[0].attributes.RAPPEL_DEMANDE).toBeUndefined();
  });

  it('la clé API n\'apparaît jamais dans la réponse', async () => {
    const response = await run(request(validBody));
    expect(await response.text()).not.toContain('xkeysib');
  });

  it('autre origine → 403, sans appel à Brevo', async () => {
    const fetchFn = mockFetch();
    expect((await run(request(validBody, { origin: 'https://evil.example' }), fullEnv, fetchFn)).status).toBe(403);
    expect((await run(request(validBody, { origin: null }), fullEnv, fetchFn)).status).toBe(403);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('méthode, format et taille contrôlés', async () => {
    expect((await run(request(null, { method: 'GET' }))).status).toBe(405);
    expect((await run(request('email=a@b.fr', { contentType: 'application/x-www-form-urlencoded' }))).status).toBe(415);
    expect((await run(request('{pas du json'))).status).toBe(400);
    expect((await run(request({ ...validBody, agency: 'x'.repeat(9000) }))).status).toBe(413);
  });

  it('champs invalides → 400 avec le détail par champ', async () => {
    const response = await run(request({ ...validBody, email: 'nope', phone: '12' }));
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(Object.keys(data.fields).sort()).toEqual(['email', 'phone']);
  });

  it('robot (champ piège) : 200 en apparence, mais rien n\'est envoyé', async () => {
    const fetchFn = mockFetch();
    const response = await run(request({ ...validBody, website: 'spam.example' }), fullEnv, fetchFn);
    expect(response.status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('Turnstile refusé ou absent → 400', async () => {
    expect((await run(request(validBody), fullEnv, mockFetch({ turnstile: false }))).status).toBe(400);
    expect((await run(request({ ...validBody, turnstileToken: undefined }))).status).toBe(400);
  });

  it(`limitation : au-delà de ${MEMORY_LIMIT} demandes par adresse IP → 429`, async () => {
    for (let i = 0; i < MEMORY_LIMIT; i++) expect((await run(request(validBody))).status).toBe(200);
    expect((await run(request(validBody))).status).toBe(429);
    expect((await run(request(validBody, { ip: '198.51.100.1' }))).status).toBe(200);
  });

  it('binding Cloudflare qui refuse → 429', async () => {
    const env = { ...fullEnv, LEAD_RATE_LIMITER: { limit: async () => ({ success: false }) } };
    expect((await run(request(validBody), env)).status).toBe(429);
  });

  it('attributs refusés par Brevo : le contact est quand même enregistré (email seul)', async () => {
    const fetchFn = mockFetch({ contact: [400, 201] });
    const response = await run(request(validBody), fullEnv, fetchFn);
    expect(response.status).toBe(200);
    const calls = bodyOf(fetchFn, '/contacts');
    expect(calls).toHaveLength(2);
    expect(calls[1]).toEqual({ email: 'sophie@agence.fr', listIds: [7], updateEnabled: true });
  });

  it('Brevo en panne → 502 avec un message clair', async () => {
    const response = await run(request(validBody), fullEnv, mockFetch({ contact: [500] }));
    expect(response.status).toBe(502);
    expect((await response.json()).message).toContain('Réessayez');
  });

  it('email du document en échec : le contact est gardé, réponse ok avec emailSent=false', async () => {
    const response = await run(request(validBody), fullEnv, mockFetch({ email: 500 }));
    expect(await response.json()).toEqual({ ok: true, emailSent: false });
  });

  it('sans clé Brevo : mode test explicite, sinon erreur de configuration', async () => {
    expect(await (await run(request(validBody), { LEAD_TEST_MODE: '1' })).json()).toEqual({ ok: true, emailSent: false, test: true });
    expect((await run(request(validBody), {})).status).toBe(500);
  });
});
