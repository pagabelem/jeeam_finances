'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction, forbidAuditor } from '@/lib/session';
import { audit } from '@/lib/audit';

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
