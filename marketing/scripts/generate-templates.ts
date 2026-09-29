/**
 * Génère le modèle de grille de commissionnement téléchargeable :
 *   public/modele/grille-de-commissionnement-growcom.xlsx  (calculateur Excel, formules réelles)
 *   public/modele/grille-de-commissionnement-growcom.pdf   (version imprimable à compléter)
 *
 * Lancer : cd marketing && npm run generate:templates
 * Les exemples chiffrés viennent du moteur partagé (aucun montant écrit à la main).
 * Vérification des formules Excel contre le moteur : scripts/verify-template.ps1
 */
import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeCommission, tiersFromThresholds, computeFees } from '../../shared/commission-engine/index';
import { CommissionRuleType, type TierMode } from '../../shared/types/index';
import {
  COLORS,
  PAGE,
  blankLine,
  checkbox,
  drawFooters,
  drawHeader,
  ensureSpace,
  fill,
  ink,
  leaderRow,
  paragraph,
  pdfText,
  sectionTitle,
  stroke,
} from '../src/lib/pdf/pdf-kit';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../public/modele');
const BASENAME = 'grille-de-commissionnement-growcom';

// ─── Exemple de référence (le même que sur le site) ──────────────────────────

const EXAMPLE_THRESHOLDS = [
  { from: 0, rate: 0.3 },
  { from: 40000, rate: 0.35 },
  { from: 60000, rate: 0.4 },
];
const EXAMPLE_TIERS = tiersFromThresholds(EXAMPLE_THRESHOLDS);
/** Ventes d'exemple (honoraires TTC) pré-remplies dans l'onglet « Ventes ». */
const EXAMPLE_SALES = [
  { date: new Date(Date.UTC(2026, 0, 23)), ref: 'Exemple - Maison, 4 pièces', feesInclTax: 18000 },
  { date: new Date(Date.UTC(2026, 2, 11)), ref: 'Exemple - Appartement T2', feesInclTax: 9600 },
  { date: new Date(Date.UTC(2026, 4, 6)), ref: 'Exemple - Appartement T3', feesInclTax: 14250 },
  { date: new Date(Date.UTC(2026, 5, 19)), ref: 'Exemple - Terrain', feesInclTax: 7200 },
];
const MODES: Array<{ key: TierMode; label: string }> = [
  { key: 'MARGINAL', label: 'Par tranche' },
  { key: 'REACHED', label: 'Au taux atteint' },
  { key: 'REACHED_RETROACTIVE', label: 'Au taux atteint rétroactif' },
];

const tieredConfig = (tierMode: TierMode) => ({
  type: CommissionRuleType.TIERED,
  description: '',
  examples: [],
  tiers: EXAMPLE_TIERS,
  tierMode,
});

/** Commissions attendues pour les ventes d'exemple, calculées par le moteur (cache Excel + contrôle). */
export function expectedSales(tierMode: TierMode, priorRevenue = 0) {
  let cumulative = priorRevenue;
  return EXAMPLE_SALES.map((sale) => {
    const fees = computeFees({ salePrice: 0, feesMode: 'AMOUNT', feesValue: sale.feesInclTax, feesTaxBasis: 'TTC' });
    const result = computeCommission({ config: tieredConfig(tierMode), basisAmount: fees.exclTax, priorBasisAmount: cumulative });
    const row = { exclTax: fees.exclTax, before: cumulative, after: cumulative + fees.exclTax, commission: result.totalAmount };
    cumulative += fees.exclTax;
    return row;
  });
}

// ─── Excel ───────────────────────────────────────────────────────────────────

const HEX = {
  ink: 'FF17161C',
  paper: 'FFF7F4EE',
  inputFill: 'FFEEF6CF',
  inputBorder: 'FFB9CF6A',
  line: 'FFE0D8C9',
  muted: 'FF625F6B',
  formula: 'FF3B3A44',
  white: 'FFFFFFFF',
};
const EUR = '#,##0.00 [$€-40C]';
const EUR0 = '#,##0 [$€-40C]';
const PCT = '0.0%';
const PCT_WHOLE = '0%';

