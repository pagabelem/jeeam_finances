'use server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction, requireAnyAction } from '@/lib/session';
import { audit } from '@/lib/audit';
import { AUDITOR_FORBIDDEN } from '@/lib/permissions';

const pwd = z.string().min(10, 'Mot de passe : 10 caractères minimum').regex(/[A-Za-z]/, 'Mot de passe : au moins une lettre').regex(/\d/, 'Mot de passe : au moins un chiffre');
const first = (r: { success: false; error: z.ZodError }) => { throw new AppError(r.error.issues[0].message); };

export async function createUser(fd: FormData) {
  await act('/admin/utilisateurs', async () => {
    const me = await requireAction('admin.users');
    const r = z.object({ name: z.string().trim().min(2, 'Nom requis'), email: z.string().trim().toLowerCase().email('E-mail invalide'), roleId: z.string().min(1, 'Rôle requis'), password: pwd })
      .safeParse(Object.fromEntries(fd));
    if (!r.success) return first(r);
    if (await db.user.findUnique({ where: { email: r.data.email } })) throw new AppError('E-mail déjà utilisé.');
    const u = await db.user.create({ data: { name: r.data.name, email: r.data.email, roleId: r.data.roleId, passwordHash: await bcrypt.hash(r.data.password, 12), mustChangePassword: true } });
    await audit({ userId: me.id, action: 'USER_CREATE', entity: 'User', entityId: u.id, after: { name: u.name, email: u.email, roleId: u.roleId } });
    revalidatePath('/admin/utilisateurs');
    return ok('/admin/utilisateurs', 'Utilisateur créé');
  });
}

export async function updateUserRole(id: string, fd: FormData) {
  await act('/admin/utilisateurs', async () => {
    const me = await requireAction('admin.users');
    const roleId = String(fd.get('roleId') ?? '');
    const u = await db.user.findUnique({ where: { id } });
    if (!u) throw new AppError('Utilisateur introuvable.');
    if (u.id === me.id) throw new AppError('Vous ne pouvez pas modifier votre propre rôle.');
    await db.user.update({ where: { id }, data: { roleId } });
    await audit({ userId: me.id, action: 'USER_ROLE', entity: 'User', entityId: id, before: { roleId: u.roleId }, after: { roleId } });
    return ok('/admin/utilisateurs', 'Rôle modifié');
  });
}

export async function toggleUser(id: string) {
  await act('/admin/utilisateurs', async () => {
    const me = await requireAction('admin.users');
    if (id === me.id) throw new AppError('Vous ne pouvez pas désactiver votre propre compte.');
    const u = await db.user.findUnique({ where: { id } });
    if (!u) throw new AppError('Utilisateur introuvable.');
    await db.user.update({ where: { id }, data: { active: !u.active } });
    await audit({ userId: me.id, action: u.active ? 'USER_DISABLE' : 'USER_ENABLE', entity: 'User', entityId: id });
    return ok('/admin/utilisateurs', u.active ? 'Compte désactivé' : 'Compte réactivé');
  });
}

export async function resetPassword(id: string, fd: FormData) {
  await act('/admin/utilisateurs', async () => {
    const me = await requireAction('admin.users');
    const r = pwd.safeParse(fd.get('password'));
    if (!r.success) return first(r);
    await db.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(r.data, 12), failedAttempts: 0, lockedUntil: null, mustChangePassword: true } });
    await audit({ userId: me.id, action: 'USER_PASSWORD_RESET', entity: 'User', entityId: id });
    return ok('/admin/utilisateurs', 'Mot de passe réinitialisé');
  });
}

export async function saveRolePermissions(roleId: string, fd: FormData) {
  await act('/admin/roles', async () => {
    const me = await requireAction('admin.roles');
    const role = await db.role.findUnique({ where: { id: roleId }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw new AppError('Rôle introuvable.');
    let keys = fd.getAll('perm').map(String);
    if (role.key === 'CAC') {
      keys = keys.filter((k) => !AUDITOR_FORBIDDEN.includes(k));
      for (const k of ['admin.roles', 'admin.users']) if (!keys.includes(k)) keys.push(k);
    }
    const perms = await db.permission.findMany({ where: { key: { in: keys } } });
    await db.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      await tx.rolePermission.createMany({ data: perms.map((p) => ({ roleId, permissionId: p.id })) });
      await audit({ userId: me.id, action: 'ROLE_PERMISSIONS', entity: 'Role', entityId: roleId,
        before: role.permissions.map((p) => p.permission.key).sort(), after: keys.sort() }, tx);
    });
    return ok('/admin/roles', `Permissions de « ${role.name} » enregistrées`);
  });
}

