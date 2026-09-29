/**
 * Validation stricte d'une demande de document (formulaire « Recevoir ce calcul en PDF »).
 * Fonctions pures, partagées par le formulaire (messages immédiats) et le serveur (qui fait foi).
 */

export type LeadSource = 'simulateur' | 'modele-grille';

export const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'cid'] as const;
export type AttributionKey = (typeof ATTRIBUTION_KEYS)[number];
export type Attribution = Partial<Record<AttributionKey, string>>;

/** Ce que le navigateur envoie (en POST, jamais dans l'URL). */
export interface LeadRequestBody {
  email?: unknown;
  firstName?: unknown;
  agency?: unknown;
  city?: unknown;
  phone?: unknown;
  source?: unknown;
  /** Paramètres de la simulation (query string), nettoyés côté serveur. */
  simulation?: unknown;
  attribution?: unknown;
  /** Champ piège invisible : un humain le laisse vide. */
  website?: unknown;
  /** Moment d'ouverture du formulaire (ms) : un envoi en moins de 2 s trahit un robot. */
  startedAt?: unknown;
  turnstileToken?: unknown;
}

export interface Lead {
  email: string;
  firstName: string | null;
  agency: string | null;
  city: string | null;
  /** Format international (+33612345678) ; présent = demande de rappel. */
  phone: string | null;
  source: LeadSource;
  simulation: string | null;
  attribution: Attribution;
}

export type LeadFieldError = 'email' | 'phone' | 'firstName' | 'agency' | 'city' | 'source';

export type LeadValidation =
  | { ok: true; lead: Lead; suspicious: boolean }
  | { ok: false; errors: Partial<Record<LeadFieldError, string>> };

export const MIN_FILL_TIME_MS = 2000;

const EMAIL_PATTERN =
  /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;

/** Email strict : forme usuelle, longueurs RFC, domaine avec extension alphabétique. */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  const [local] = email.split('@');
  if (!local || local.length > 64) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Téléphone → format international.
 * « 06 12 34 56 78 », « 06.12.34.56.78 », « +33 6 12 34 56 78 », « 0033612345678 » → +33612345678.
 * Numéros étrangers acceptés s'ils commencent par + ou 00 (8 à 15 chiffres).
 */
export function normalizePhone(raw: string): string | null {
  const compact = raw.trim().replace(/[\s.\-()  ]/g, '');
  if (compact === '') return null;
  let international: string;
  if (/^0\d{9}$/.test(compact)) international = `+33${compact.slice(1)}`;
  else if (/^00\d{8,15}$/.test(compact)) international = `+${compact.slice(2)}`;
  else if (/^\+\d{8,15}$/.test(compact)) international = compact;
  else return null;
  // Un numéro français fait toujours 9 chiffres après +33, sans 0 initial
  if (international.startsWith('+33') && !/^\+33[1-9]\d{8}$/.test(international)) return null;
  return international;
}

/** Texte libre court : caractères de contrôle retirés, espaces normalisés, longueur bornée. */
function cleanText(value: unknown, maxLength: number): string | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/[\u0000-\u001F\u007F<>]/g, '').replace(/\s+/g, ' ').trim();
  if (cleaned === '') return null;
  return cleaned.length > maxLength ? undefined : cleaned;
}

/** UTM et identifiant de campagne : caractères sûrs uniquement, 100 caractères max. */
export function cleanAttribution(value: unknown): Attribution {
  if (!value || typeof value !== 'object') return {};
  const input = value as Record<string, unknown>;
  const result: Attribution = {};
  for (const key of ATTRIBUTION_KEYS) {
    const raw = input[key];
    if (typeof raw !== 'string') continue;
    const cleaned = raw.trim().slice(0, 100).replace(/[^\p{L}\p{N} ._~:/@+-]/gu, '');
    if (cleaned) result[key] = cleaned;
  }
  return result;
}

export function validateLead(body: LeadRequestBody, now = Date.now()): LeadValidation {
  const errors: Partial<Record<LeadFieldError, string>> = {};

  const email = typeof body.email === 'string' ? normalizeEmail(body.email) : null;
  if (!email) errors.email = 'Adresse email invalide.';

  let phone: string | null = null;
  if (typeof body.phone === 'string' && body.phone.trim() !== '') {
    phone = normalizePhone(body.phone);
    if (!phone) errors.phone = 'Numéro de téléphone invalide (ex. 06 12 34 56 78).';
  } else if (body.phone !== undefined && body.phone !== null && typeof body.phone !== 'string') {
    errors.phone = 'Numéro de téléphone invalide.';
  }

  const firstName = cleanText(body.firstName, 60);
  if (firstName === undefined) errors.firstName = 'Prénom trop long (60 caractères max).';
  const agency = cleanText(body.agency, 100);
  if (agency === undefined) errors.agency = 'Nom d\'agence trop long (100 caractères max).';
  const city = cleanText(body.city, 80);
  if (city === undefined) errors.city = 'Ville trop longue (80 caractères max).';

  const source = body.source === 'simulateur' || body.source === 'modele-grille' ? body.source : null;
  if (!source) errors.source = 'Origine de la demande inconnue.';

  if (Object.keys(errors).length > 0 || !email || !source) return { ok: false, errors };

  const simulation = typeof body.simulation === 'string' && body.simulation.length <= 1000 ? body.simulation : null;
  const honeypotFilled = typeof body.website === 'string' && body.website.trim() !== '';
  const startedAt = typeof body.startedAt === 'number' ? body.startedAt : null;
  const tooFast = startedAt !== null && now - startedAt < MIN_FILL_TIME_MS;

  return {
    ok: true,
    suspicious: honeypotFilled || tooFast,
    lead: {
      email,
      firstName: firstName ?? null,
      agency: agency ?? null,
      city: city ?? null,
      phone,
      source,
      simulation,
      attribution: cleanAttribution(body.attribution),
    },
  };
}