const FIRST_ROW = 6;
const LAST_ROW = 105;
const TIER_FIRST = 15;
const TIER_LAST = 20;

type Cell = ExcelJS.Cell;

function styleInput(cell: Cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEX.inputFill } };
  cell.border = {
    top: { style: 'thin', color: { argb: HEX.inputBorder } },
    bottom: { style: 'thin', color: { argb: HEX.inputBorder } },
    left: { style: 'thin', color: { argb: HEX.inputBorder } },
    right: { style: 'thin', color: { argb: HEX.inputBorder } },
  };
  cell.font = { name: 'Arial', size: 10, color: { argb: HEX.ink } };
}

function styleHeader(cell: Cell) {
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEX.ink } };
  cell.font = { name: 'Arial', size: 9.5, bold: true, color: { argb: HEX.white } };
  cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
}

function styleFormula(cell: Cell) {
  cell.font = { name: 'Arial', size: 10, color: { argb: HEX.formula } };
  cell.border = { bottom: { style: 'hair', color: { argb: HEX.line } } };
}

function title(sheet: ExcelJS.Worksheet, text: string, subtitle: string) {
  sheet.getCell('A1').value = text;
  sheet.getCell('A1').font = { name: 'Georgia', size: 18, color: { argb: HEX.ink } };
  sheet.getRow(1).height = 30;
  sheet.getCell('A2').value = subtitle;
  sheet.getCell('A2').font = { name: 'Arial', size: 10, color: { argb: HEX.muted } };
}

/** Formules de paliers, en fonction d'une cellule de CA cumulé. */
const marginalTotal = (x: string) => `SUMPRODUCT((${x}>Seuils)*(${x}-Seuils)*Ecarts)`;
const reachedRate = (x: string) => `SUMPRODUCT((${x}>=Seuils)*Ecarts)`;

