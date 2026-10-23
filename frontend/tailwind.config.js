import { readFileSync } from 'node:fs';

/*
 * Charte graphique : lue dans shared/brand/theme.css, le même fichier que le site.
 * Les noms du site sont disponibles tels quels (bg-paper, text-ink, bg-lime, font-display…).
 */
const brandCss = readFileSync(new URL('../shared/brand/theme.css', import.meta.url), 'utf8');
const brand = Object.fromEntries(
  [...brandCss.matchAll(/^\s*--([\w-]+):\s*([^;]+);/gm)].map(([, name, value]) => [name, value.trim()]),
);
const token = (name) => {
  if (!brand[name]) throw new Error(`Charte graphique : « --${name} » absent de shared/brand/theme.css`);
  return brand[name];
};

/** Mélange deux couleurs #rrggbb (part = poids de la seconde). */
function mix(a, b, part = 0.5) {
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [ca, cb] = [channels(a), channels(b)];
  return `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * part).toString(16).padStart(2, '0')).join('')}`;
}

const brandColors = {};
const primary = {};
for (const [name, value] of Object.entries(brand)) {
  if (!name.startsWith('color-')) continue;
  const color = name.slice('color-'.length);
  if (color.startsWith('primary-')) primary[color.slice('primary-'.length)] = value;
  else brandColors[color] = value;
}

/*
 * Neutres : l'échelle « gray » de Tailwind est remplacée par les teintes du site,
 * pour que toute l'app (bg-gray-50, border-gray-200, text-gray-900…) suive la charte.
 * Clairs = papier et filets beiges ; foncés = encres légèrement violacées.
 */
const gray = {
  50: token('color-paper'),
  100: token('color-paper-deep'),
  200: token('color-line'),
  300: token('color-line-strong'),
  400: mix(token('color-line-strong'), token('color-muted')),
  500: token('color-muted'),
  600: mix(token('color-muted'), token('color-ink-soft')),
  700: token('color-ink-soft'),
  800: mix(token('color-ink-soft'), token('color-ink')),
  900: token('color-ink'),
  950: mix(token('color-ink'), '#000000', 0.4),
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ...brandColors,
        primary,
        gray,
      },
      fontFamily: {
        sans: token('font-sans'),
        display: token('font-display'),
      },
      /*
       * Arrondis du site : champs à 12 px (lg), cartes à ~18 px (xl), fenêtres à ~22 px (2xl).
       * Les boutons sont en pilule (rounded-full).
       */
      borderRadius: {
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1.1rem',
        '2xl': '1.4rem',
        '3xl': '1.8rem',
      },
      boxShadow: {
        card: token('shadow-card'),
        'card-hover': '0 1px 2px rgb(23 22 28 / 0.06), 0 14px 32px -12px rgb(23 22 28 / 0.18)',
        slip: token('shadow-slip'),
      },
      ringOffsetColor: {
        DEFAULT: token('color-card'),
      },
    },
  },
  plugins: [],
};