export async function createRegion(fd: FormData) {
  await act('/admin/regions', async () => {
    const me = await requireAnyAction(['admin.regions', 'regions.manage']);
    const r = z.object({ name: z.string().trim().min(2, 'Nom requis'), zone: z.string().trim().optional(), contactName: z.string().trim().optional(), contactPhone: z.string().trim().optional() })
      .safeParse(Object.fromEntries(fd));
    if (!r.success) return first(r);
    if (await db.region.findUnique({ where: { name: r.data.name } })) throw new AppError('Région déjà existante.');
    const reg = await db.region.create({ data: r.data });
    await audit({ userId: me.id, action: 'REGION_CREATE', entity: 'Region', entityId: reg.id, after: reg });
    return ok('/admin/regions', 'Région ajoutée');
  });
}

export async function toggleRegion(id: string) {
  await act('/admin/regions', async () => {
    const me = await requireAnyAction(['admin.regions', 'regions.manage']);
    const r = await db.region.findUnique({ where: { id } });
    if (!r) throw new AppError('Région introuvable.');
    await db.region.update({ where: { id }, data: { active: !r.active } });
    await audit({ userId: me.id, action: 'REGION_TOGGLE', entity: 'Region', entityId: id, after: { active: !r.active } });
    return '/admin/regions';
  });
}

export async function createCategory(fd: FormData) {
  await act('/tresorerie/categories', async () => {
    const me = await requireAction('categories.manage');
    const r = z.object({ name: z.string().trim().min(2, 'Nom requis'), type: z.enum(['INCOME', 'EXPENSE']) }).safeParse(Object.fromEntries(fd));
    if (!r.success) return first(r);
    if (await db.category.findUnique({ where: { name_type: r.data } })) throw new AppError('Catégorie déjà existante.');
    const c = await db.category.create({ data: r.data });
    await audit({ userId: me.id, action: 'CATEGORY_CREATE', entity: 'Category', entityId: c.id, after: c });
    return ok('/tresorerie/categories', 'Catégorie ajoutée');
  });
}

export async function toggleCategory(id: string) {
  await act('/tresorerie/categories', async () => {
    const me = await requireAction('categories.manage');
    const c = await db.category.findUnique({ where: { id } });
    if (!c) throw new AppError('Catégorie introuvable.');
    await db.category.update({ where: { id }, data: { active: !c.active } });
    await audit({ userId: me.id, action: 'CATEGORY_TOGGLE', entity: 'Category', entityId: id, after: { active: !c.active } });
    return '/tresorerie/categories';
  });
}

export async function createAccount(fd: FormData) {
  await act('/tresorerie/comptes', async () => {
    const me = await requireAction('accounts.manage');
    const r = z.object({
      name: z.string().trim().min(2, 'Nom requis'), type: z.enum(['BANK', 'CASH', 'MOBILE_MONEY', 'ACTIVITY_FUND']),
      openingBalance: z.preprocess((v) => String(v || '0').replace(/\s/g, '').replace(',', '.'), z.coerce.number().min(0, 'Solde initial invalide')),
      activityId: z.string().optional().transform((v) => v || undefined),
    }).safeParse(Object.fromEntries(fd));
    if (!r.success) return first(r);
    if (await db.account.findUnique({ where: { name: r.data.name } })) throw new AppError('Compte déjà existant.');
    const a = await db.account.create({ data: r.data });
    await audit({ userId: me.id, action: 'ACCOUNT_CREATE', entity: 'Account', entityId: a.id, after: a });
    return ok('/tresorerie/comptes', 'Compte créé');
  });
}

const SETTINGS: { key: string; field: string; label: string; min: number; nullable?: boolean }[] = [
  { key: 'approvalThresholdMad', field: 'threshold', label: 'Seuil d’auto-autorisation', min: 0 },
  { key: 'doubleApprovalThresholdMad', field: 'doubleThreshold', label: 'Seuil de double validation', min: 0, nullable: true },
  { key: 'reminderPendingDays', field: 'reminderDays', label: 'Délai de rappel (jours)', min: 1 },
  { key: 'contributionReminderDay', field: 'contributionDay', label: 'Jour du mois pour le rappel des cotisations', min: 1 },
];

