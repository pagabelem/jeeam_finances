import type { NextAuthOptions } from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { db } from '@/lib/db';
import { audit } from '@/lib/audit';
import { verifyTotp, hashRecovery, normalizeRecovery } from '@/lib/totp';
import { open } from '@/lib/secretbox';

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt', maxAge: 8 * 60 * 60 },
  pages: { signIn: '/login' },
  providers: [
    Credentials({
      name: 'credentials',
      credentials: { email: {}, password: {}, code: {} },
      async authorize(c) {
  console.log('[AUTH] Début authentification');

  if (!c?.email || !c?.password) {
    console.log('[AUTH] ECHEC: email ou password absent');
    return null;
  }

  const email = String(c.email).toLowerCase().trim();

  console.log('[AUTH] Email reçu:', email);
  console.log('[AUTH] Longueur mot de passe reçu:', String(c.password).length);

  const u = await db.user.findUnique({
    where: { email }
  });

  if (!u) {
    console.log('[AUTH] ECHEC: utilisateur introuvable');
    return null;
  }

  console.log('[AUTH] Utilisateur trouvé');
  console.log('[AUTH] Actif:', u.active);
  console.log('[AUTH] Tentatives:', u.failedAttempts);
  console.log('[AUTH] Verrouillage:', u.lockedUntil);
  console.log('[AUTH] 2FA:', u.totpEnabled);

  if (!u.active) {
    console.log('[AUTH] ECHEC: compte désactivé');
    return null;
  }

  if (u.lockedUntil && u.lockedUntil > new Date()) {
    console.log('[AUTH] ECHEC: compte verrouillé');
    return null;
  }

  const okPwd = await bcrypt.compare(
    String(c.password),
    u.passwordHash
  );

  console.log('[AUTH] Résultat bcrypt:', okPwd);

  if (!okPwd) {
    console.log('[AUTH] ECHEC: mot de passe incorrect');

    const attempts = u.failedAttempts + 1;

    await db.user.update({
      where: { id: u.id },
      data: {
        failedAttempts: attempts,
        lockedUntil: attempts >= 5
          ? new Date(Date.now() + 15 * 60_000)
          : null,
      },
    });

    return null;
  }

  console.log('[AUTH] Mot de passe validé');

  if (u.totpEnabled && u.totpSecret) {
    console.log('[AUTH] Vérification 2FA nécessaire');
  } else {
    await db.user.update({
      where: { id: u.id },
      data: {
        failedAttempts: 0,
        lockedUntil: null,
      },
    });
  }

  await audit({
    userId: u.id,
    action: 'LOGIN',
    entity: 'User',
    entityId: u.id,
    after: { twoFactor: u.totpEnabled },
  });

  console.log('[AUTH] AUTHENTIFICATION REUSSIE');

  return {
    id: u.id,
    email: u.email,
    name: u.name,
  };
},
    }),
  ],
  callbacks: {
    jwt({ token, user }) { if (user) token.uid = user.id; return token; },
    session({ session, token }) { (session.user as { id?: string }).id = token.uid as string; return session; },
  },
};
