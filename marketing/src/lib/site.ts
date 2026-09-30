/**
 * Constantes du site marketing. Les URL absolues servent aux balises canoniques,
 * au sitemap et aux liens vers l'app.
 */
export const SITE = {
  name: 'GrowCom',
  url: 'https://growcom.fr',
  /** L'app SaaS, mise en ligne plus tard sur ce sous-domaine. */
  appUrl: 'https://app.growcom.fr',
  // Adresse de contact affichée sur le site et utilisée pour les réponses aux emails.
  // Elle doit recevoir les messages avant la mise en ligne (voir docs/deploiement.md, étape 5.4).
  contactEmail: 'leo.bouton@growcom.fr',
  locale: 'fr_FR',
} as const;

export const ROUTES = {
  home: '/',
  simulator: '/simulateur-commission-negociateur-immobilier',
  template: '/modele-grille-commissionnement',
  blog: '/blog',
  legal: '/mentions-legales',
  privacy: '/politique-de-confidentialite',
} as const;

/** Modèle de grille téléchargeable (fichiers générés par scripts/generate-templates.mjs). */
export const TEMPLATE_FILES = {
  xlsx: '/modele/grille-de-commissionnement-growcom.xlsx',
  pdf: '/modele/grille-de-commissionnement-growcom.pdf',
} as const;

/** Lien « Demander une démo » : un email pré-rempli tant qu'il n'y a pas d'outil de prise de rendez-vous. */
export const DEMO_HREF = `mailto:${SITE.contactEmail}?subject=${encodeURIComponent('Démo GrowCom')}`;

export const NAV_LINKS = [
  { href: ROUTES.simulator, label: 'Simulateur' },
  { href: ROUTES.template, label: 'Modèle de grille' },
  { href: ROUTES.blog, label: 'Blog' },
] as const;
