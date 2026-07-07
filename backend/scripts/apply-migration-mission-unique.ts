/** Applique la migration "une commission récurrente par mission" (voir migration.sql). Idempotent. */
import { prisma } from '../src/config/prisma';

async function main() {
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Commission" DROP CONSTRAINT IF EXISTS "Commission_dealId_userId_ruleId_periodMonth_key"',
  );
  await prisma.$executeRawUnsafe(
    'DROP INDEX IF EXISTS "Commission_dealId_userId_ruleId_periodMonth_key"',
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Commission_dealId_userId_ruleId_missionId_periodMonth_key"
     ON "Commission"("dealId", "userId", "ruleId", "missionId", "periodMonth")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE UNIQUE INDEX IF NOT EXISTS "Commission_deal_oneshot_key"
     ON "Commission"("dealId", "userId", "ruleId", "periodMonth")
     WHERE "missionId" IS NULL`,
  );
  console.log('✅ Migration appliquée : unicité des commissions par mission.');
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
