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
        if (!c?.email || !c?.password) return null;
        const u = await db.user.findUnique({ where: { email: c.email.toLowerCase().trim() } });
        if (!u || !u.active) return null;
        if (u.lockedUntil && u.lockedUntil > new Date()) return null;
        const okPwd = await bcrypt.compare(c.password, u.passwordHash);
        if (!okPwd) {
          const attempts = u.failedAttempts + 1;
          await db.user.update({
            where: { id: u.id },
            data: { failedAttempts: attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null },
          });
          await audit({ userId: u.id, action: 'LOGIN_FAILED', entity: 'User', entityId: u.id });
          return null;
        }
        if (u.totpEnabled && u.totpSecret) {
          // Deuxième facteur : code TOTP à 6 chiffres ou code de secours (usage unique).
          const code = String(c.code ?? '').trim();
          let good = false;
          const patch: { totpLastStep?: number; totpRecovery?: string[] } = {};
          if (/^\d{6}$/.test(code.replace(/\s/g, ''))) {
            let step: number | null = null;
            try { step = verifyTotp(open(u.totpSecret), code, { lastStep: u.totpLastStep }); } catch { step = null; }
            if (step != null) { good = true; patch.totpLastStep = step; }
          } else if (normalizeRecovery(code).length === 10) {
            const h = hashRecovery(code);
            if (u.totpRecovery.includes(h)) { good = true; patch.totpRecovery = u.totpRecovery.filter((x) => x !== h); }
          }
          if (!good) {
            const attempts = u.failedAttempts + 1;
            await db.user.update({ where: { id: u.id }, data: { failedAttempts: attempts, lockedUntil: attempts >= 5 ? new Date(Date.now() + 15 * 60_000) : null } });
            await audit({ userId: u.id, action: 'LOGIN_2FA_FAILED', entity: 'User', entityId: u.id });
            return null;
          }
          await db.user.update({ where: { id: u.id }, data: { ...patch, failedAttempts: 0, lockedUntil: null } });
          if (patch.totpRecovery) await audit({ userId: u.id, action: 'LOGIN_RECOVERY_CODE_USED', entity: 'User', entityId: u.id, after: { remaining: patch.totpRecovery.length } });
        } else {
          await db.user.update({ where: { id: u.id }, data: { failedAttempts: 0, lockedUntil: null } });
        }
        await audit({ userId: u.id, action: 'LOGIN', entity: 'User', entityId: u.id, after: { twoFactor: u.totpEnabled } });
        return { id: u.id, email: u.email, name: u.name };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) { if (user) token.uid = user.id; return token; },
    session({ session, token }) { (session.user as { id?: string }).id = token.uid as string; return session; },
  },
};
