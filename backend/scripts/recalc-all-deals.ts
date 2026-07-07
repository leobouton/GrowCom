/**
 * Recalcule les commissions de TOUS les deals WON du tenant avec le moteur actuel
 * (filtre par type de vente inclus). Les commissions PENDING obsolètes sont purgées,
 * les commissions validées/payées ne sont jamais touchées. Idempotent.
 *
 * Lancer : npx tsx scripts/recalc-all-deals.ts
 */
import { prisma } from '../src/config/prisma';
import { commissionService } from '../src/services/commission.service';

const TENANT = 'cmo0g40z300018hp0rknkca32';

async function main() {
  const deals = await prisma.deal.findMany({
    where: { tenantId: TENANT, status: 'WON' },
    select: { id: true, title: true },
  });

  let ok = 0;
  let errors = 0;
  for (const d of deals) {
    try {
      await commissionService.recalculateForDeal(d.id, TENANT);
      ok++;
    } catch (err) {
      errors++;
      console.error(`  ERREUR sur "${d.title}":`, err instanceof Error ? err.message : err);
    }
  }
  console.log(`✅ ${ok} deals WON recalculés (${errors} erreur(s)).`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