async function buildWorkbook(): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'GrowCom';
  workbook.company = 'GrowCom';
  workbook.title = 'Grille de commissionnement';
  workbook.calcProperties = { fullCalcOnLoad: true };

  // Onglets dans l'ordre d'affichage : mode d'emploi, grille, ventes
  const help = workbook.addWorksheet('Mode d’emploi', { views: [{ showGridLines: false }] });

  // ── Onglet « Grille » ──
  const grid = workbook.addWorksheet('Grille', { views: [{ showGridLines: false }], properties: { tabColor: { argb: HEX.ink } } });
  grid.columns = [{ width: 44 }, { width: 24 }, { width: 14 }, { width: 22 }, { width: 16 }];
  title(grid, 'Grille de commissionnement', 'Remplissez les cellules vertes. Le calcul se fait dans l’onglet « Ventes ».');

  const params: Array<[string, ExcelJS.CellValue, string | null, string[] | null]> = [
    ['Négociateur', 'Prénom Nom', null, null],
    ['Statut', 'Agent commercial / mandataire', null, ['Agent commercial / mandataire', 'Salarié (VRP)']],
    ['Période de référence', 'Année civile 2026', null, null],
    ['Honoraires saisis dans l’onglet « Ventes »', 'TTC', null, ['TTC', 'HT']],
    ['Taux de TVA', 0.2, PCT, null],
    ['Mode de calcul des paliers', 'Par tranche', null, MODES.map((m) => m.label)],
    ['CA HT déjà réalisé avant la première vente du tableau', 0, EUR0, null],
  ];
  params.forEach(([label, value, format, list], index) => {
    const row = 4 + index;
    grid.getCell(`A${row}`).value = label;
    grid.getCell(`A${row}`).font = { name: 'Arial', size: 10, color: { argb: HEX.ink } };
    const cell = grid.getCell(`B${row}`);
    cell.value = value;
    styleInput(cell);
    if (format) cell.numFmt = format;
    if (list) {
      cell.dataValidation = {
        type: 'list',
        allowBlank: false,
        formulae: [`"${list.join(',')}"`],
        showErrorMessage: true,
        errorTitle: 'Valeur non prévue',
        error: `Choisissez : ${list.join(' / ')}`,
      };
    }
  });
  // Cellules de paramètres nommées : les formules restent lisibles
  workbook.definedNames.add('Grille!$B$7', 'SaisieHonoraires');
  workbook.definedNames.add('Grille!$B$8', 'TauxTVA');
  workbook.definedNames.add('Grille!$B$9', 'ModePaliers');
  workbook.definedNames.add('Grille!$B$10', 'CAInitial');

  grid.getCell('A12').value = 'Paliers (CA HT cumulé sur la période)';
  grid.getCell('A12').font = { name: 'Georgia', size: 13, color: { argb: HEX.ink } };
  grid.getCell('A13').value = 'Un palier par ligne, du plus petit seuil au plus grand. Chaque palier s’arrête où commence le suivant.';
  grid.getCell('A13').font = { name: 'Arial', size: 9, italic: true, color: { argb: HEX.muted } };

  const tierHeaders = ['Palier', 'À partir de (CA HT)', 'Taux', 'Jusqu’à', 'Écart de taux*'];
  tierHeaders.forEach((header, i) => styleHeader(Object.assign(grid.getRow(14).getCell(i + 1), { value: header })));
  grid.getRow(14).height = 20;

  for (let row = TIER_FIRST; row <= TIER_LAST; row++) {
    const index = row - TIER_FIRST;
    const example = EXAMPLE_THRESHOLDS[index];
    grid.getCell(`A${row}`).value = `Palier ${index + 1}`;
    grid.getCell(`A${row}`).font = { name: 'Arial', size: 10, color: { argb: HEX.muted } };
    const from = grid.getCell(`B${row}`);
    from.value = example ? example.from : null;
    from.numFmt = EUR0;
    styleInput(from);
    const rate = grid.getCell(`C${row}`);
    rate.value = example ? example.rate : null;
    rate.numFmt = PCT;
    styleInput(rate);
    // Jusqu'à : seuil du palier suivant, ou « et au-delà »
    const until = grid.getCell(`D${row}`);
    const next = row < TIER_LAST ? `B${row + 1}` : null;
    until.value = {
      formula: next ? `IF(B${row}="","",IF(${next}="","et au-delà",${next}))` : `IF(B${row}="","","et au-delà")`,
      result: example ? (EXAMPLE_THRESHOLDS[index + 1]?.from ?? 'et au-delà') : '',
    };
    until.numFmt = EUR0;
    styleFormula(until);
    // Écart de taux avec le palier précédent : base du calcul par tranche
    const delta = grid.getCell(`E${row}`);
    const previousRate = example && index > 0 ? EXAMPLE_THRESHOLDS[index - 1].rate : 0;
    delta.value = {
      formula: row === TIER_FIRST ? `IF(B${row}="",0,C${row})` : `IF(B${row}="",0,C${row}-C${row - 1})`,
      result: example ? example.rate - previousRate : 0,
    };
    delta.numFmt = PCT;
    styleFormula(delta);
    delta.font = { name: 'Arial', size: 9, color: { argb: HEX.muted } };
  }
  workbook.definedNames.add(`Grille!$B$${TIER_FIRST}:$B$${TIER_LAST}`, 'Seuils');
  workbook.definedNames.add(`Grille!$E$${TIER_FIRST}:$E$${TIER_LAST}`, 'Ecarts');
  grid.getCell(`A${TIER_LAST + 2}`).value = '* Colonne de calcul, ne pas modifier.';
  grid.getCell(`A${TIER_LAST + 2}`).font = { name: 'Arial', size: 8.5, italic: true, color: { argb: HEX.muted } };

  // Seuils croissants : alerte si un seuil n'est pas supérieur au précédent
  for (let row = TIER_FIRST + 1; row <= TIER_LAST; row++) {
    grid.getCell(`B${row}`).dataValidation = {
      type: 'custom',
      allowBlank: true,
      formulae: [`OR(B${row}="",B${row}>B${row - 1})`],
      showErrorMessage: true,
      errorTitle: 'Seuil à vérifier',
      error: 'Chaque seuil doit être supérieur au précédent.',
    };
  }

  // ── Onglet « Ventes » ──
  const sales = workbook.addWorksheet('Ventes', {
    views: [{ state: 'frozen', ySplit: FIRST_ROW - 1, showGridLines: false }],
    properties: { tabColor: { argb: 'FFC8E45C' } },
  });
  sales.columns = [
    { width: 12 }, { width: 32 }, { width: 16 }, { width: 15 }, { width: 17 }, { width: 17 }, { width: 13 }, { width: 17 }, { width: 13 }, { width: 17 },
  ];
  title(sales, 'Ventes et commissions', 'Une ligne par vente, dans l’ordre chronologique. Dupliquez l’onglet pour chaque négociateur.');

  const range = (col: string) => `${col}${FIRST_ROW}:${col}${LAST_ROW}`;
  sales.getCell('A3').value = 'Totaux';
  sales.getCell('A3').font = { name: 'Arial', size: 10, bold: true, color: { argb: HEX.ink } };
  for (const col of ['D', 'H', 'J']) {
    const cell = sales.getCell(`${col}3`);
    cell.value = { formula: `SUM(${range(col)})` };
    cell.numFmt = EUR;
    cell.font = { name: 'Arial', size: 10, bold: true, color: { argb: HEX.ink } };
  }

  const headers = [
    'Date',
    'Bien / référence',
    'Honoraires saisis',
    'Honoraires HT',
    'CA HT cumulé avant',
    'CA HT cumulé après',
    'Taux atteint',
    'Commission de la vente',
    'Part du négociateur',
    'Commission à verser',
  ];
  headers.forEach((header, i) => styleHeader(Object.assign(sales.getRow(FIRST_ROW - 1).getCell(i + 1), { value: header })));
  sales.getRow(FIRST_ROW - 1).height = 30;

  const expected = expectedSales('MARGINAL');
  const reachedRates = expected.map((row) => EXAMPLE_TIERS.filter((t) => t.min <= row.after).pop()?.rate ?? 0);

  for (let row = FIRST_ROW; row <= LAST_ROW; row++) {
    const example = EXAMPLE_SALES[row - FIRST_ROW];
    const cached = expected[row - FIRST_ROW];
    const blank = `C${row}=""`;

    const date = sales.getCell(`A${row}`);
    date.value = example?.date ?? null;
    date.numFmt = 'dd/mm/yyyy';
    styleInput(date);
    const ref = sales.getCell(`B${row}`);
    ref.value = example?.ref ?? null;
    styleInput(ref);
    const feesCell = sales.getCell(`C${row}`);
    feesCell.value = example?.feesInclTax ?? null;
    feesCell.numFmt = EUR;
    styleInput(feesCell);

    const cells: Array<[string, string, string | number, string]> = [
      ['D', `IF(${blank},"",ROUND(C${row}/IF(SaisieHonoraires="TTC",1+TauxTVA,1),2))`, cached?.exclTax ?? '', EUR],
      ['E', `IF(${blank},"",CAInitial+SUM(D$${FIRST_ROW - 1}:D${row - 1}))`, cached?.before ?? '', EUR],
      ['F', `IF(${blank},"",E${row}+D${row})`, cached?.after ?? '', EUR],
      ['G', `IF(${blank},"",${reachedRate(`F${row}`)})`, cached ? reachedRates[row - FIRST_ROW] : '', PCT],
      [
        'H',
        `IF(${blank},"",CHOOSE(MATCH(ModePaliers,{"${MODES.map((m) => m.label).join('","')}"},0),` +
          `ROUND(${marginalTotal(`F${row}`)}-${marginalTotal(`E${row}`)},2),` +
          `ROUND(D${row}*${reachedRate(`F${row}`)},2),` +
          `ROUND(D${row}*${reachedRate(`F${row}`)},2)+ROUND(E${row}*(${reachedRate(`F${row}`)}-${reachedRate(`E${row}`)}),2)))`,
        cached?.commission ?? '',
        EUR,
      ],
      ['J', `IF(${blank},"",ROUND(H${row}*IF(I${row}="",1,I${row}),2))`, cached?.commission ?? '', EUR],
    ];
    for (const [col, formula, result, format] of cells) {
      const cell = sales.getCell(`${col}${row}`);
      cell.value = { formula, result };
      cell.numFmt = format;
      styleFormula(cell);
    }
    const share = sales.getCell(`I${row}`);
    share.value = example ? 1 : null;
    share.numFmt = PCT_WHOLE;
    styleInput(share);
    share.dataValidation = { type: 'decimal', operator: 'between', formulae: [0, 1], allowBlank: true, showErrorMessage: true, error: 'Une part entre 0 % et 100 %.' };
  }
  sales.getCell(`A${LAST_ROW + 2}`).value =
    'Colonnes grises : calculées automatiquement. « Part du négociateur » : 100 % s’il a réalisé la vente seul, sinon sa part (ex. 50 % pour un partage mandat / vente).';
  sales.getCell(`A${LAST_ROW + 2}`).font = { name: 'Arial', size: 9, italic: true, color: { argb: HEX.muted } };

  // ── Onglet « Mode d'emploi » ──
  help.columns = [{ width: 110 }];
  title(help, 'Mode d’emploi', 'Modèle proposé par GrowCom, à adapter à votre agence.');
  const lines: Array<[string, 'h' | 'p']> = [
    ['1. Renseignez la grille', 'h'],
    ['Dans l’onglet « Grille », indiquez vos paliers (seuil de CA HT et taux), le mode de calcul et si vos honoraires sont saisis TTC ou HT.', 'p'],
    ['2. Saisissez les ventes', 'h'],
    ['Dans l’onglet « Ventes », une ligne par vente, dans l’ordre chronologique. La commission se calcule toute seule, palier par palier.', 'p'],
    ['Les lignes « Exemple » peuvent être effacées (colonnes vertes uniquement).', 'p'],
    ['3. Les trois modes de calcul des paliers', 'h'],
    ['Par tranche : chaque tranche de CA est payée à son propre taux (comme le barème de l’impôt).', 'p'],
    ['Au taux atteint : toute la vente est payée au taux du palier atteint après cette vente, sans effet rétroactif.', 'p'],
    ['Au taux atteint rétroactif : en franchissant un palier, tout le CA de la période passe au nouveau taux ; la vente déclenche un rattrapage.', 'p'],
    ['4. Ce que votre grille doit préciser pour éviter les litiges', 'h'],
    ['La base de calcul (honoraires HT ou TTC, encaissés ou facturés), le mode de calcul des paliers, la période de référence et la remise à zéro,', 'p'],
    ['le partage des ventes à plusieurs, et le fait générateur (signature de l’acte ou encaissement des honoraires).', 'p'],
    ['Aller plus loin', 'h'],
    ['Simulateur gratuit : https://growcom.fr/simulateur-commission-negociateur-immobilier', 'p'],
    ['GrowCom automatise ce calcul pour toute votre équipe, avec le détail de chaque commission pour chaque négociateur : https://growcom.fr', 'p'],
    ['Document indicatif, à adapter à votre situation ; il ne constitue pas un conseil juridique.', 'p'],
  ];
  lines.forEach(([text, kind], index) => {
    const cell = help.getCell(`A${4 + index}`);
    cell.value = text;
    cell.font = kind === 'h' ? { name: 'Georgia', size: 12.5, color: { argb: HEX.ink } } : { name: 'Arial', size: 10, color: { argb: HEX.formula } };
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (kind === 'h') help.getRow(4 + index).height = 24;
  });

  // Ouverture du fichier sur l'onglet « Grille »
  workbook.views = [{ activeTab: 1, x: 0, y: 0, width: 20000, height: 12000, firstSheet: 0, visibility: 'visible' }];
  return workbook;
}

