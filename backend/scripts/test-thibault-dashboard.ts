/** Test temporaire — l'appel getCommercialStats de Thibault fonctionne-t-il ? */
import { prisma } from '../src/config/prisma';
import { commissionService } from '../src/services/commission.service';

async function main() {
  const user = await prisma.user.findFirst({
    where: { firstName: { contains: 'Thibau', mode: 'insensitive' } },
    select: { id: true, tenantId: true, firstName: true, lastName: true },
  });
  if (!user) throw new Error('Thibault introuvable');

  const stats = await commissionService.getCommercialStats(user.id, user.tenantId);
  console.log('OK — getCommercialStats a répondu');
  console.log(`totalEarnedThisMonth = ${stats.totalEarnedThisMonth}€`);
  console.log(`commissions = ${stats.commissions.length}`);
  console.log(`projections = ${stats.projections.length}`);
  console.log(`adjustments = ${stats.adjustments.length}`);
}

main()
  .catch((err) => {
    console.error('ERREUR :', err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
