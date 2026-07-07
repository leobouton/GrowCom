/**
 * Seed démo juillet 2026 :
 * - 2 PISTES (deals OPEN avec probabilité) par commercial ;
 * - 1 VENTE gagnée en juillet par commercial, dont la commission reste en
 *   attente de validation manager (PENDING, cohérent avec la décision D1.2 :
 *   seul le mois en cours n'est pas validé).
 *
 * Re-exécutable sans doublon : upsert par (tenantId, odooId).
 * Usage : npx tsx scripts/seed-july-pipeline.ts
 */
import { prisma } from '../src/config/prisma';
import { commissionService } from '../src/services/commission.service';

const TENANT = 'cmo0g40z300018hp0rknkca32';

const PISTES = [
  { title: '[DEMO] Piste - Recrutement Développeur Java - CDI', client: 'FinanceHub', amount: 8500, probability: 60, dealType: 'Recrutement' },
  { title: '[DEMO] Piste - Formation Docker (3j)', client: 'LogiTrans', amount: 7200, probability: 40, dealType: 'Formation' },
  { title: '[DEMO] Piste - Recrutement Data Analyst - CDI', client: 'RetailNext', amount: 7800, probability: 50, dealType: 'Recrutement' },
  { title: '[DEMO] Piste - Formation Sécurité Web (2j)', client: 'MediSoft', amount: 5400, probability: 70, dealType: 'Formation' },
  { title: '[DEMO] Piste - Recrutement Chef de projet IT - CDI', client: 'BTP Solutions', amount: 9800, probability: 45, dealType: 'Recrutement' },
  { title: '[DEMO] Piste - Formation Agile Scrum (4j)', client: 'AssurOne', amount: 8800, probability: 55, dealType: 'Formation' },
  { title: '[DEMO] Piste - Recrutement Ingénieur Systèmes - CDI', client: 'IndusTech', amount: 8200, probability: 65, dealType: 'Recrutement' },
];

const VENTES_JUILLET = [
  { title: '[DEMO] Recrutement Développeur Mobile - CDI (juillet)', client: 'AppFactory', amount: 8000 },
  { title: '[DEMO] Recrutement Ingénieur IA - CDI (juillet)', client: 'SmartVision', amount: 11000 },
  { title: '[DEMO] Recrutement Administrateur Réseaux - CDI (juillet)', client: 'NetSecure', amount: 7000 },
  { title: '[DEMO] Recrutement Product Owner - CDI (juillet)', client: 'DigitalWave', amount: 9000 },
  { title: '[DEMO] Recrutement Développeur Frontend - CDI (juillet)', client: 'PixelStudio', amount: 6500 },
  { title: '[DEMO] Recrutement Consultant ERP - CDI (juillet)', client: 'GestionPro', amount: 10500 },
  { title: '[DEMO] Recrutement Technicien Support N2 - CDI (juillet)', client: 'HelpDesk+', amount: 5500 },
];

async function upsertDeal(odooId: string, data: {
  title: string; clientName: string; amount: number; marginAmount: number | null;
  userId: string; status: 'OPEN' | 'WON'; probability: number; closedAt: Date | null; dealType: string;
}) {
  return prisma.deal.upsert({
    where: { tenantId_odooId: { tenantId: TENANT, odooId } },
    create: {
      tenantId: TENANT,
      odooId,
      source: 'ODOO',
      title: data.title,
      clientName: data.clientName,
      amount: data.amount,
      marginAmount: data.marginAmount,
      marginSource: data.marginAmount !== null ? 'ODOO' : null,
      status: data.status,
      probability: data.probability,
      assignedToId: data.userId,
      closedAt: data.closedAt,
      dealType: data.dealType,
    },
    update: {
      title: data.title,
      amount: data.amount,
      marginAmount: data.marginAmount,
      status: data.status,
      probability: data.probability,
      assignedToId: data.userId,
      closedAt: data.closedAt,
      dealType: data.dealType,
    },
  });
}

async function main() {
  const commerciaux = await prisma.user.findMany({
    where: {
      tenantId: TENANT,
      isActive: true,
      role: { in: ['COMMERCIAL', 'RECRUITER', 'TEAM_LEAD'] },
    },
    select: { id: true, firstName: true, lastName: true },
    orderBy: { createdAt: 'asc' },
  });
  console.log(`${commerciaux.length} commerciaux ciblés\n`);

  let pistes = 0;
  let ventes = 0;

  for (let i = 0; i < commerciaux.length; i++) {
    const user = commerciaux[i];
    const key = user.id.slice(-6);

    // ── 2 pistes OPEN par commercial (offset pour varier les combinaisons) ──
    for (let n = 0; n < 2; n++) {
      const piste = PISTES[(i + n * 3) % PISTES.length];
      await upsertDeal(`demo-july-piste-${key}-${n + 1}`, {
        title: piste.title,
        clientName: piste.client,
        amount: piste.amount,
        marginAmount: null,
        userId: user.id,
        status: 'OPEN',
        probability: piste.probability,
        closedAt: null,
        dealType: piste.dealType,
      });
      pistes++;
    }

    // ── 1 vente gagnée en juillet, commission en attente de validation ──
    const vente = VENTES_JUILLET[i % VENTES_JUILLET.length];
    const closedAt = new Date(2026, 6, 1 + (i % 3), 10, 30); // 1er, 2 ou 3 juillet
    const deal = await upsertDeal(`demo-july-won-${key}`, {
      title: vente.title,
      clientName: vente.client,
      amount: vente.amount,
      marginAmount: vente.amount, // recrutement : marge = montant (pas de coût d'achat)
      userId: user.id,
      status: 'WON',
      probability: 100,
      closedAt,
      dealType: 'Recrutement',
    });
    await commissionService.recalculateForDeal(deal.id, TENANT);
    ventes++;
    console.log(`  ${user.firstName} ${user.lastName} : 2 pistes + vente "${vente.title}" (${vente.amount}€, ${closedAt.toISOString().slice(0, 10)})`);
  }

  console.log(`\nTerminé : ${pistes} pistes OPEN + ${ventes} ventes WON de juillet (commissions en attente de validation).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => void prisma.$disconnect());
