import { cache } from 'react';
import { redirect } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { TOTP_REQUIRED_ROLES } from '@/lib/permissions';

export const getUser = cache(async () => {
  const s = await getServerSession(authOptions);
  const id = (s?.user as { id?: string } | undefined)?.id;
  if (!id) return null;
  const u = await db.user.findUnique({
    where: { id },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
  });
  if (!u || !u.active) return null;
  return {
    id: u.id, name: u.name, email: u.email, avatar: u.avatar, roleId: u.roleId, roleKey: u.role.key, roleName: u.role.name,
    perms: new Set(u.role.permissions.map((rp) => rp.permission.key)),
    mustChangePassword: u.mustChangePassword, totpEnabled: u.totpEnabled,
    needs2faSetup: TOTP_REQUIRED_ROLES.includes(u.role.key) && !u.totpEnabled,
    requires2fa: TOTP_REQUIRED_ROLES.includes(u.role.key),
  };
});
export type CurrentUser = NonNullable<Awaited<ReturnType<typeof getUser>>>;

/** Pour les pages : redirige si non connecté / non autorisé. */
export async function requirePage(perm?: string | string[]) {
  const u = await getUser();
  if (!u) redirect('/login');
  if (perm) {
    const list = Array.isArray(perm) ? perm : [perm];
    if (!list.some((p) => u.perms.has(p))) redirect('/?error=' + encodeURIComponent('Accès refusé'));
  }
  return u;
}

/** Pour les server actions : lève AppError si permission manquante. */
export async function requireAction(perm?: string) {
  const u = await getUser();
  if (!u) redirect('/login');
  if (perm && !u.perms.has(perm)) throw new AppError('Permission insuffisante pour cette action.');
  return u;
}

/** Séparation des pouvoirs : le Commissaire aux comptes ne modifie jamais une opération. */
export function forbidAuditor(u: CurrentUser) {
  if (u.roleKey === 'CAC') throw new AppError('Le Commissaire aux comptes ne peut pas modifier les opérations : il émet des observations.');
}

/** Pour les server actions acceptant l'une de plusieurs permissions. */
export async function requireAnyAction(perms: string[]) {
  const u = await getUser();
  if (!u) redirect('/login');
  if (!perms.some((p) => u.perms.has(p))) throw new AppError('Permission insuffisante pour cette action.');
  return u;
}