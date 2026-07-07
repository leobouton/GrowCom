/** Vérification ponctuelle post-recalcul « marge inconnue = 0 ». */
import { prisma } from '../src/config/prisma';

async function main() {
  const c = await prisma.commission.findMany({
    where: { dealId: { in: ['cmr4k71ql001jpgzz00ewuls9', 'cmr4k76ja001vpgzz3kcge641'] } },
    include: { rule: { select: { name: true } }, user: { select: { firstName: true } }, deal: { select: { title: true } } },
  });
  console.log(`Commissions restantes sur ces 2 deals : ${c.length}`);
  for (const x of c) {
    console.log(`  ${x.user.firstName} | ${x.deal.title} | ${x.amount}€ | ${x.status} | ${x.rule.name}`);
    console.log(`    détail : ${x.calculationDetail}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
