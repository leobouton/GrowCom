/**
 * PDF du calcul, généré dans le navigateur à partir du résultat du moteur partagé.
 * jsPDF n'est chargé qu'au moment du téléchargement : rien ne pèse sur le chargement de la page.
 */
import type { AgencySaleSimulationResult, CalculationLine, CommissionTier } from '@shared/commission-engine';
import type { SimulatorState } from '../../simulator/state';
import { formatEur, formatEurSmart, formatPercent } from '../format';
import {
  COLORS,
  PAGE,
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
} from './pdf-kit';

const eur2 = (value: number) => formatEur(value, 2);
const TIER_MODE_LABELS = {
  tranche: 'par tranche (chaque tranche à son taux)',
  atteint: 'au taux atteint, sans effet rétroactif',
  retro: 'au taux atteint, avec effet rétroactif',
} as const;

function tierRange(tier?: CommissionTier): string {
  if (!tier) return '';
  return tier.max === null ? `au-delà de ${formatEur(tier.min)}` : `de ${formatEur(tier.min)} à ${formatEur(tier.max)}`;
}

function describeLine(line: CalculationLine): [string, string] {
  switch (line.kind) {
    case 'TIER':
      return [`Palier ${formatPercent(line.rate ?? 0)} (${tierRange(line.tier)})`, `${formatEurSmart(line.base ?? 0)} x ${formatPercent(line.rate ?? 0)}`];
    case 'RETROACTIVE_CATCH_UP':
      return ['Rattrapage rétroactif sur le CA déjà réalisé', `${formatEurSmart(line.base ?? 0)} x ${formatPercent(line.rate ?? 0)}`];
    case 'PERCENTAGE':
      return [`${formatPercent(line.rate ?? 0)} des honoraires HT`, `${formatEurSmart(line.base ?? 0)} x ${formatPercent(line.rate ?? 0)}`];
    default:
      return ['Forfait par vente', ''];
  }
}

