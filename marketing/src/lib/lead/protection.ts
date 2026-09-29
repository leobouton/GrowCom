/**
 * Protections anti-abus du formulaire : limitation du nombre d'envois et vérification Turnstile.
 */

export interface RateLimiterBinding {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** Repli en mémoire (développement, ou si le binding Cloudflare n'est pas configuré). */
const memoryHits = new Map<string, number[]>();
export const MEMORY_LIMIT = 5;
export const MEMORY_WINDOW_MS = 10 * 60 * 1000;

export function memoryRateLimit(key: string, now = Date.now()): boolean {
  const recent = (memoryHits.get(key) ?? []).filter((t) => now - t < MEMORY_WINDOW_MS);
  if (recent.length >= MEMORY_LIMIT) {
    memoryHits.set(key, recent);
    return false;
  }
  recent.push(now);
  memoryHits.set(key, recent);
  if (memoryHits.size > 5000) memoryHits.clear(); // garde-fou mémoire
  return true;
}

export function resetMemoryRateLimit(): void {
  memoryHits.clear();
}

/**
 * true si la demande est autorisée. Le binding Cloudflare (limite partagée par site Cloudflare)
 * est prioritaire ; le compteur en mémoire s'applique en plus, par instance.
 */
export async function checkRateLimit(key: string, binding?: RateLimiterBinding): Promise<boolean> {
  if (binding) {
    try {
      const { success } = await binding.limit({ key });
      if (!success) return false;
    } catch {
      // Binding indisponible : on s'appuie sur le compteur en mémoire
    }
  }
  return memoryRateLimit(key);
}

const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** Vérifie le jeton Turnstile auprès de Cloudflare. */
export async function verifyTurnstile(
  fetchFn: typeof fetch,
  secret: string,
  token: string,
  ip: string | null,
): Promise<boolean> {
  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  if (ip) form.append('remoteip', ip);
  try {
    const response = await fetchFn(TURNSTILE_VERIFY_URL, { method: 'POST', body: form, signal: AbortSignal.timeout(6000) });
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}
