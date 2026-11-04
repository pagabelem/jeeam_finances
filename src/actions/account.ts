'use server';
import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction } from '@/lib/session';
import { audit } from '@/lib/audit';
import { generateSecret, verifyTotp, generateRecoveryCodes, hashRecovery } from '@/lib/totp';
import { seal, open } from '@/lib/secretbox';
import { TOTP_REQUIRED_ROLES } from '@/lib/permissions';

/** Les codes de secours ne sont affichés qu'une fois : cookie httpOnly de 2 minutes lu par /profil. */
function flashCodes(codes: string[]) {
  cookies().set('jeeam_codes', codes.join(','), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/profil', maxAge: 120 });
}

const pwd = z.string().min(10, 'Mot de passe : 10 caractères minimum').regex(/[A-Za-z]/, 'Mot de passe : au moins une lettre').regex(/\d/, 'Mot de passe : au moins un chiffre');

/** Chaque utilisateur peut modifier son propre nom. L'e-mail et le rôle ne sont modifiables que par un administrateur (admin.users : Commissaire aux comptes). */
export async function updateMyName(fd: FormData) {
  await act('/profil', async () => {
    const me = await requireAction();
    const r = z.string().trim().min(2, 'Nom : 2 caractères minimum').max(80, 'Nom : 80 caractères maximum').safeParse(fd.get('name'));
    if (!r.success) throw new AppError(r.error.issues[0].message);
    if (r.data === me.name) throw new AppError('Aucune modification détectée.');
    await db.user.update({ where: { id: me.id }, data: { name: r.data } });
    await audit({ userId: me.id, action: 'PROFILE_UPDATE', entity: 'User', entityId: me.id, before: { name: me.name }, after: { name: r.data } });
    revalidatePath('/', 'layout');
    return ok('/profil', 'Nom modifié');
  });
}

export async function changePassword(fd: FormData) {
  await act('/profil', async () => {
    const me = await requireAction();
    const current = String(fd.get('current') ?? '');
    const next = pwd.safeParse(fd.get('next'));
    if (!next.success) throw new AppError(next.error.issues[0].message);
    if (next.data !== String(fd.get('confirm') ?? '')) throw new AppError('La confirmation ne correspond pas.');
    const u = await db.user.findUnique({ where: { id: me.id } });
    if (!u || !(await bcrypt.compare(current, u.passwordHash))) throw new AppError('Mot de passe actuel incorrect.');
    if (current === next.data) throw new AppError('Le nouveau mot de passe doit être différent de l’actuel.');
    await db.user.update({ where: { id: me.id }, data: { passwordHash: await bcrypt.hash(next.data, 12), mustChangePassword: false } });
    await audit({ userId: me.id, action: 'PASSWORD_CHANGE', entity: 'User', entityId: me.id });
    revalidatePath('/', 'layout');
    return ok('/profil', 'Mot de passe modifié');
  });
}

/** Étape 1 : génère un secret (stocké chiffré, non encore actif). */
export async function startTotpSetup() {
  await act('/profil', async () => {
    const me = await requireAction();
    const u = await db.user.findUnique({ where: { id: me.id } });
    if (u?.totpEnabled) throw new AppError('La double authentification est déjà active.');
    await db.user.update({ where: { id: me.id }, data: { totpSecret: seal(generateSecret()), totpEnabled: false } });
    revalidatePath('/profil');
    return '/profil';
  });
}

/** Étape 2 : l'utilisateur saisit un code produit par son application → activation + codes de secours (affichés une seule fois). */
export async function confirmTotp(fd: FormData) {
  await act('/profil', async () => {
    const me = await requireAction();
    const u = await db.user.findUnique({ where: { id: me.id } });
    if (!u?.totpSecret || u.totpEnabled) throw new AppError('Aucune activation en cours.');
    const step = verifyTotp(open(u.totpSecret), String(fd.get('code') ?? ''), { lastStep: u.totpLastStep });
    if (step == null) throw new AppError('Code invalide : vérifiez l’heure de votre téléphone et réessayez.');
    const codes = generateRecoveryCodes();
    await db.user.update({ where: { id: me.id }, data: { totpEnabled: true, totpLastStep: step, totpRecovery: codes.map(hashRecovery) } });
    await audit({ userId: me.id, action: 'TOTP_ENABLE', entity: 'User', entityId: me.id });
    flashCodes(codes);
    revalidatePath('/', 'layout');
    return ok('/profil', 'Double authentification activée : conservez vos codes de secours');
  });
}

export async function regenerateRecovery(fd: FormData) {
  await act('/profil', async () => {
    const me = await requireAction();
    const u = await db.user.findUnique({ where: { id: me.id } });
    if (!u?.totpEnabled) throw new AppError('La double authentification n’est pas active.');
    if (!(await bcrypt.compare(String(fd.get('password') ?? ''), u.passwordHash))) throw new AppError('Mot de passe incorrect.');
    const codes = generateRecoveryCodes();
    await db.user.update({ where: { id: me.id }, data: { totpRecovery: codes.map(hashRecovery) } });
    await audit({ userId: me.id, action: 'TOTP_RECOVERY_REGENERATE', entity: 'User', entityId: me.id });
    flashCodes(codes);
    return ok('/profil', 'Nouveaux codes de secours générés (les anciens sont invalides)');
  });
}

export async function disableTotp(fd: FormData) {
  await act('/profil', async () => {
    const me = await requireAction();
    if (TOTP_REQUIRED_ROLES.includes(me.roleKey)) throw new AppError('La double authentification est obligatoire pour votre rôle.');
    const u = await db.user.findUnique({ where: { id: me.id } });
    if (!u?.totpEnabled) throw new AppError('La double authentification n’est pas active.');
    if (!(await bcrypt.compare(String(fd.get('password') ?? ''), u.passwordHash))) throw new AppError('Mot de passe incorrect.');
    await db.user.update({ where: { id: me.id }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpRecovery: [] } });
    await audit({ userId: me.id, action: 'TOTP_DISABLE', entity: 'User', entityId: me.id });
    return ok('/profil', 'Double authentification désactivée');
  });
}

/** Réinitialisation par un administrateur (téléphone perdu). L'utilisateur devra se ré-enrôler à la prochaine connexion. */
export async function adminResetTotp(id: string) {
  await act('/admin/utilisateurs', async () => {
    const me = await requireAction('admin.users');
    if (id === me.id) throw new AppError('Vous ne pouvez pas réinitialiser votre propre double authentification.');
    await db.user.update({ where: { id }, data: { totpEnabled: false, totpSecret: null, totpLastStep: null, totpRecovery: [] } });
    await audit({ userId: me.id, action: 'TOTP_ADMIN_RESET', entity: 'User', entityId: id });
    return ok('/admin/utilisateurs', 'Double authentification réinitialisée');
  });
}