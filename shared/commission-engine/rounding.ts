/**
 * Arrondis monétaires — tout montant produit par le moteur est arrondi au centime.
 * Fonctions pures, sans dépendance.
 */

/**
 * Arrondit au centime (demi-centime arrondi à l'unité supérieure en valeur absolue).
 * Le passage par toPrecision(15) neutralise les erreurs binaires des flottants :
 * 1.005 * 100 vaut 100.49999999999999 en JavaScript, on veut bien 1.01.
 */
export function roundCents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const cents = Number((Math.abs(value) * 100).toPrecision(15));
  const rounded = Math.round(cents) / 100;
  return value < 0 ? -rounded : rounded;
}

/** Part d'un montant pour un intervenant (share entre 0 et 1), arrondie au centime. */
export function applyShare(amount: number, share: number): number {
  return roundCents(amount * share);
}

/** Tolérance sur la somme des parts (les pourcentages saisis ne tombent pas toujours pile en flottant). */
export const SHARES_SUM_TOLERANCE = 1e-6;

/** Vérifie qu'une liste de parts est exploitable : chaque part entre 0 et 1, somme = 1. */
export function assertValidShares(shares: number[]): void {
  if (shares.length === 0) {
    throw new RangeError('Au moins un intervenant est requis');
  }
  for (const share of shares) {
    if (!Number.isFinite(share) || share < 0 || share > 1) {
      throw new RangeError(`Part invalide : ${share} (attendu entre 0 et 1)`);
    }
  }
  const sum = shares.reduce((s, share) => s + share, 0);
  if (Math.abs(sum - 1) > SHARES_SUM_TOLERANCE) {
    throw new RangeError(`La somme des parts doit être égale à 100 % (actuellement ${roundCents(sum * 100)} %)`);
  }
}

/**
 * Répartit un montant entre plusieurs parts sans perdre ni créer de centime :
 * la somme des montants retournés vaut exactement le montant arrondi.
 * Méthode du plus fort reste : chacun reçoit sa part tronquée au centime, puis les
 * centimes restants vont aux plus grosses parties décimales (à égalité : ordre de la liste).
 * Exemple : 100 € en trois tiers → 33,34 + 33,33 + 33,33.
 */
export function allocateByShares(amount: number, shares: number[]): number[] {
  assertValidShares(shares);
  const totalCents = Math.round(roundCents(amount) * 100);
  const sign = totalCents < 0 ? -1 : 1;
  const absCents = Math.abs(totalCents);

  const raw = shares.map((share) => absCents * share);
  const floors = raw.map((r) => Math.floor(Number(r.toPrecision(15))));
  let leftover = absCents - floors.reduce((s, c) => s + c, 0);

  const order = raw
    .map((r, index) => ({ index, remainder: r - floors[index] }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of order) {
    if (leftover <= 0) break;
    floors[index] += 1;
    leftover -= 1;
  }

  return floors.map((cents) => (sign * cents) / 100);
}
