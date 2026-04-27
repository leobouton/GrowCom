import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Chercher tous les users dont l'email contient "leobouton" ou "lbouton"
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: 'leobouton', mode: 'insensitive' } },
        { email: { contains: 'lbouton', mode: 'insensitive' } },
        { firstName: { contains: 'leo', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      tenantId: true,
      isActive: true,
      emailVerified: true,
      fixedSalary: true,
      createdAt: true,
    },
  });

  console.log('\n=== Utilisateurs trouvés ===');
  if (users.length === 0) {
    console.log('Aucun utilisateur trouvé avec ces noms.');
  } else {
    users.forEach((u) => {
      console.log(`\n- ${u.firstName} ${u.lastName}`);
      console.log(`  Email      : ${u.email}`);
      console.log(`  Rôle       : ${u.role}`);
      console.log(`  Actif      : ${u.isActive}`);
      console.log(`  Email vérifié : ${u.emailVerified}`);
      console.log(`  TenantId   : ${u.tenantId ?? 'AUCUN'}`);
      console.log(`  Salaire    : ${u.fixedSalary}€`);
      console.log(`  Créé le    : ${u.createdAt.toLocaleDateString('fr-FR')}`);
    });
  }

  // Afficher aussi tous les tenants existants
  const tenants = await prisma.tenant.findMany({
    select: { id: true, name: true, slug: true, status: true },
  });
  console.log('\n=== Tenants (entreprises) ===');
  tenants.forEach((t) => {
    console.log(`- ${t.name} (${t.slug}) — ${t.status} — ID: ${t.id}`);
  });

  // Afficher tous les users du tenant si on en a un
  if (tenants.length > 0) {
    const allUsers = await prisma.user.findMany({
      where: { tenantId: tenants[0].id },
      select: {
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        isActive: true,
        emailVerified: true,
        fixedSalary: true,
      },
    });
    console.log(`\n=== Tous les membres du tenant "${tenants[0].name}" ===`);
    allUsers.forEach((u) => {
      console.log(`- ${u.firstName} ${u.lastName} (${u.email}) | rôle: ${u.role} | actif: ${u.isActive} | email vérifié: ${u.emailVerified} | salaire: ${u.fixedSalary}€`);
    });
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