export async function downloadSimulationPdf(state: SimulatorState, result: AgencySaleSimulationResult, link: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const label = 'Simulation de commission';
  const today = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const salaried = state.status === 'salarie';
  const multi = result.participants.length > 1;
  const hasDeductions = result.deductions.length > 0;
  doc.setProperties({ title: 'Simulation de commission', author: 'GrowCom', creator: 'growcom.fr' });

  let y = drawHeader(doc, `${label} · ${today}`);

  // Montant principal
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  ink(doc, COLORS.muted);
  doc.text(pdfText(multi ? 'Commission des intervenants' : 'Commission du négociateur'), PAGE.margin, y);
  doc.setFont('times', 'normal');
  doc.setFontSize(30);
  ink(doc, COLORS.ink);
  doc.text(pdfText(formatEurSmart(hasDeductions ? result.netCommission : result.commission.totalAmount)), PAGE.margin, y + 12);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  ink(doc, COLORS.muted);
  const nature = salaried ? 'brut, avant cotisations salariales' : 'HT, à facturer à l’agence, avant cotisations et impôt';
  doc.text(pdfText(`${hasDeductions ? 'Net de retenues, ' : ''}${nature}`), PAGE.margin, y + 18);
  y += 28;

  // La vente
  y = sectionTitle(doc, y, 'La vente');
  y = leaderRow(doc, y + 1, 'Prix de vente', formatEur(state.price));
  y = leaderRow(doc, y, 'Honoraires TTC', eur2(result.fees.inclTax));
  y = leaderRow(doc, y, 'Honoraires HT (base de la commission)', eur2(result.fees.exclTax), { bold: true });
  y = leaderRow(doc, y, 'Statut du négociateur', salaried ? 'Salarié (VRP)' : 'Agent commercial / mandataire');
  if (state.rem === 'pal') y = leaderRow(doc, y, 'Honoraires HT déjà réalisés dans l’année', formatEur(state.prior));
  y += 4;

  // La règle
  y = sectionTitle(doc, y, 'La règle de rémunération');
  if (state.rem === 'pct') y = paragraph(doc, y + 1, `${formatPercent(state.rate / 100)} des honoraires HT.`);
  if (state.rem === 'fix') y = paragraph(doc, y + 1, `Forfait de ${formatEurSmart(state.fixed)} par vente.`);
  if (state.rem === 'pal') {
    y = paragraph(doc, y + 1, `Paliers sur les honoraires HT cumulés dans l'année, calculés ${TIER_MODE_LABELS[state.tierMode]} :`);
    for (const tier of result.config.tiers ?? []) {
      y = leaderRow(doc, y + 0.5, `  ${tierRange(tier).replace(/^./, (c) => c.toUpperCase())}`, formatPercent(tier.rate));
    }
  }
  y += 4;

  // Le détail
  y = ensureSpace(doc, y, 50, label);
  y = sectionTitle(doc, y, 'Détail du calcul');
  y += 1;
  if (result.commission.lines.length === 0) y = paragraph(doc, y, 'Aucun palier atteint avec cette vente.');
  for (const line of result.commission.lines) {
    const [title, formula] = describeLine(line);
    y = leaderRow(doc, y, title, eur2(line.amount));
    if (formula) y = paragraph(doc, y - 2, formula, { size: 8, color: COLORS.muted });
    y += 0.5;
  }
  stroke(doc, COLORS.ink);
  doc.setLineWidth(0.6);
  doc.line(PAGE.margin, y - 1, PAGE.width - PAGE.margin, y - 1);
  y = leaderRow(doc, y + 4, salaried ? 'Commission brute' : 'Commission HT', eur2(result.commission.totalAmount), { bold: true });
  for (const deduction of result.deductions) {
    const suffix = deduction.mode === 'PERCENT_OF_COMMISSION' ? ` (${formatPercent(deduction.value)})` : '';
    y = leaderRow(doc, y, `${deduction.label}${suffix}`, `- ${eur2(deduction.amount)}`);
  }
  if (hasDeductions) y = leaderRow(doc, y, 'Commission nette de retenues', eur2(result.netCommission), { bold: true });
  y = leaderRow(doc, y, 'Reste à l’agence (HT)', eur2(result.agencyShare));
  y += 3;

  if (multi) {
    y = ensureSpace(doc, y, 30, label);
    y = sectionTitle(doc, y, 'Répartition entre les intervenants');
    for (const participant of result.participants) {
      y = leaderRow(doc, y + 0.5, `${participant.label ?? participant.id} (${formatPercent(participant.share)})`, eur2(hasDeductions ? participant.net : participant.gross));
    }
    y += 3;
  }

  // Prochain palier
  const progress = result.commission.tierProgress;
  if (progress) {
    y = ensureSpace(doc, y, 26, label);
    fill(doc, COLORS.limeSoft);
    doc.roundedRect(PAGE.margin, y, PAGE.width - 2 * PAGE.margin, 20, 3, 3, 'F');
    const sentence =
      progress.nextTier && progress.remainingToNextTier !== null
        ? `Encore ${formatEur(progress.remainingToNextTier)} d'honoraires pour passer à ${formatPercent(progress.nextTier.rate)}.`
        : `Dernier palier atteint (${formatPercent(progress.currentTier?.rate ?? 0)}).`;
    paragraph(doc, y + 7, sentence, { color: COLORS.ink, x: PAGE.margin + 5, width: PAGE.width - 2 * PAGE.margin - 10 });
    const barX = PAGE.margin + 5;
    const barWidth = PAGE.width - 2 * PAGE.margin - 10;
    fill(doc, [223, 230, 196]);
    doc.roundedRect(barX, y + 12.5, barWidth, 2.4, 1.2, 1.2, 'F');
    fill(doc, COLORS.ink);
    doc.roundedRect(barX, y + 12.5, Math.max(3, barWidth * progress.progressToNextTier), 2.4, 1.2, 1.2, 'F');
    y += 27;
  }

  // Projection
  y = ensureSpace(doc, y, 40, label);
  y = sectionTitle(doc, y, `Projection : ${state.salesPerYear} vente${state.salesPerYear > 1 ? 's' : ''} comparables sur une année`);
  const projection = result.projection;
  y = leaderRow(doc, y + 1, 'Honoraires HT sur l’année', formatEur(projection.totalFeesExclTax));
  y = leaderRow(doc, y, `Rémunération ${salaried ? 'brute' : 'HT'} sur l'année${multi ? ' (tous intervenants)' : ''}`, formatEur(projection.grossCommission), { bold: true });
  if (hasDeductions) y = leaderRow(doc, y, 'Après retenues', formatEur(projection.netCommission));
  y = leaderRow(doc, y, 'Part moyenne des honoraires reversée', formatPercent(Math.round(projection.effectiveRate * 1000) / 1000));
  y += 5;

  // Lien vers la simulation
  y = ensureSpace(doc, y, 20, label);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  ink(doc, COLORS.inkSoft);
  doc.text(pdfText('Retrouver et modifier cette simulation en ligne :'), PAGE.margin, y);
  ink(doc, COLORS.primary);
  doc.textWithLink(pdfText('growcom.fr/simulateur-commission-negociateur-immobilier'), PAGE.margin, y + 5, { url: link });

  drawFooters(
    doc,
    'Calcul indicatif établi avec le simulateur gratuit GrowCom (growcom.fr), à partir des paramètres saisis. Il ne constitue ni un conseil juridique ni un bulletin de paie.',
  );
  doc.save('simulation-commission-growcom.pdf');
}
