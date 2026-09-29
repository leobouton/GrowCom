/**
 * Données structurées schema.org (JSON-LD) : aident Google à comprendre chaque page.
 * Uniquement des informations vraies : pas de note, d'avis ni de nombre d'utilisateurs inventés.
 */
import { ROUTES, SITE } from './site';

type JsonLd = Record<string, unknown>;

const ORGANIZATION_ID = `${SITE.url}/#organization`;
const WEBSITE_ID = `${SITE.url}/#website`;

export const absoluteUrl = (path: string) => new URL(path, SITE.url).href;

export function organizationLd(): JsonLd {
  return {
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
    name: SITE.name,
    url: SITE.url,
    logo: { '@type': 'ImageObject', url: absoluteUrl('/logo-growcom.png'), width: 512, height: 512 },
    email: SITE.contactEmail,
    description: 'Logiciel de calcul et de suivi des commissions des négociateurs pour les agences immobilières.',
  };
}

export function websiteLd(): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': WEBSITE_ID,
    url: SITE.url,
    name: SITE.name,
    inLanguage: 'fr-FR',
    publisher: { '@id': ORGANIZATION_ID },
  };
}

export function breadcrumbLd(items: Array<{ name: string; path: string }>): JsonLd {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: [{ name: 'Accueil', path: ROUTES.home }, ...items].map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: absoluteUrl(item.path),
    })),
  };
}

export function simulatorLd(description: string): JsonLd {
  return {
    '@type': 'WebApplication',
    '@id': `${absoluteUrl(ROUTES.simulator)}#simulateur`,
    name: 'Simulateur de commission négociateur immobilier',
    url: absoluteUrl(ROUTES.simulator),
    description,
    applicationCategory: 'BusinessApplication',
    operatingSystem: 'Tous (navigateur web)',
    browserRequirements: 'JavaScript',
    inLanguage: 'fr-FR',
    isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'EUR' },
    featureList: [
      'Commission en pourcentage, au forfait ou par paliers',
      'Paliers par tranche, au taux atteint ou avec effet rétroactif',
      'Partage de la vente entre plusieurs intervenants',
      'Retenues (pack, redevance de réseau)',
      'Projection de la rémunération sur l’année',
    ],
    provider: { '@id': ORGANIZATION_ID },
  };
}

export interface FaqItem {
  question: string;
  /** Réponse en texte simple (reprise telle quelle dans le JSON-LD et affichée sur la page). */
  answer: string;
}

export function faqLd(items: FaqItem[]): JsonLd {
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((item) => ({
      '@type': 'Question',
      name: item.question,
      acceptedAnswer: { '@type': 'Answer', text: item.answer },
    })),
  };
}

export function blogPostingLd(post: { title: string; description: string; path: string; publishedAt: Date; updatedAt?: Date; image: string }): JsonLd {
  return {
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    url: absoluteUrl(post.path),
    mainEntityOfPage: absoluteUrl(post.path),
    datePublished: post.publishedAt.toISOString(),
    dateModified: (post.updatedAt ?? post.publishedAt).toISOString(),
    inLanguage: 'fr-FR',
    image: absoluteUrl(post.image),
    author: { '@id': ORGANIZATION_ID },
    publisher: { '@id': ORGANIZATION_ID },
  };
}

/** Regroupe plusieurs entités dans un seul bloc JSON-LD. */
export function graph(...nodes: JsonLd[]): JsonLd {
  return { '@context': 'https://schema.org', '@graph': nodes };
}

/** Sérialisation sûre dans une balise <script> (aucune fermeture de balise possible). */
export function serializeJsonLd(data: JsonLd): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
