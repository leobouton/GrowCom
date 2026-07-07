/**
 * Normalisation des statuts de commission (décision D1.2, juillet 2026) :
 * - Commissions rattachées à un mois AVANT juillet 2026 : PENDING -> VALIDATED
 *   (validatedAt = date de rattachement ; condition de paiement client levée).
 * - Commissions du mois en cours (juillet 2026 et après) : VALIDATED -> PENDING
 *   (repassent dans la file de validation du manager).
 * - PAID et CANCELLED ne sont jamais touchées.
 *
 * Date de rattachement : periodMonth pour les commissions de mission (récurrent),
 * sinon closedAt du deal, sinon calculatedAt.
 *
 * Usage : npx tsx scripts/normalize-commission-statuses.ts [--dry-run]
 */
import { prisma } from '../src/config/prisma';

const CUTOFF = new Date(2026, 6, 1); // 1er juillet 2026 (local)
const SENTINEL_1970 = new Date('1971-01-01T00:00:00Z'); // periodMonth sentinelle = 1970-01-01

const dryRun = process.argv.includes('--dry-run');

function attachDate(c: {
  periodMonth: Date;
  calculatedAt: Date;
  deal: { closedAt: Date | null } | null;
}): Date {
  // Commission de mission : periodMonth réel (> sentinelle 1970)
  if (c.periodMonth.getTime() > SENTINEL_1970.getTime()) return c.periodMonth;
  return c.deal?.closedAt ?? c.calculatedAt;
}

async function main() {
  const commissions = await prisma.commission.findMany({
    where: { status: { in: ['PENDING', 'VALIDATED'] } },
    select: {
      id: true,
      status: true,
      amount: true,
      periodMonth: true,
      calculatedAt: true,
      awaitingClientPayment: true,
      clientPaidAt: true,
      deal: { select: { title: true, closedAt: true } },
      user: { select: { firstName: true, lastName: true } },
    },
  });

  let toValidate = 0;
  let toPending = 0;

  for (const c of commissions) {
    const date = attachDate(c);
    const label = `${c.user.firstName} ${c.user.lastName} | ${c.deal?.title ?? '?'} | ${c.amount.toFixed(2)}€ | rattachée au ${date.toISOString().slice(0, 10)}`;

    if (date < CUTOFF && c.status === 'PENDING') {
      toValidate++;
      console.log(`  -> VALIDATED : ${label}`);
      if (!dryRun) {
        await prisma.commission.update({
          where: { id: c.id },
          data: {
            status: 'VALIDATED',
            validatedAt: date,
            // Lève la condition de paiement client pour les mois déjà clos
            ...(c.awaitingClientPayment && !c.clientPaidAt ? { clientPaidAt: date } : {}),
          },
        });
      }
    } else if (date >= CUTOFF && c.status === 'VALIDATED') {
      toPending++;
      console.log(`  -> PENDING   : ${label}`);
      if (!dryRun) {
        await prisma.commission.update({
          where: { id: c.id },
          data: { status: 'PENDING', validatedAt: null, paidAt: null },
        });
      }
    }
  }

  console.log(`\n${dryRun ? '[DRY-RUN] ' : ''}Terminé : ${toValidate} commission(s) passée(s) en VALIDATED (avant juillet), ${toPending} repassée(s) en PENDING (mois en cours).`);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => void prisma.$disconnect());
