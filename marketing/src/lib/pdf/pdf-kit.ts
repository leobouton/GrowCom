/**
 * Boîte à outils PDF commune (jsPDF) : identité GrowCom sobre pour le PDF du calcul
 * (généré dans le navigateur) et le modèle de grille (généré au build, dans Node).
 * Polices standard PDF (Helvetica, Times) : jeu de caractères Windows-1252,
 * d'où le nettoyage des caractères qu'elles ne savent pas afficher.
 */
import type { jsPDF } from 'jspdf';

export const PAGE = { width: 210, height: 297, margin: 18 } as const;

export const COLORS = {
  ink: [23, 22, 28],
  inkSoft: [59, 58, 68],
  muted: [98, 95, 107],
  line: [224, 216, 201],
  lineStrong: [207, 197, 178],
  paper: [247, 244, 238],
  paperDeep: [238, 232, 220],
  card: [255, 253, 249],
  lime: [200, 228, 92],
  limeSoft: [238, 246, 207],
  primary: [79, 70, 229],
} as const satisfies Record<string, readonly [number, number, number]>;

type Rgb = readonly [number, number, number];

/** Texte compatible avec les polices standard PDF (pas d'espace fine, pas de flèche). */
export function pdfText(value: string): string {
  return value
    .replace(/[   ]/g, ' ')
    .replace(/→/g, 'à')
    .replace(/[−]/g, '-')
    .replace(/[→⇒]/g, '->');
}

export const fill = (doc: jsPDF, color: Rgb) => doc.setFillColor(color[0], color[1], color[2]);
export const stroke = (doc: jsPDF, color: Rgb) => doc.setDrawColor(color[0], color[1], color[2]);
export const ink = (doc: jsPDF, color: Rgb) => doc.setTextColor(color[0], color[1], color[2]);

/** Le logo : courbe de croissance + point vert, puis « GrowCom » en caractères à empattements. */
export function drawLogo(doc: jsPDF, x: number, y: number, scale = 1): void {
  stroke(doc, COLORS.ink);
  doc.setLineWidth(0.75 * scale);
  doc.setLineCap('round');
  // Courbe en S (deux Bézier), du bas gauche vers le point en haut à droite
  doc.lines(
    [
      [3.2 * scale, 0, 4.6 * scale, -1.8 * scale, 5.8 * scale, -4.8 * scale],
      [1.2 * scale, -3 * scale, 2.7 * scale, -5.6 * scale, 6.3 * scale, -5.8 * scale],
    ],
    x,
    y,
  );
  fill(doc, COLORS.lime);
  doc.setLineWidth(0.5 * scale);
  doc.circle(x + 13.4 * scale, y - 10.5 * scale, 1.75 * scale, 'FD');
  doc.setFont('times', 'normal');
  doc.setFontSize(15 * scale);
  ink(doc, COLORS.ink);
  doc.text('GrowCom', x + 17.5 * scale, y - 5.2 * scale);
}

/** En-tête de page : logo à gauche, libellé du document à droite, filet. */
export function drawHeader(doc: jsPDF, label: string): number {
  drawLogo(doc, PAGE.margin, PAGE.margin + 11, 1);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  ink(doc, COLORS.muted);
  // Alignement à droite calculé à la main : jsPDF ne tient pas compte de l'espacement des lettres
  const text = pdfText(label.toUpperCase());
  const charSpace = 0.4;
  const width = doc.getTextWidth(text) + charSpace * (text.length - 1);
  doc.text(text, PAGE.width - PAGE.margin - width, PAGE.margin + 6.5, { charSpace });
  stroke(doc, COLORS.line);
  doc.setLineWidth(0.3);
  doc.line(PAGE.margin, PAGE.margin + 15, PAGE.width - PAGE.margin, PAGE.margin + 15);
  return PAGE.margin + 26;
}

/** Pied de page sur toutes les pages : mention + numéro. */
export function drawFooters(doc: jsPDF, note: string): void {
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    stroke(doc, COLORS.line);
    doc.setLineWidth(0.3);
    doc.line(PAGE.margin, PAGE.height - 16, PAGE.width - PAGE.margin, PAGE.height - 16);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    ink(doc, COLORS.muted);
    doc.text(doc.splitTextToSize(pdfText(note), PAGE.width - 2 * PAGE.margin - 20), PAGE.margin, PAGE.height - 11.5);
    doc.text(`${page} / ${pages}`, PAGE.width - PAGE.margin, PAGE.height - 11.5, { align: 'right' });
  }
}

