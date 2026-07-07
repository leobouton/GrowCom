/** Diagnostic temporaire — commissions de Thibault Jeannin vs total des gains du mois. */
import { prisma } from '../src/config/prisma';

async function main() {
  const user = await prisma.user.findFirst({
    where: { firstName: { contains: 'Thibau', mode: 'insensitive' } },
    select: { id: true, tenantId: true, firstName: true, lastName: true, fixedSalary: true },
  });
  if (!user) {
    console.log('Utilisateur Thibault introuvable');
    return;
  }
  console.log(`Utilisateur : ${user.firstName} ${user.lastName} (${user.id}) — fixe ${user.fixedSalary}€`);

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

  const commissions = await prisma.commission.findMany({
    where: { userId: user.id, tenantId: user.tenantId },
    include: { deal: { select: { title: true, closedAt: true, status: true } } },
    orderBy: { calculatedAt: 'desc' },
  });

  console.log(`\nTOUTES LES COMMISSIONS (${commissions.length}) :`);
  for (const c of commissions) {
    console.log(
      `  ${c.deal.title} | ${c.amount}€ | status=${c.status}` +
      ` | closedAt=${c.deal.closedAt?.toISOString().slice(0, 10) ?? 'null'}` +
      ` | calculatedAt=${c.calculatedAt?.toISOString().slice(0, 10) ?? 'null'}` +
      ` | validatedAt=${c.validatedAt?.toISOString().slice(0, 10) ?? 'null'}` +
      ` | paidAt=${c.paidAt?.toISOString().slice(0, 10) ?? 'null'}` +
      ` | scheduledPaymentAt=${c.scheduledPaymentAt?.toISOString().slice(0, 10) ?? 'null'}` +
      ` | awaitingClientPayment=${c.awaitingClientPayment}`,
    );
  }

  const sum = await prisma.commission.aggregate({
    where: {
      userId: user.id,
      tenantId: user.tenantId,
      status: { in: ['VALIDATED', 'PAID'] },
      validatedAt: { gte: startOfMonth, lte: endOfMonth },
    },
    _sum: { amount: true },
  });
  console.log(`\nTotal "gains du mois" (VALIDATED/PAID avec validatedAt dans le mois) : ${sum._sum.amount ?? 0}€`);

  const noValidatedAt = commissions.filter(
    (c) => (c.status === 'VALIDATED' || c.status === 'PAID') && !c.validatedAt,
  );
  console.log(`Commissions VALIDATED/PAID SANS validatedAt : ${noValidatedAt.length}`);
  for (const c of noValidatedAt) {
    console.log(`  → ${c.deal.title} | ${c.amount}€ | status=${c.status} | paidAt=${c.paidAt?.toISOString() ?? 'null'}`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