// ─── PDF imprimable ──────────────────────────────────────────────────────────

const eur = (value: number, digits = 0) =>
  new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);
const pct = (rate: number) => `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(rate * 100)} %`;

function buildPdf(): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const label = 'Modèle de grille de commissionnement';
  doc.setProperties({ title: 'Grille de commissionnement', author: 'GrowCom', subject: label, creator: 'growcom.fr' });

  let y = drawHeader(doc, label);
  doc.setFont('times', 'normal');
  doc.setFontSize(24);
  ink(doc, COLORS.ink);
  doc.text('Grille de commissionnement', PAGE.margin, y + 2);
  y = paragraph(doc, y + 10, 'Modèle à compléter et à annexer au contrat du négociateur. Chaque rubrique ferme la porte à une source fréquente de litige.', { color: COLORS.muted });
  y += 4;

  y = sectionTitle(doc, y, '1. Bénéficiaire');
  y = blankLine(doc, y + 2, 'Nom et prénom');
  let x = checkbox(doc, PAGE.margin, y, 'Salarié (VRP)');
  x = checkbox(doc, x, y, 'Agent commercial');
  checkbox(doc, x, y, 'Mandataire');
  y = blankLine(doc, y + 9, 'Date d’effet de la grille');
  y += 3;

  y = sectionTitle(doc, y, '2. Base de calcul');
  x = checkbox(doc, PAGE.margin, y + 2, 'Honoraires HT');
  checkbox(doc, x, y + 2, 'Honoraires TTC');
  x = checkbox(doc, PAGE.margin, y + 9, 'Honoraires encaissés');
  checkbox(doc, x, y + 9, 'Honoraires facturés');
  y = blankLine(doc, y + 17, 'Déductions avant calcul (rétrocession apporteur, etc.)');
  y += 3;

  y = sectionTitle(doc, y, '3. Paliers (chiffre d’affaires cumulé sur la période)');
  const cols = [PAGE.margin, PAGE.margin + 62, PAGE.margin + 124];
  const tableWidth = PAGE.width - 2 * PAGE.margin;
  fill(doc, COLORS.ink);
  doc.rect(PAGE.margin, y, tableWidth, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  ink(doc, [255, 255, 255]);
  ['À partir de (CA HT)', 'Jusqu’à', 'Taux reversé'].forEach((header, i) => doc.text(pdfText(header), cols[i] + 3, y + 4.7));
  y += 7;
  stroke(doc, COLORS.line);
  doc.setLineWidth(0.3);
  for (let i = 0; i < 5; i++) {
    doc.rect(PAGE.margin, y, tableWidth, 8.5);
    doc.line(cols[1], y, cols[1], y + 8.5);
    doc.line(cols[2], y, cols[2], y + 8.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    ink(doc, COLORS.muted);
    doc.text('€', cols[1] - 5, y + 5.6);
    doc.text('%', PAGE.width - PAGE.margin - 5, y + 5.6);
    y += 8.5;
  }
  y += 5;
  paragraph(doc, y, 'Mode de calcul des paliers :', { color: COLORS.ink });
  y += 7;
  checkbox(doc, PAGE.margin, y, 'Par tranche (chaque tranche à son taux)');
  y += 7;
  checkbox(doc, PAGE.margin, y, 'Au taux atteint, sans effet rétroactif');
  y += 7;
  checkbox(doc, PAGE.margin, y, 'Au taux atteint, avec effet rétroactif sur le CA de la période');
  y += 9;

  y = sectionTitle(doc, y, '4. Période de référence');
  x = checkbox(doc, PAGE.margin, y + 2, 'Année civile');
  checkbox(doc, x, y + 2, 'Date anniversaire du contrat');
  y = blankLine(doc, y + 10, 'En début de période, le CA cumulé repart de');
  y += 1;

  doc.addPage();
  y = drawHeader(doc, label);

  y = sectionTitle(doc, y, '5. Ventes réalisées à plusieurs');
  y = blankLine(doc, y + 2, 'Prise de mandat (%)', PAGE.margin, PAGE.margin + 80);
  y = blankLine(doc, y, 'Vente (%)', PAGE.margin, PAGE.margin + 80);
  y = blankLine(doc, y, 'Apporteur / autre (%)', PAGE.margin, PAGE.margin + 80);
  y = paragraph(doc, y - 2, 'Les paliers de chaque intervenant sont calculés sur sa part du chiffre d’affaires, ou sur le chiffre d’affaires total : à préciser ci-dessous.', { color: COLORS.muted, size: 8.5 });
  y = blankLine(doc, y + 3, 'Règle retenue');
  y += 3;

  y = sectionTitle(doc, y, '6. Fait générateur et paiement');
  x = checkbox(doc, PAGE.margin, y + 2, 'Signature de l’acte authentique');
  checkbox(doc, x, y + 2, 'Encaissement des honoraires');
  y = blankLine(doc, y + 10, 'Délai de paiement après le fait générateur');
  y = blankLine(doc, y, 'Avances et régularisation (vente annulée, etc.)');
  y += 3;

  y = sectionTitle(doc, y, '7. Retenues éventuelles');
  y = blankLine(doc, y + 2, 'Pack / abonnement');
  y = blankLine(doc, y, 'Redevance de réseau');
  y += 3;

  // Exemple chiffré calculé par le moteur partagé
  y = ensureSpace(doc, y, 70, label);
  y = sectionTitle(doc, y, 'Exemple chiffré : même grille, trois modes');
  y = paragraph(
    doc,
    y + 1,
    'Grille : 30 % jusqu’à 40 000 € de CA HT, 35 % jusqu’à 60 000 €, 40 % au-delà. Le négociateur a déjà réalisé 36 500 € et conclut une vente de 11 875 € HT d’honoraires.',
  );
  y += 2;
  for (const mode of [
    { key: 'MARGINAL' as const, label: 'Par tranche' },
    { key: 'REACHED' as const, label: 'Au taux atteint, sans rétroactivité' },
    { key: 'REACHED_RETROACTIVE' as const, label: 'Au taux atteint, avec rétroactivité' },
  ]) {
    const result = computeCommission({ config: tieredConfig(mode.key), basisAmount: 11875, priorBasisAmount: 36500 });
    const detail = result.lines
      .map((line) => `${eur(line.base ?? 0)} x ${pct(line.rate ?? 0)}${line.kind === 'RETROACTIVE_CATCH_UP' ? ' (rattrapage)' : ''}`)
      .join(' + ');
    y = leaderRow(doc, y, mode.label, eur(result.totalAmount, 2), { bold: true });
    y = paragraph(doc, y - 1.5, detail, { size: 8, color: COLORS.muted });
    y += 1.5;
  }
  y += 4;

  y = ensureSpace(doc, y, 40, label);
  y = sectionTitle(doc, y, 'Signatures');
  y += 4;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  ink(doc, COLORS.inkSoft);
  doc.text(pdfText('Fait à ____________________, le ____ / ____ / ________'), PAGE.margin, y);
  y += 8;
  const boxWidth = (PAGE.width - 2 * PAGE.margin - 8) / 2;
  stroke(doc, COLORS.lineStrong);
  ['Pour l’agence', 'Le négociateur'].forEach((who, i) => {
    const bx = PAGE.margin + i * (boxWidth + 8);
    doc.roundedRect(bx, y, boxWidth, 30, 2, 2);
    doc.setFontSize(8.5);
    ink(doc, COLORS.muted);
    doc.text(pdfText(who), bx + 4, y + 6);
  });

  drawFooters(
    doc,
    'Modèle proposé par GrowCom (growcom.fr), à adapter à votre situation. Il ne constitue pas un conseil juridique. Simulateur gratuit : growcom.fr/simulateur-commission-negociateur-immobilier',
  );
  return doc;
}

// ─── Écriture ────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(outDir, { recursive: true });
  const workbook = await buildWorkbook();
  const xlsxPath = resolve(outDir, `${BASENAME}.xlsx`);
  await workbook.xlsx.writeFile(xlsxPath);
  const pdfPath = resolve(outDir, `${BASENAME}.pdf`);
  writeFileSync(pdfPath, Buffer.from(buildPdf().output('arraybuffer')));
  // Valeurs attendues, pour la vérification des formules Excel (scripts/verify-template.ps1)
  const byMode = (prior: number) =>
    Object.fromEntries(MODES.map((mode) => [mode.label, expectedSales(mode.key, prior).map((row) => row.commission)]));
  const expectations = { scenarios: [0, 36500, 61000].map((prior) => ({ prior, commissions: byMode(prior) })) };
  writeFileSync(resolve(here, 'template-expectations.json'), `${JSON.stringify(expectations, null, 2)}\n`);
  console.log(`✓ ${xlsxPath}\n✓ ${pdfPath}`);
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
