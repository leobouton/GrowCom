/**
 * Correction ponctuelle — commissions dont validatedAt/paidAt est ANTÉRIEUR à la
 * date de signature du deal (impossible : on ne valide pas une vente avant de la signer).
 * Ces dates viennent des seeds/imports de démo. On les recale sur deal.closedAt.
 */
import { prisma } from '../src/config/prisma';

async function main() {
  const commissions = await prisma.commission.findMany({
    where: { status: { in: ['VALIDATED', 'PAID'] } },
    include: { deal: { select: { title: true, closedAt: true } }, user: { select: { firstName: true, lastName: true } } },
  });

  const anomalies = commissions.filter(
    (c) =>
      c.deal.closedAt &&
      ((c.validatedAt && c.validatedAt < c.deal.closedAt) ||
        (c.paidAt && c.paidAt < c.deal.closedAt)),
  );

  console.log(`Anomalies détectées : ${anomalies.length}`);
  for (const c of anomalies) {
    const closedAt = c.deal.closedAt!;
    console.log(
      `  ${c.user.firstName} ${c.user.lastName} | ${c.deal.title} | ${c.amount}€` +
      ` | closedAt=${closedAt.toISOString().slice(0, 10)}` +
      ` | validatedAt=${c.validatedAt?.toISOString().slice(0, 10) ?? 'null'}` +
      ` | paidAt=${c.paidAt?.toISOString().slice(0, 10) ?? 'null'} → recalé sur closedAt`,
    );
    await prisma.commission.update({
      where: { id: c.id },
      data: {
        ...(c.validatedAt && c.validatedAt < closedAt ? { validatedAt: closedAt } : {}),
        ...(c.paidAt && c.paidAt < closedAt ? { paidAt: closedAt } : {}),
      },
    });
  }
  console.log('Terminé.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
