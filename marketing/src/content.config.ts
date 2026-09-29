import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Articles du blog : un fichier .md ou .mdx par article dans src/content/blog/.
 * Le nom du fichier devient l'URL : paliers-marginaux.md → /blog/paliers-marginaux
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    /** Titre pour Google (balise <title>, ≈ 60 caractères) si le titre de l'article est plus long. */
    seoTitle: z.string().optional(),
    /** Image de partage (1200 × 630) dans public/og/ ; défaut : image générique du blog. */
    image: z.string().optional(),
    /** Meta description (≈ 150 caractères), aussi utilisée comme chapô. */
    description: z.string(),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    /** true = article non publié (ni listé, ni généré). */
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog };
