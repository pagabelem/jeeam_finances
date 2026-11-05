'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction, forbidAuditor } from '@/lib/session';
import { audit } from '@/lib/audit';
import { notifyAll } from '@/lib/domain';
import { describeVariance } from '@/lib/workflow';
import { mad, num } from '@/lib/format';

const opt = z.string().optional().transform((v) => v || undefined);

export async function createActivity(fd: FormData) {
  await act('/activites/nouvelle', async () => {
    const me = await requireAction('activities.manage');
    forbidAuditor(me);
    const r = z.object({
      name: z.string().trim().min(3, 'Nom requis'), description: opt, managerId: opt, regionId: opt,
      startDate: z.coerce.date({ errorMap: () => ({ message: 'Date de début invalide' }) }),
      endDate: z.coerce.date({ errorMap: () => ({ message: 'Date de fin invalide' }) }),
    }).safeParse(Object.fromEntries(fd));
    if (!r.success) throw new AppError(r.error.issues[0].message);
    if (r.data.endDate < r.data.startDate) throw new AppError('La fin doit suivre le début.');
    const a = await db.$transaction(async (tx) => {
      const a = await tx.activity.create({ data: r.data });
      await tx.budget.create({ data: { activityId: a.id } });
      await audit({ userId: me.id, action: 'ACTIVITY_CREATE', entity: 'Activity', entityId: a.id, after: a }, tx);
      return a;
    });
    return ok(`/activites/${a.id}`, 'Activité créée');
  });
}

export async function addBudgetLine(activityId: string, fd: FormData) {
  await act(`/activites/${activityId}`, async () => {
    const me = await requireAction('activities.manage');
    forbidAuditor(me);
    const r = z.object({
      label: z.string().trim().min(2, 'Libellé requis'), categoryId: opt,
      planned: z.preprocess((v) => String(v).replace(/\s/g, '').replace(',', '.'), z.coerce.number().positive('Montant invalide')),
    }).safeParse(Object.fromEntries(fd));
    if (!r.success) throw new AppError(r.error.issues[0].message);
    await db.$transaction(async (tx) => {
      const budget = (await tx.budget.findFirst({ where: { activityId } })) ?? (await tx.budget.create({ data: { activityId } }));
      const l = await tx.budgetLine.create({ data: { ...r.data, budgetId: budget.id } });
      await audit({ userId: me.id, action: 'BUDGETLINE_ADD', entity: 'BudgetLine', entityId: l.id, after: l }, tx);
    });
    revalidatePath(`/activites/${activityId}`);
    return ok(`/activites/${activityId}`, 'Ligne budgétaire ajoutée');
  });
}

export async function removeBudgetLine(activityId: string, lineId: string) {
  await act(`/activites/${activityId}`, async () => {
    const me = await requireAction('activities.manage');
    forbidAuditor(me);
    const l = await db.budgetLine.findUnique({ where: { id: lineId } });
    if (!l) throw new AppError('Ligne introuvable.');
    await db.$transaction(async (tx) => {
      await tx.budgetLine.delete({ where: { id: lineId } });
      await audit({ userId: me.id, action: 'BUDGETLINE_REMOVE', entity: 'BudgetLine', entityId: lineId, before: l }, tx);
    });
    return `/activites/${activityId}`;
  });
}

export async function setActivityStatus(id: string, fd: FormData) {
  await act(`/activites/${id}`, async () => {
    const me = await requireAction('activities.manage');
    forbidAuditor(me);
    const status = z.enum(['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']).parse(fd.get('status'));
    const a = await db.activity.findUnique({ where: { id } });
    if (!a) throw new AppError('Activité introuvable.');
    await db.$transaction(async (tx) => {
      await tx.activity.update({ where: { id }, data: { status } });
      await audit({ userId: me.id, action: 'ACTIVITY_STATUS', entity: 'Activity', entityId: id, before: { status: a.status }, after: { status } }, tx);
    });
    return ok(`/activites/${id}`, 'Statut mis à jour');
  });
}

/**
 * Clôture d'une activité : compare le total des devis autorisés au total des dépenses réelles enregistrées,
 * puis notifie TOUS les membres du bureau (aucune différence / X de plus / X de moins, et situation vs budget prévisionnel).
 */
export async function closeActivity(id: string) {
  await act(`/activites/${id}`, async () => {
    const me = await requireAction('activities.settle');
    forbidAuditor(me);
    await db.$transaction(async (tx) => {
      const a = await tx.activity.findUnique({ where: { id }, include: { budgets: { include: { lines: true } } } });
      if (!a) throw new AppError('Activité introuvable.');
      if (a.settledAt) throw new AppError('Cette activité est déjà clôturée.');
      const open = await tx.transaction.count({ where: { activityId: id, type: 'EXPENSE', status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED'] } } });
      if (open) throw new AppError(`${open} dépense(s) de cette activité ne sont pas encore réglées (brouillon, en attente ou autorisée) : enregistrez les dépenses réelles ou annulez-les avant de clôturer.`);
      const paid = await tx.transaction.findMany({ where: { activityId: id, type: 'EXPENSE', status: { in: ['PAID', 'CONTROLLED'] } }, select: { amountMad: true, quoteAmountMad: true } });
      const quote = paid.reduce((s, t) => s + num(t.quoteAmountMad ?? t.amountMad), 0);
      const actual = paid.reduce((s, t) => s + num(t.amountMad), 0);
      const planned = a.budgets.flatMap((b) => b.lines).reduce((s, l) => s + num(l.planned), 0);
      const v = describeVariance(quote, actual);
      await tx.activity.update({ where: { id }, data: { status: 'COMPLETED', settledAt: new Date(), settledById: me.id, quoteTotalMad: quote, actualTotalMad: actual } });
      await audit({ userId: me.id, action: 'ACTIVITY_SETTLE', entity: 'Activity', entityId: id,
        before: { status: a.status }, after: { status: 'COMPLETED', devisMad: quote, reelMad: actual, ecartMad: v.diff, budgetPrevuMad: planned } }, tx);
      const verdict = v.kind === 'EQUAL' ? 'aucune différence entre le devis et les dépenses réelles'
        : v.kind === 'OVER' ? `les dépenses réelles dépassent le devis de ${mad(v.diff)}${v.pct != null ? ` (+${v.pct} %)` : ''}`
        : `les dépenses réelles sont inférieures au devis de ${mad(Math.abs(v.diff))}${v.pct != null ? ` (${v.pct} %)` : ''}`;
      const budget = planned > 0 ? ` Budget prévisionnel : ${mad(planned)} (${actual <= planned ? `reste ${mad(planned - actual)}` : `dépassement de ${mad(actual - planned)}`}).` : '';
      await notifyAll(tx, { title: `Activité clôturée : ${a.name}`, body: `Devis ${mad(quote)} · dépenses réelles ${mad(actual)} : ${verdict}.${budget}`, link: `/activites/${id}` });
    });
    revalidatePath('/', 'layout');
    return ok(`/activites/${id}`, 'Activité clôturée : le bureau est notifié');
  });
}