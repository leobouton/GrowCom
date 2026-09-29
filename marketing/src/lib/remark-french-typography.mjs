/**
 * Typographie française automatique pour les articles Markdown / MDX :
 * espaces insécables là où un retour à la ligne serait fautif.
 *   « 40 000 € » → 40 000 et € restent collés ; « : ; ? ! % » ne partent jamais seuls à la ligne ;
 *   les guillemets « » restent collés à leur contenu.
 * Aucune dépendance : parcours simple de l'arbre Markdown (nœuds texte uniquement,
 * le code et les liens bruts ne sont pas touchés).
 */

const NBSP = ' ';
const NNBSP = ' ';

export function frenchTypographyText(text) {
  return (
    text
      // séparateur de milliers : 40 000 → 40 000 (espace fine insécable)
      .replace(/(\d)[  ](?=\d{3}(?!\d))/g, `$1${NNBSP}`)
      // nombre suivi d'une unité : 11 875 €, 30 %, 3 ans
      .replace(/(\d) (?=(€|%|k€|ans?\b|mois\b|jours?\b|HT\b|TTC\b))/g, `$1${NBSP}`)
      // ponctuation haute : espace fine insécable avant ; ? ! et insécable avant :
      .replace(/ ([;?!])/g, `${NNBSP}$1`)
      .replace(/ :/g, `${NBSP}:`)
      // guillemets français
      .replace(/« /g, `«${NBSP}`)
      .replace(/ »/g, `${NBSP}»`)
  );
}

function walk(node) {
  if (node.type === 'text' && typeof node.value === 'string') {
    node.value = frenchTypographyText(node.value);
    return;
  }
  if (node.type === 'code' || node.type === 'inlineCode') return;
  if (Array.isArray(node.children)) node.children.forEach(walk);
}

export default function remarkFrenchTypography() {
  return (tree) => walk(tree);
}
