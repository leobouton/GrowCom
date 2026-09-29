// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import react from '@astrojs/react';
import cloudflare from '@astrojs/cloudflare';
import { unified } from '@astrojs/markdown-remark';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';
import remarkFrenchTypography from './src/lib/remark-french-typography.mjs';

const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

export default defineConfig({
  site: 'https://growcom.fr',
  // URL sans barre finale ni .html : growcom.fr/simulateur-commission-negociateur-immobilier
  trailingSlash: 'never',
  build: { format: 'file' },
  // Site statique, sauf /api/lead (formulaire) exécuté par un Cloudflare Worker
  // (pas de sessions ni de service d'images : rien à configurer chez Cloudflare au-delà du Worker)
  adapter: cloudflare({ prerenderEnvironment: 'node', imageService: 'passthrough' }),
  session: false,
  // React uniquement pour les îlots interactifs (simulateur) : les autres pages restent sans JavaScript
  integrations: [mdx(), react()],
  markdown: {
    // Espaces insécables à la française dans les articles (nombres, €, %, : ; ? !, guillemets).
    // Astro 7 lit le Markdown avec « Sätteri » par défaut ; les plugins remark passent par unified.
    processor: unified({ remarkPlugins: [remarkFrenchTypography] }),
  },
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      // Moteur de calcul unique, partagé avec le backend et l'app
      alias: { '@shared': sharedDir },
    },
    server: {
      // /shared est hors du dossier marketing : on autorise Vite à le servir en dev
      fs: { allow: [repoRoot] },
    },
  },
});
