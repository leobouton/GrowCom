/**
 * Génère les images de partage (Open Graph, 1200 × 630) et le logo carré (schema.org) :
 *   public/og/*.png, public/logo-growcom.png
 * Chaque image est une page HTML aux couleurs du site, photographiée par Chrome.
 *
 * Lancer : cd marketing && npm run generate:og   (Chrome doit être installé ; CHROME_PATH pour un autre chemin)
 * Les montants affichés viennent du moteur partagé.
 */
import puppeteer from 'puppeteer-core';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCommission, tiersFromThresholds } from '../../shared/commission-engine/index';
import { CommissionRuleType } from '../../shared/types/index';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const font = (pkg: string, file: string) =>
  `data:font/woff2;base64,${readFileSync(resolve(root, 'node_modules/@fontsource-variable', pkg, 'files', file)).toString('base64')}`;

const FONTS = `
@font-face { font-family: 'Fraunces'; font-weight: 100 900; src: url(${font('fraunces', 'fraunces-latin-wght-normal.woff2')}) format('woff2'); }
@font-face { font-family: 'Fraunces'; font-style: italic; font-weight: 100 900; src: url(${font('fraunces', 'fraunces-latin-wght-italic.woff2')}) format('woff2'); }
@font-face { font-family: 'Inter'; font-weight: 100 900; src: url(${font('inter', 'inter-latin-wght-normal.woff2')}) format('woff2'); }
`;

const eur = (value: number, digits = 0) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

// Exemple de référence du site (même grille, même vente)
const example = computeCommission({
  config: {
    type: CommissionRuleType.TIERED,
    description: '',
    examples: [],
    tiers: tiersFromThresholds([
      { from: 0, rate: 0.3 },
      { from: 40000, rate: 0.35 },
      { from: 60000, rate: 0.4 },
    ]),
  },
  basisAmount: 11875,
  priorBasisAmount: 36500,
});
const progress = example.tierProgress!;

const LOGO_SVG = `<svg viewBox="0 0 44 34" width="46" height="36"><path d="M3 31c7.5 0 10.5-4.2 13.4-11.3C19.3 12.6 22.6 6.6 31 6.2" fill="none" stroke="#17161c" stroke-width="3.4" stroke-linecap="round"/><circle cx="35.2" cy="6.4" r="4.3" fill="#c8e45c" stroke="#17161c" stroke-width="2.4"/></svg>`;

const slip = `
<div class="slip">
  <div class="slip-label">Bordereau de commission</div>
  <div class="slip-row"><span>Honoraires HT</span><b>${eur(11875)}</b></div>
  ${example.lines
    .map((line) => `<div class="slip-row muted"><span>Palier ${Math.round((line.rate ?? 0) * 100)} %</span><b>${eur(line.amount, 2)}</b></div>`)
    .join('')}
  <div class="slip-total"><span>Commission</span><b>${eur(example.totalAmount, 2)}</b></div>
  <div class="slip-next">Encore ${eur(progress.remainingToNextTier ?? 0)} pour passer à ${Math.round((progress.nextTier?.rate ?? 0) * 100)} %
    <div class="bar"><i style="width:${Math.round(progress.progressToNextTier * 100)}%"></i></div>
  </div>
</div>`;

interface Card {
  file: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  aside?: string;
}

const CARDS: Card[] = [
  {
    file: 'og/accueil.png',
    eyebrow: 'Pour les agences immobilières',
    title: 'Des commissions claires, <em>palier par palier.</em>',
    subtitle: 'Le calcul automatique de la rémunération de vos négociateurs.',
    aside: slip,
  },
  {
    file: 'og/simulateur.png',
    eyebrow: 'Simulateur gratuit',
    title: 'Calculez la commission <em>d’un négociateur immobilier.</em>',
    subtitle: 'Paliers, partage mandat / vente, projection annuelle. Sans inscription.',
    aside: slip,
  },
  {
    file: 'og/modele.png',
    eyebrow: 'Modèle gratuit',
    title: 'Le modèle de <em>grille de commissionnement.</em>',
    subtitle: 'Un calculateur Excel des paliers et une grille PDF à annexer au contrat.',
    aside: `<div class="doc"><div class="doc-head"></div>${'<div class="doc-line"></div>'.repeat(3)}<div class="doc-table">${'<i></i>'.repeat(9)}</div>${'<div class="doc-line short"></div>'.repeat(2)}<div class="doc-badge">XLSX · PDF</div></div>`,
  },
  {
    file: 'og/blog.png',
    eyebrow: 'Blog GrowCom',
    title: 'Rémunération des négociateurs : <em>les bons calculs.</em>',
    subtitle: 'Grilles, paliers, partage des ventes : des articles concrets et chiffrés.',
  },
  {
    file: 'og/blog-paliers-marginaux-ou-taux-atteint.png',
    eyebrow: 'Blog GrowCom',
    title: 'Paliers par tranche ou taux atteint : <em>quelle différence ?</em>',
    subtitle: 'Même grille, même vente, trois modes de calcul : 2 000 € d’écart dans notre exemple.',
  },
];

