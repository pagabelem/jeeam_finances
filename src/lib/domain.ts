// Règles de gestion partagées : verrouillage de périodes, références, seuils, soldes, budgets, notifications.
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { AppError } from '@/lib/errors';
import { num } from '@/lib/format';
import { approverRoleFor } from '@/lib/workflow';

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof db;

export async function assertPeriodOpen(date: Date, client: Client = db) {
  const l = await client.periodLock.findFirst({ where: { startDate: { lte: date }, endDate: { gte: date }, unlockedAt: null } });
  if (l) throw new AppError(`La période « ${l.label} » est verrouillée par le Commissaire aux comptes : modification impossible.`);
}

export async function nextReference(tx: Tx, date: Date) {
  const year = date.getFullYear();
  const c = await tx.referenceCounter.upsert({ where: { year }, update: { last: { increment: 1 } }, create: { year, last: 1 } });
  return `JEEAM-${year}-${String(c.last).padStart(4, '0')}`;
}

export async function getThreshold(client: Client = db) {
  const s = await client.setting.findUnique({ where: { key: 'approvalThresholdMad' } });
  return typeof s?.value === 'number' ? s.value : 2000;
}

export async function getSettingNumber(key: string, fallback: number | null, client: Client = db): Promise<number | null> {
  const s = await client.setting.findUnique({ where: { key } });
  return typeof s?.value === 'number' ? s.value : fallback;
}

/** Seuil de double validation (2 approbateurs distincts) ; null = fonction désactivée. */
export async function getDoubleThreshold(client: Client = db) {
  const v = await getSettingNumber('doubleApprovalThresholdMad', null, client);
  return v && v > 0 ? v : null;
}

export async function notifyUsers(client: Client, userIds: string[], n: { title: string; body: string; link?: string }) {
  const ids = Array.from(new Set(userIds));
  if (!ids.length) return;
  await client.notification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
}

export async function notifyPerm(client: Client, perm: string, n: { title: string; body: string; link?: string }, exclude?: string | string[]) {
  const ex = (Array.isArray(exclude) ? exclude : exclude ? [exclude] : []).filter(Boolean);
  const users = await client.user.findMany({
    where: { active: true, role: { permissions: { some: { permission: { key: perm } } } }, ...(ex.length ? { id: { notIn: ex } } : {}) },
    select: { id: true },
  });
  await notifyUsers(client, users.map((u) => u.id), n);
}

/** Rappel dédoublonné : n'envoie pas deux fois la même notification (même titre + lien) dans la fenêtre `cooldownDays`. */
export async function notifyOnce(client: Client, userIds: string[], n: { title: string; body: string; link?: string }, cooldownDays = 3) {
  const since = new Date(Date.now() - cooldownDays * 86_400_000);
  let sent = 0;
  for (const userId of Array.from(new Set(userIds))) {
    const dup = await client.notification.findFirst({ where: { userId, title: n.title, link: n.link ?? null, createdAt: { gte: since } }, select: { id: true } });
    if (dup) continue;
    await client.notification.create({ data: { userId, ...n } });
    sent++;
  }
  return sent;
}

/** Utilisateurs autorisés à décider du 1er niveau d'une demande émise par `requesterRoleKey` (Trésorière → CAC ; sinon → Trésorière). */
export async function approverIds(client: Client, requesterRoleKey: string) {
  const u = await client.user.findMany({
    where: { active: true, role: { key: approverRoleFor(requesterRoleKey), permissions: { some: { permission: { key: 'expenses.approve' } } } } }, select: { id: true } });
  return u.map((x) => x.id);
}

export async function notifyApprovers(client: Client, requesterRoleKey: string, n: { title: string; body: string; link?: string }, exclude: string[] = []) {
  const ids = (await approverIds(client, requesterRoleKey)).filter((id) => !exclude.includes(id));
  if (ids.length) await client.notification.createMany({ data: ids.map((userId) => ({ userId, ...n })) });
}

/** Notifie TOUS les membres actifs du bureau (écarts devis/réel, clôture d'activité). */
export async function notifyAll(client: Client, n: { title: string; body: string; link?: string }) {
  const u = await client.user.findMany({ where: { active: true }, select: { id: true } });
  if (u.length) await client.notification.createMany({ data: u.map((x) => ({ userId: x.id, ...n })) });
}

export async function usersWithPerm(client: Client, perm: string) {
  const u = await client.user.findMany({ where: { active: true, role: { permissions: { some: { permission: { key: perm } } } } }, select: { id: true } });
  return u.map((x) => x.id);
}

/**
 * Soldes par compte.
 *  - `balance`   : solde comptable = solde initial + recettes − dépenses PAYÉES (le compte n'est débité qu'au paiement) ;
 *  - `committed` : dépenses AUTORISÉES mais pas encore payées (engagées) ;
 *  - `available` : `balance` − `committed`.
 */
export async function accountBalances() {
  const [accounts, sums, pending] = await Promise.all([
    db.account.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.transaction.groupBy({ by: ['accountId', 'type'], where: { status: { in: ['PAID', 'CONTROLLED'] } }, _sum: { amountMad: true } }),
    db.transaction.groupBy({ by: ['accountId'], where: { type: 'EXPENSE', status: 'APPROVED' }, _sum: { amountMad: true } }),
  ]);
  return accounts.map((a) => {
    const inc = num(sums.find((s) => s.accountId === a.id && s.type === 'INCOME')?._sum.amountMad);
    const exp = num(sums.find((s) => s.accountId === a.id && s.type === 'EXPENSE')?._sum.amountMad);
    const committed = num(pending.find((p) => p.accountId === a.id)?._sum.amountMad);
    const balance = num(a.openingBalance) + inc - exp;
    return { ...a, balance, committed, available: balance - committed };
  });
}

/** Disponibilité budgétaire d'une dépense sur sa ligne (activité + catégorie). null si aucune ligne budgétaire. */
export async function budgetCheck(activityId: string | null, categoryId: string, amountMad: number, excludeId?: string) {
  if (!activityId) return null;
  const lines = await db.budgetLine.findMany({ where: { categoryId, budget: { activityId } } });
  if (!lines.length) return { planned: 0, committed: 0, remaining: 0, over: false, noLine: true };
  const planned = lines.reduce((s, l) => s + num(l.planned), 0);
  const agg = await db.transaction.aggregate({
    _sum: { amountMad: true },
    where: { activityId, categoryId, type: 'EXPENSE', status: { in: ['PENDING_APPROVAL', 'APPROVED', 'PAID', 'CONTROLLED'] }, ...(excludeId ? { id: { not: excludeId } } : {}) },
  });
  const committed = num(agg._sum.amountMad);
  const remaining = planned - committed;
  return { planned, committed, remaining, over: amountMad > remaining, noLine: false };
}