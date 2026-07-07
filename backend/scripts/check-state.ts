/** Script de diagnostic temporaire — état équipes / commissions à 0 € / dealTypes. */
import { prisma } from '../src/config/prisma';
import { commissionService } from '../src/services/commission.service';
import { UserRole } from '../../shared/types';

const LEO = 'cmo0g412d00038hp0c9seblu7';
const MATTEO = 'cmo7ljcer00073fcjuxdxmodp';
const TENANT = 'cmo0g40z300018hp0rknkca32';

async function main() {
  // Files de validation (qui doit valider quoi)
  const leoStats = await commissionService.getManagerStats(TENANT, LEO, UserRole.MANAGER);
  console.log(`FILE DE VALIDATION DE LÉO (MANAGER) — ${leoStats.pendingCommissions.length} commission(s):`);
  for (const c of leoStats.pendingCommissions) {
    console.log(`  ${c.user.firstName} | ${c.deal?.title} | ${c.amount}€`);
  }
  const matteoStats = await commissionService.getManagerStats(TENANT, MATTEO, UserRole.TEAM_LEAD);
  console.log(`\nFILE DE VALIDATION DE MATTEO (TEAM_LEAD BU NORD) — ${matteoStats.pendingCommissions.length} commission(s):`);
  for (const c of matteoStats.pendingCommissions) {
    console.log(`  ${c.user.firstName} | ${c.deal?.title} | ${c.amount}€`);
  }
  console.log('');
  const groups = await prisma.group.findMany({
    include: {
      lead: { select: { firstName: true, lastName: true, role: true } },
      manager: { select: { firstName: true, lastName: true, role: true } },
      members: { select: { id: true, firstName: true, lastName: true, role: true } },
    },
  });
  console.log('ÉQUIPES:');
  for (const g of groups) {
    console.log(`  ${g.name} | lead=${g.lead ? `${g.lead.firstName} ${g.lead.lastName} (${g.lead.role})` : 'AUCUN'} | manager=${g.manager ? `${g.manager.firstName} (${g.manager.role})` : 'AUCUN'}`);
    for (const m of g.members) console.log(`     - ${m.firstName} ${m.lastName} (${m.role})`);
  }

  const users = await prisma.user.findMany({
    where: { isActive: true },
    select: { id: true, firstName: true, lastName: true, role: true, groupId: true },
  });
  console.log('\nUTILISATEURS ACTIFS:');
  for (const u of users) console.log(`  ${u.firstName} ${u.lastName} | ${u.role} | groupe=${u.groupId ?? 'AUCUN'}`);

  const zero = await prisma.commission.findMany({
    where: { amount: 0 },
    include: {
      rule: { select: { name: true } },
      user: { select: { firstName: true } },
      deal: { select: { title: true, amount: true } },
    },
  });
  console.log(`\nCOMMISSIONS À 0 € (${zero.length}):`);
  for (const c of zero) console.log(`  ${c.user.firstName} | ${c.deal?.title ?? '(mission)'} | règle=${c.rule.name} | statut=${c.status}`);

  const deals = await prisma.deal.findMany({
    where: { status: 'WON' },
    select: { title: true, amount: true, dealType: true, assignedTo: { select: { firstName: true } } },
    orderBy: { closedAt: 'desc' },
    take: 30,
  });
  console.log('\nDEALS WON (type):');
  for (const d of deals) console.log(`  ${d.title} | ${d.amount}€ | dealType=${d.dealType ?? 'NULL'} | ${d.assignedTo?.firstName ?? '?'}`);

  const rules = await prisma.commissionRule.findMany({
    where: { isArchived: false },
    select: { name: true, dealType: true, isActive: true, config: true },
  });
  console.log('\nRÈGLES:');
  for (const r of rules) {
    const cfg = r.config as Record<string, unknown>;
    console.log(`  ${r.name} | dealType=${r.dealType ?? 'NULL'} | event=${cfg['appliesToEventType'] ?? 'DEAL_WON'} | active=${r.isActive}`);
  }

  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