const BASE_CSS = `
${FONTS}
* { box-sizing: border-box; margin: 0; }
body { width: 1200px; height: 630px; overflow: hidden; background: #f7f4ee; color: #17161c; font-family: Inter, sans-serif; position: relative; }
.glow { position: absolute; right: -140px; top: -160px; width: 560px; height: 560px; border-radius: 50%; background: rgba(200,228,92,.42); filter: blur(70px); }
.curve { position: absolute; inset: 0; }
.content { position: absolute; left: 72px; top: 64px; bottom: 60px; width: 640px; display: flex; flex-direction: column; }
.content.wide { width: 1000px; }
.logo { display: flex; align-items: center; gap: 12px; font-family: Fraunces, serif; font-size: 34px; font-weight: 460; }
.eyebrow { margin-top: 56px; display: flex; align-items: center; gap: 12px; font-size: 18px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: #625f6b; }
.eyebrow::before { content: ''; width: 12px; height: 12px; border-radius: 50%; background: #c8e45c; box-shadow: 0 0 0 2px #17161c; }
h1 { margin-top: 22px; font-family: Fraunces, serif; font-weight: 440; font-size: 62px; line-height: 1.04; letter-spacing: -.022em; }
.wide h1 { font-size: 70px; }
h1 em { font-style: italic; font-weight: 380; background: linear-gradient(transparent 62%, #c8e45c 62%, #c8e45c 92%, transparent 92%); }
p { margin-top: 24px; font-size: 25px; line-height: 1.4; color: #3b3a44; max-width: 600px; }
.wide p { max-width: 900px; }
.url { margin-top: auto; font-size: 20px; font-weight: 600; color: #17161c; }
.aside { position: absolute; right: 72px; top: 92px; width: 380px; }
.slip { background: #fffdf9; border: 1px solid #e0d8c9; border-radius: 26px; padding: 28px 30px; transform: rotate(-2deg); box-shadow: 0 30px 60px -24px rgba(23,22,28,.28), 0 10px 20px -10px rgba(23,22,28,.12); }
.slip-label { font-size: 13px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: #625f6b; }
.slip-row { margin-top: 14px; display: flex; justify-content: space-between; font-size: 19px; color: #3b3a44; font-variant-numeric: tabular-nums; }
.slip-row b { color: #17161c; font-weight: 600; }
.slip-row.muted { font-size: 17px; }
.slip-total { margin-top: 18px; padding-top: 14px; border-top: 2.5px solid #17161c; display: flex; justify-content: space-between; align-items: baseline; font-weight: 600; font-size: 18px; }
.slip-total b { font-family: Fraunces, serif; font-weight: 520; font-size: 40px; letter-spacing: -.02em; }
.slip-next { margin-top: 18px; border-radius: 16px; background: #eef6cf; padding: 14px 16px; font-size: 15px; color: #17161c; }
.bar { position: relative; margin-top: 10px; height: 9px; border-radius: 9px; background: #dfe6c4; }
.bar i { position: absolute; left: 0; top: 0; bottom: 0; border-radius: 9px; background: #17161c; }
.bar i::after { content: ''; position: absolute; right: -7px; top: -4px; width: 13px; height: 13px; border-radius: 50%; background: #c8e45c; border: 2.5px solid #17161c; }
.doc { background: #fffdf9; border: 1px solid #e0d8c9; border-radius: 22px; padding: 30px; transform: rotate(2deg); box-shadow: 0 30px 60px -24px rgba(23,22,28,.28); position: relative; height: 430px; }
.doc-head { width: 60%; height: 22px; border-radius: 6px; background: #17161c; }
.doc-line { margin-top: 16px; height: 10px; border-radius: 5px; background: #e0d8c9; }
.doc-line.short { width: 70%; }
.doc-table { margin-top: 24px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
.doc-table i { height: 30px; border-radius: 6px; background: #eef6cf; border: 1px solid #b9cf6a; }
.doc-badge { position: absolute; right: 24px; bottom: 24px; padding: 8px 14px; border-radius: 999px; background: #17161c; color: #f7f4ee; font-size: 15px; font-weight: 600; letter-spacing: .06em; }
`;

function cardHtml(card: Card): string {
  const curve = `<svg class="curve" viewBox="0 0 1200 630" preserveAspectRatio="none"><path d="M-40 600C250 600 360 520 480 340S700 70 1010 60" fill="none" stroke="#17161c" stroke-opacity=".07" stroke-width="3"/></svg>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body>
  <div class="glow"></div>${curve}
  <div class="content${card.aside ? '' : ' wide'}">
    <div class="logo">${LOGO_SVG}GrowCom</div>
    <div class="eyebrow">${card.eyebrow}</div>
    <h1>${card.title}</h1>
    <p>${card.subtitle}</p>
    <div class="url">growcom.fr</div>
  </div>
  ${card.aside ? `<div class="aside">${card.aside}</div>` : ''}
</body></html>`;
}

const LOGO_HTML = `<!doctype html><html><head><meta charset="utf-8"><style>${FONTS}
* { margin: 0; } body { width: 512px; height: 512px; background: #f7f4ee; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px; }
span { font-family: Fraunces, serif; font-size: 86px; font-weight: 460; color: #17161c; letter-spacing: -.01em; }
</style></head><body>${LOGO_SVG.replace('width="46" height="36"', 'width="210" height="162"')}<span>GrowCom</span></body></html>`;

async function main() {
  mkdirSync(resolve(root, 'public/og'), { recursive: true });
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
    for (const card of CARDS) {
      await page.setContent(cardHtml(card), { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      const path = resolve(root, 'public', card.file);
      await page.screenshot({ path: path as `${string}.png`, type: 'png' });
      console.log(`✓ public/${card.file}`);
    }
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
    await page.setContent(LOGO_HTML, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: resolve(root, 'public/logo-growcom.png') as `${string}.png`, type: 'png' });
    console.log('✓ public/logo-growcom.png');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
