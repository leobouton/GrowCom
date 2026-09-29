/** Formatage des nombres à la française (affichage uniquement, aucun calcul ici). */

const eurFormatters = new Map<number, Intl.NumberFormat>();

export function formatEur(value: number, fractionDigits = 0): string {
  let formatter = eurFormatters.get(fractionDigits);
  if (!formatter) {
    formatter = new Intl.NumberFormat('fr-FR', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    eurFormatters.set(fractionDigits, formatter);
  }
  return formatter.format(value);
}

/** Montant au centime, sans « ,00 » inutile pour les montants ronds. */
export function formatEurSmart(value: number): string {
  return formatEur(value, Number.isInteger(value) ? 0 : 2);
}

/** Taux décimal → « 35 % », « 2,5 % » (espace insécable : le « % » ne part jamais seul à la ligne). */
export function formatPercent(rate: number): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(rate * 100)} %`;
}

export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
}
