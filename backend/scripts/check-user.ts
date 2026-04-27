import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'ellatopia1@gmail.com';
  const password = 'Matteo39';

  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
      tenantId: true,
      isActive: true,
      emailVerified: true,
      passwordHash: true,
      inviteToken: true,
      inviteTokenExpiry: true,
      createdAt: true,
    },
  });

  if (!user) {
    console.log('\n❌ AUCUN UTILISATEUR trouvé avec cet email dans la base de données.');
    return;
  }

  console.log('\n=== Compte trouvé ===');
  console.log(`  Nom         : ${user.firstName} ${user.lastName}`);
  console.log(`  Email       : ${user.email}`);
  console.log(`  Rôle        : ${user.role}`);
  console.log(`  Actif       : ${user.isActive}`);
  console.log(`  Email vérifié : ${user.emailVerified}`);
  console.log(`  TenantId    : ${user.tenantId ?? 'AUCUN'}`);
  console.log(`  A un mot de passe : ${user.passwordHash ? 'OUI' : 'NON (invitation pas encore acceptée)'}`);
  console.log(`  Invitation en attente : ${user.inviteToken ? 'OUI' : 'non'}`);
  if (user.inviteTokenExpiry) {
    const expired = user.inviteTokenExpiry < new Date();
    console.log(`  Invitation expirée : ${expired ? 'OUI ⚠️' : 'non'}`);
  }
  console.log(`  Créé le     : ${user.createdAt.toLocaleDateString('fr-FR')}`);

  // Vérifier le mot de passe
  if (user.passwordHash) {
    const valid = await bcrypt.compare(password, user.passwordHash);
    console.log(`\n  Mot de passe "${password}" correct : ${valid ? '✅ OUI' : '❌ NON'}`);
  }

  // Diagnostic
  console.log('\n=== Diagnostic ===');
  if (!user.isActive) {
    console.log('❌ Compte désactivé → connexion impossible');
  } else if (!user.passwordHash) {
    console.log('❌ Pas de mot de passe → invitation jamais acceptée');
  } else if (!user.emailVerified) {
    console.log('⚠️  Email non vérifié mais mot de passe présent → connexion possible');
  } else {
    console.log('✅ Compte OK en théorie');
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
