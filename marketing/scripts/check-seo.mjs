/**
 * Contrôle SEO du site construit (dist/client), lancé à chaque `npm run build`.
 * Bloque la construction si une page n'a pas de titre, de description, d'URL canonique,
 * d'image de partage existante, de données structurées valides, ou contient un lien interne cassé.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'dist/client');
const SITE = 'https://growcom.fr';

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '_astro' ? [] : htmlFiles(path);
    return name.endsWith('.html') ? [path] : [];
  });
}

/** Chemin d'URL → fichier servi (format « file » : /blog → blog.html). */
function fileForPath(pathname) {
  const clean = decodeURIComponent(pathname.split('#')[0].split('?')[0]).replace(/\/$/, '');
  if (clean === '') return join(root, 'index.html');
  const candidates = [join(root, clean), join(root, `${clean}.html`), join(root, clean, 'index.html')];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

const attr = (html, pattern) => html.match(pattern)?.[1]?.trim() ?? null;
const errors = [];
const warnings = [];
const titles = new Map();
const descriptions = new Map();

for (const file of htmlFiles(root)) {
  const page = `/${relative(root, file).replace(/\\/g, '/')}`;
  const html = readFileSync(file, 'utf8');
  const isNotFound = page === '/404.html';
  const fail = (message) => errors.push(`${page} : ${message}`);
  const warn = (message) => warnings.push(`${page} : ${message}`);

  if (!/<html lang="fr"/.test(html)) fail('attribut lang="fr" manquant');

  const title = attr(html, /<title>([^<]*)<\/title>/);
  if (!title) fail('balise <title> manquante');
  else {
    if (title.length > 65) warn(`titre long (${title.length} caractères) : Google risque de le couper`);
    if (titles.has(title)) fail(`titre identique à ${titles.get(title)}`);
    titles.set(title, page);
  }

  const description = attr(html, /<meta name="description" content="([^"]*)"/);
  if (!description) fail('meta description manquante');
  else {
    if (!isNotFound && (description.length < 70 || description.length > 170)) warn(`description de ${description.length} caractères (idéal : 110 à 160)`);
    if (descriptions.has(description)) fail(`description identique à ${descriptions.get(description)}`);
    descriptions.set(description, page);
  }

  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  if (h1Count !== 1) fail(`${h1Count} titres <h1> (il en faut exactement 1)`);

  if (!isNotFound) {
    const canonical = attr(html, /<link rel="canonical" href="([^"]*)"/);
    if (!canonical?.startsWith(SITE)) fail(`URL canonique absente ou hors ${SITE}`);
    else if (!fileForPath(new URL(canonical).pathname)) fail(`URL canonique vers une page inexistante : ${canonical}`);
  }

  const ogImage = attr(html, /<meta property="og:image" content="([^"]*)"/);
  if (!ogImage) fail('image de partage (og:image) manquante');
  else if (!fileForPath(new URL(ogImage).pathname)) fail(`image de partage introuvable : ${ogImage}`);

  for (const [, json] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const data = JSON.parse(json);
      if (data['@context'] !== 'https://schema.org') fail('données structurées sans @context schema.org');
    } catch (error) {
      fail(`données structurées illisibles (${error.message})`);
    }
  }

  // Liens internes : chaque lien doit mener à une page ou un fichier du site
  for (const [, href] of html.matchAll(/<a\s[^>]*href="([^"]+)"/g)) {
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    if (href.startsWith('/api/')) continue;
    if (!fileForPath(href)) fail(`lien interne cassé : ${href}`);
  }
}

const sitemap = join(root, 'sitemap-index.xml');
if (!existsSync(sitemap)) errors.push('sitemap-index.xml manquant');
if (!existsSync(join(root, 'robots.txt'))) errors.push('robots.txt manquant');

for (const warning of warnings) console.warn(`⚠ ${warning}`);
if (errors.length > 0) {
  for (const error of errors) console.error(`✗ ${error}`);
  console.error(`\nContrôle SEO : ${errors.length} erreur(s).`);
  process.exit(1);
}
console.log(`✓ Contrôle SEO : ${titles.size} pages vérifiées, aucun lien interne cassé.`);