export async function saveSettings(fd: FormData) {
  await act('/admin/parametres', async () => {
    const me = await requireAction('admin.settings');
    for (const s of SETTINGS) {
      const raw = String(fd.get(s.field) ?? '').replace(/\s/g, '').replace(',', '.');
      if (raw === '' && s.nullable) {
        const before = await db.setting.findUnique({ where: { key: s.key } });
        if (before) { await db.setting.delete({ where: { key: s.key } }); await audit({ userId: me.id, action: 'SETTING_UPDATE', entity: 'Setting', entityId: s.key, before: before.value, after: null }); }
        continue;
      }
      const r = z.coerce.number().min(s.min, `${s.label} : valeur invalide`).max(s.key === 'contributionReminderDay' ? 28 : 1e9).safeParse(raw);
      if (!r.success) return first(r);
      const before = await db.setting.findUnique({ where: { key: s.key } });
      if (before?.value === r.data) continue;
      await db.setting.upsert({ where: { key: s.key }, update: { value: r.data }, create: { key: s.key, value: r.data } });
      await audit({ userId: me.id, action: 'SETTING_UPDATE', entity: 'Setting', entityId: s.key, before: before?.value, after: r.data });
    }
    return ok('/admin/parametres', 'Paramètres enregistrés');
  });
}

export async function markNotificationsRead() {
  const me = await requireAction();
  await db.notification.updateMany({ where: { userId: me.id, readAt: null }, data: { readAt: new Date() } });
  revalidatePath('/', 'layout');
}

/** Modification complète d'un utilisateur : nom, e-mail, rôle et (facultatif) nouveau mot de passe. */
export async function updateUser(id: string, fd: FormData) {
  await act('/admin/utilisateurs', async () => {
    const me = await requireAction('admin.users');
    const r = z.object({
      name: z.string().trim().min(2, 'Nom requis'),
      email: z.string().trim().toLowerCase().email('E-mail invalide'),
      roleId: z.string().min(1, 'Rôle requis'),
    }).safeParse(Object.fromEntries(fd));
    if (!r.success) return first(r);
    const newPwd = String(fd.get('password') ?? '');
    if (newPwd) { const p = pwd.safeParse(newPwd); if (!p.success) return first(p); }
    const u = await db.user.findUnique({ where: { id } });
    if (!u) throw new AppError('Utilisateur introuvable.');
    if (u.id === me.id && r.data.roleId !== u.roleId) throw new AppError('Vous ne pouvez pas modifier votre propre rôle.');
    const role = await db.role.findUnique({ where: { id: r.data.roleId } });
    if (!role) throw new AppError('Rôle introuvable.');
    if (r.data.email !== u.email && (await db.user.findUnique({ where: { email: r.data.email } }))) throw new AppError('E-mail déjà utilisé par un autre compte.');
    const data: Record<string, unknown> = { name: r.data.name, email: r.data.email, roleId: r.data.roleId };
    if (newPwd) Object.assign(data, { passwordHash: await bcrypt.hash(newPwd, 12), failedAttempts: 0, lockedUntil: null, mustChangePassword: u.id !== me.id });
    await db.user.update({ where: { id }, data });
    await audit({ userId: me.id, action: 'USER_UPDATE', entity: 'User', entityId: id,
      before: { name: u.name, email: u.email, roleId: u.roleId }, after: { name: r.data.name, email: r.data.email, roleId: r.data.roleId, motDePasseModifie: !!newPwd } });
    revalidatePath('/', 'layout');
    return ok('/admin/utilisateurs', 'Utilisateur modifié');
  });
}

export async function updateRegion(id: string, fd: FormData) {
  await act('/admin/regions', async () => {
    const me = await requireAnyAction(['admin.regions', 'regions.manage']);
    const r = z.object({ name: z.string().trim().min(2, 'Nom requis'), zone: z.string().trim().optional(), contactName: z.string().trim().optional(), contactPhone: z.string().trim().optional() })
      .safeParse(Object.fromEntries(fd));
    if (!r.success) return first(r);
    const before = await db.region.findUnique({ where: { id } });
    if (!before) throw new AppError('Région introuvable.');
    const clash = await db.region.findUnique({ where: { name: r.data.name } });
    if (clash && clash.id !== id) throw new AppError('Une autre région porte déjà ce nom.');
    const after = await db.region.update({ where: { id }, data: { name: r.data.name, zone: r.data.zone || null, contactName: r.data.contactName || null, contactPhone: r.data.contactPhone || null } });
    await audit({ userId: me.id, action: 'REGION_UPDATE', entity: 'Region', entityId: id,
      before: { name: before.name, zone: before.zone, contactName: before.contactName, contactPhone: before.contactPhone },
      after: { name: after.name, zone: after.zone, contactName: after.contactName, contactPhone: after.contactPhone } });
    revalidatePath('/', 'layout');
    return ok('/admin/regions', 'Région modifiée');
  });
}