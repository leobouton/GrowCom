import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  // Trouver tous les users dont l'email contient des majuscules
  const users = await prisma.user.findMany({
    select: { id: true, email: true, firstName: true, lastName: true },
  });

  const toFix = users.filter((u) => u.email !== u.email.toLowerCase());

  if (toFix.length === 0) {
    console.log('✅ Aucun email avec majuscules trouvé.');
    return;
  }

  console.log(`\n${toFix.length} email(s) à corriger :`);
  for (const u of toFix) {
    console.log(`  ${u.firstName} ${u.lastName} : "${u.email}" → "${u.email.toLowerCase()}"`);
    await prisma.user.update({
      where: { id: u.id },
      data: { email: u.email.toLowerCase() },
    });
    console.log(`  ✅ Corrigé`);
  }

  console.log('\n✅ Tous les emails ont été normalisés en minuscules.');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
