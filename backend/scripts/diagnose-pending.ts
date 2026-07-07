/** Diagnostic : commissions PENDING dont le deal date d'avant juillet 2026. */
import { prisma } from '../src/config/prisma';

async function main() {
  const pending = await prisma.commission.findMany({
    where: { status: 'PENDING' },
    select: {
      id: true,
      amount: true,
      periodMonth: true,
      calculatedAt: true,
      missionId: true,
      deal: { select: { title: true, closedAt: true, status: true, syncedAt: true } },
      user: { select: { firstName: true, lastName: true } },
    },
    orderBy: { calculatedAt: 'asc' },
  });

  console.log(`${pending.length} commission(s) PENDING au total :\n`);
  for (const c of pending) {
    const pm = c.periodMonth.getTime() > new Date('1971-01-01').getTime()
      ? `periodMonth=${c.periodMonth.toISOString().slice(0, 10)}`
      : `closedAt=${c.deal?.closedAt?.toISOString().slice(0, 10) ?? 'NULL'} syncedAt=${c.deal?.syncedAt?.toISOString().slice(0, 10)}`;
    console.log(`  ${c.user.firstName} ${c.user.lastName} | ${c.deal?.title} (${c.deal?.status}) | ${c.amount.toFixed(2)}€ | ${pm} | calc=${c.calculatedAt.toISOString().slice(0, 10)} | mission=${c.missionId ? 'oui' : 'non'}`);
  }
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => void prisma.$disconnect());
