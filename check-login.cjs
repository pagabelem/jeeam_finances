const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const fs = require('fs');

const env = fs.readFileSync('.env', 'utf8');
const match = env.match(/^SEED_PASSWORD\s*=\s*["']?([^"'\r\n]*)/m);
const password = match ? match[1] : '';

const db = new PrismaClient();

async function main() {
  const u = await db.user.findUnique({
    where: { email: 'basile@jeeam.local' }
  });

  if (!u) {
    console.log('Utilisateur introuvable');
    return;
  }

  console.log('Longueur du hash :', u.passwordHash.length);
  console.log('Longueur du mot de passe :', password.length);
  console.log('Mot de passe valide :', await bcrypt.compare(password, u.passwordHash));
  console.log('Compte actif :', u.active);
  console.log('Tentatives échouées :', u.failedAttempts);
  console.log('Verrouillage :', u.lockedUntil);
  console.log('2FA activée :', u.totpEnabled);
}

main().catch(console.error).finally(() => db.$disconnect());
