// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
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
  integrations: [mdx()],
  markdown: {
    // Espaces insécables à la française dans les articles (nombres, €, %, : ; ? !, guillemets)
    remarkPlugins: [remarkFrenchTypography],
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
