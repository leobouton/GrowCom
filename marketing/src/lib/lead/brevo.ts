/**
 * Appels à l'API Brevo (v3). Uniquement côté serveur : la clé API ne quitte jamais le Worker.
 */

const BREVO_API = 'https://api.brevo.com/v3';
const TIMEOUT_MS = 8000;

export class BrevoError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(`Brevo ${status}: ${detail}`);
  }
}

type Fetch = typeof fetch;
export type BrevoAttributes = Record<string, string | number | boolean>;

async function call(fetchFn: Fetch, apiKey: string, path: string, body: unknown): Promise<Response> {
  return fetchFn(`${BREVO_API}${path}`, {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { code?: string; message?: string };
    return `${data.code ?? ''} ${data.message ?? ''}`.trim();
  } catch {
    return response.statusText;
  }
}

/**
 * Crée le contact ou le met à jour s'il existe déjà, et l'ajoute à la liste.
 * Si Brevo refuse les attributs (attribut non créé dans le compte, mauvais type),
 * on réessaie avec l'email seul : le contact n'est jamais perdu pour une question de configuration.
 */
export async function upsertContact(
  fetchFn: Fetch,
  apiKey: string,
  contact: { email: string; attributes: BrevoAttributes; listIds: number[] },
): Promise<{ degraded: boolean; detail?: string }> {
  const full = await call(fetchFn, apiKey, '/contacts', { ...contact, updateEnabled: true });
  if (full.ok) return { degraded: false };

  const detail = await readError(full);
  if (full.status !== 400) throw new BrevoError(full.status, detail);

  const minimal = await call(fetchFn, apiKey, '/contacts', { email: contact.email, listIds: contact.listIds, updateEnabled: true });
  if (minimal.ok) return { degraded: true, detail };
  throw new BrevoError(minimal.status, await readError(minimal));
}

export interface TransactionalEmail {
  sender: { email: string; name: string };
  to: Array<{ email: string; name?: string }>;
  replyTo?: { email: string; name?: string };
  subject: string;
  htmlContent: string;
  textContent: string;
  tags?: string[];
}

export async function sendTransactionalEmail(fetchFn: Fetch, apiKey: string, email: TransactionalEmail): Promise<void> {
  const response = await call(fetchFn, apiKey, '/smtp/email', email);
  if (!response.ok) throw new BrevoError(response.status, await readError(response));
}