/** Titre de section façon bordereau : petites capitales espacées + point vert. */
export function sectionTitle(doc: jsPDF, y: number, title: string): number {
  fill(doc, COLORS.lime);
  stroke(doc, COLORS.ink);
  doc.setLineWidth(0.3);
  doc.circle(PAGE.margin + 1.2, y - 1.1, 1.1, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  ink(doc, COLORS.ink);
  doc.text(pdfText(title.toUpperCase()), PAGE.margin + 4.5, y, { charSpace: 0.35 });
  return y + 6;
}

/** Ligne « libellé ........ valeur ». */
export function leaderRow(doc: jsPDF, y: number, label: string, value: string, options: { bold?: boolean; x1?: number; x2?: number } = {}): number {
  const x1 = options.x1 ?? PAGE.margin;
  const x2 = options.x2 ?? PAGE.width - PAGE.margin;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  ink(doc, COLORS.inkSoft);
  const labelText = pdfText(label);
  doc.text(labelText, x1, y);
  doc.setFont('helvetica', options.bold ? 'bold' : 'normal');
  ink(doc, COLORS.ink);
  const valueText = pdfText(value);
  doc.text(valueText, x2, y, { align: 'right' });
  const start = x1 + doc.getTextWidth(labelText) + 2;
  const end = x2 - doc.getTextWidth(valueText) - 2;
  if (end > start) {
    stroke(doc, COLORS.lineStrong);
    doc.setLineWidth(0.25);
    doc.setLineDashPattern([0.3, 1.2], 0);
    doc.line(start, y - 0.8, end, y - 0.8);
    doc.setLineDashPattern([], 0);
  }
  return y + 5.6;
}

/** Case à cocher dessinée (les polices standard n'ont pas le caractère ☐). */
export function checkbox(doc: jsPDF, x: number, y: number, label: string, checked = false): number {
  stroke(doc, COLORS.ink);
  doc.setLineWidth(0.3);
  doc.rect(x, y - 3, 3.2, 3.2);
  if (checked) {
    doc.setLineWidth(0.5);
    doc.lines([[0.9, 1], [1.6, -2.2]], x + 0.6, y - 1.4);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  ink(doc, COLORS.inkSoft);
  doc.text(pdfText(label), x + 5, y - 0.35);
  return x + 5 + doc.getTextWidth(pdfText(label)) + 7;
}

/** Ligne à compléter à la main : « Libellé : _______________ ». */
export function blankLine(doc: jsPDF, y: number, label: string, x1 = PAGE.margin, x2 = PAGE.width - PAGE.margin): number {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  ink(doc, COLORS.inkSoft);
  const text = pdfText(`${label} :`);
  doc.text(text, x1, y);
  stroke(doc, COLORS.lineStrong);
  doc.setLineWidth(0.3);
  doc.line(x1 + doc.getTextWidth(text) + 2, y + 0.6, x2, y + 0.6);
  return y + 8;
}

/** Paragraphe multi-lignes ; renvoie la position sous le texte. */
export function paragraph(doc: jsPDF, y: number, text: string, options: { size?: number; color?: Rgb; width?: number; x?: number } = {}): number {
  const size = options.size ?? 9.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(size);
  ink(doc, options.color ?? COLORS.inkSoft);
  const lines = doc.splitTextToSize(pdfText(text), options.width ?? PAGE.width - 2 * PAGE.margin);
  doc.text(lines, options.x ?? PAGE.margin, y, { lineHeightFactor: 1.45 });
  return y + lines.length * size * 0.3528 * 1.45 + 1.5;
}

/** Passe à la page suivante si la place manque. */
export function ensureSpace(doc: jsPDF, y: number, needed: number, headerLabel: string): number {
  if (y + needed <= PAGE.height - 22) return y;
  doc.addPage();
  return drawHeader(doc, headerLabel);
}
