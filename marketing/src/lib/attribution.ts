/**
 * Attribution des campagnes (cold emails…) SANS aucun stockage dans le navigateur :
 * les paramètres de campagne présents dans l'adresse d'arrivée sont reportés sur les liens
 * internes, et suivent ainsi le visiteur de page en page jusqu'au formulaire.
 * Pas de cookie, pas de sessionStorage : rien à déclarer, aucun bandeau de consentement.
 */
import { ATTRIBUTION_KEYS } from './lead/validation';

/** Paramètres de campagne présents dans une query string (?utm_source=…&cid=…). */
export function attributionParams(search: string): Array<[string, string]> {
  const params = new URLSearchParams(search);
  return ATTRIBUTION_KEYS.flatMap((key) => {
    const value = params.get(key);
    return value ? [[key, value] as [string, string]] : [];
  });
}

/**
 * Lien interne complété avec les paramètres de campagne (ceux déjà présents dans le lien sont gardés).
 * Renvoie null si le lien ne doit pas être modifié : autre site, email, API, fichier à télécharger, ancre seule.
 */
export function withAttribution(href: string, carried: Array<[string, string]>, currentUrl: string): string | null {
  if (carried.length === 0 || href.startsWith('#') || /^(mailto|tel|sms|javascript):/i.test(href)) return null;
  let url: URL;
  try {
    url = new URL(href, currentUrl);
  } catch {
    return null;
  }
  if (url.origin !== new URL(currentUrl).origin) return null;
  if (url.pathname.startsWith('/api/') || /\.[a-z0-9]{2,5}$/i.test(url.pathname)) return null;
  let changed = false;
  for (const [key, value] of carried) {
    if (!url.searchParams.has(key)) {
      url.searchParams.set(key, value);
      changed = true;
    }
  }
  return changed ? `${url.pathname}${url.search}${url.hash}` : null;
}

/** Adresse de la page sans les paramètres de campagne (pour un lien à partager). */
export function withoutAttribution(url: string): string {
  const clean = new URL(url);
  for (const key of ATTRIBUTION_KEYS) clean.searchParams.delete(key);
  return clean.href;
}
