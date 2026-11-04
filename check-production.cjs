const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const db = new PrismaClient();

async function main() {
  const u = await db.user.findUnique({
    where: { email: 'basile@jeeam.local' }
  });

  if (!u) {
    console.log('UTILISATEUR INTROUVABLE EN PRODUCTION');
    return;
  }

  console.log('Email :', u.email);
  console.log('Hash longueur :', u.passwordHash.length);
  console.log('Mot de passe valide :', await bcrypt.compare('Jeeam@Finance2026!Secure', u.passwordHash));
  console.log('Compte actif :', u.active);
  console.log('Tentatives :', u.failedAttempts);
  console.log('Verrouillage :', u.lockedUntil);
  console.log('2FA :', u.totpEnabled);
}

main().catch(console.error).finally(() => db.$disconnect());
