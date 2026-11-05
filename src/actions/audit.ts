'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction } from '@/lib/session';
import { audit } from '@/lib/audit';
import { notifyUsers } from '@/lib/domain';
import { runAnomalyScan } from '@/lib/anomalies';
import { dt } from '@/lib/format';

export async function controlTransaction(id: string) {
  await act(`/depenses/${id}`, async () => {
    const user = await requireAction('audit.control');
    await db.$transaction(async (tx) => {
      const t = await tx.transaction.findUnique({ where: { id }, include: { attachments: { select: { id: true } }, observations: { select: { status: true } } } });
      if (!t) throw new AppError('Opération introuvable.');
      if (t.status !== 'PAID') throw new AppError('Seule une opération payée peut être contrôlée.');
      // Indépendance du contrôle : on ne contrôle jamais ce qu'on a soi-même demandé ou autorisé.
      if (t.createdById === user.id || t.validatedById === user.id) throw new AppError('Conflit d’intérêts : vous avez créé ou autorisé cette opération, vous ne pouvez pas la contrôler.');
      if (!t.attachments.length) throw new AppError('Aucun justificatif : ouvrez une observation d’audit plutôt que de valider le contrôle.');
      if (t.observations.some((o) => o.status !== 'CLOSED')) throw new AppError('Une observation non clôturée est rattachée à cette opération.');
      await tx.transaction.update({ where: { id }, data: { status: 'CONTROLLED', controlledById: user.id, controlledAt: new Date() } });
      await audit({ userId: user.id, action: 'TX_CONTROL', entity: 'Transaction', entityId: id, before: { status: 'PAID' }, after: { status: 'CONTROLLED' } }, tx);
      await notifyUsers(tx, [t.createdById], { title: 'Opération contrôlée', body: t.reference, link: `/depenses/${id}` });
    });
    revalidatePath('/', 'layout');
    return ok(`/depenses/${id}`, 'Contrôle validé');
  });
}

const obs = z.object({
  transactionId: z.string().optional().transform((v) => v || undefined),
  title: z.string().trim().min(3, 'Titre requis').max(150),
  description: z.string().trim().min(5, 'Description requise').max(2000),
  assigneeId: z.string().min(1, 'Destinataire requis'),
});
export async function openObservation(fd: FormData) {
  const back = String(fd.get('back') || '/audit/observations');
  await act(back, async () => {
    const user = await requireAction('audit.observe');
    const r = obs.safeParse(Object.fromEntries(fd));
    if (!r.success) throw new AppError(r.error.issues[0].message);
    await db.$transaction(async (tx) => {
      const o = await tx.auditObservation.create({ data: { ...r.data, raisedById: user.id } });
      await audit({ userId: user.id, action: 'OBS_OPEN', entity: 'AuditObservation', entityId: o.id, after: o }, tx);
      await notifyUsers(tx, [r.data.assigneeId], { title: 'Observation d’audit', body: r.data.title, link: '/audit/observations' });
    });
    revalidatePath('/audit', 'layout');
    return ok(back, 'Observation ouverte');
  });
}

export async function respondObservation(id: string, fd: FormData) {
  await act('/audit/observations', async () => {
    const user = await requireAction();
    const response = String(fd.get('response') ?? '').trim();
    if (response.length < 5) throw new AppError('Réponse trop courte.');
    await db.$transaction(async (tx) => {
      const o = await tx.auditObservation.findUnique({ where: { id } });
      if (!o) throw new AppError('Observation introuvable.');
      if (o.assigneeId !== user.id && !user.perms.has('observations.respond')) throw new AppError('Seul le destinataire peut répondre.');
      if (o.status !== 'OPEN') throw new AppError('Cette observation n’attend pas de réponse.');
      await tx.auditObservation.update({ where: { id }, data: { response, respondedAt: new Date(), status: 'RESPONDED' } });
      await audit({ userId: user.id, action: 'OBS_RESPOND', entity: 'AuditObservation', entityId: id, before: { status: o.status }, after: { status: 'RESPONDED', response } }, tx);
      await notifyUsers(tx, [o.raisedById], { title: 'Réponse à une observation', body: o.title, link: '/audit/observations' });
    });
    revalidatePath('/audit', 'layout');
    return ok('/audit/observations', 'Réponse enregistrée');
  });
}

export async function advanceObservation(id: string, to: 'VERIFIED' | 'CLOSED') {
  await act('/audit/observations', async () => {
    const user = await requireAction('audit.observe');
    await db.$transaction(async (tx) => {
      const o = await tx.auditObservation.findUnique({ where: { id } });
      if (!o) throw new AppError('Observation introuvable.');
      if (to === 'VERIFIED' && o.status !== 'RESPONDED') throw new AppError('Une réponse est requise avant vérification.');
      if (to === 'CLOSED' && (o.status !== 'VERIFIED' || !o.response)) throw new AppError('L’observation doit être répondue puis vérifiée avant clôture.');
      await tx.auditObservation.update({ where: { id }, data: to === 'VERIFIED' ? { status: 'VERIFIED', verifiedAt: new Date() } : { status: 'CLOSED', closedAt: new Date() } });
      await audit({ userId: user.id, action: 'OBS_' + to, entity: 'AuditObservation', entityId: id, before: { status: o.status }, after: { status: to } }, tx);
    });
    revalidatePath('/audit', 'layout');
    return ok('/audit/observations', to === 'VERIFIED' ? 'Observation vérifiée' : 'Observation clôturée');
  });
}

export async function lockPeriod(fd: FormData) {
  await act('/audit/periodes', async () => {
    const user = await requireAction('audit.lock');
    const r = z.object({
      label: z.string().trim().min(3, 'Libellé requis'),
      start: z.coerce.date({ errorMap: () => ({ message: 'Date de début invalide' }) }),
      end: z.coerce.date({ errorMap: () => ({ message: 'Date de fin invalide' }) }),
    }).safeParse(Object.fromEntries(fd));
    if (!r.success) throw new AppError(r.error.issues[0].message);
    const { label, start } = r.data;
    const end = new Date(r.data.end); end.setHours(23, 59, 59, 999);
    if (end < start) throw new AppError('La fin doit être postérieure au début.');
    await db.$transaction(async (tx) => {
      const overlap = await tx.periodLock.findFirst({ where: { unlockedAt: null, startDate: { lte: end }, endDate: { gte: start } } });
      if (overlap) throw new AppError(`Chevauchement avec la période verrouillée « ${overlap.label} ».`);
      const pending = await tx.transaction.count({ where: { transactionDate: { gte: start, lte: end }, status: { notIn: ['CONTROLLED', 'CANCELLED', 'REJECTED'] } } });
      if (pending) throw new AppError(`${pending} opération(s) de la période ne sont pas contrôlées/clôturées : verrouillage impossible.`);
      const openObs = await tx.auditObservation.count({ where: { status: { not: 'CLOSED' }, transaction: { transactionDate: { gte: start, lte: end } } } });
      if (openObs) throw new AppError(`${openObs} observation(s) non clôturée(s) sur la période.`);
      const l = await tx.periodLock.create({ data: { label, startDate: start, endDate: end, lockedById: user.id } });
      await audit({ userId: user.id, action: 'PERIOD_LOCK', entity: 'PeriodLock', entityId: l.id, after: { label, from: dt(start), to: dt(end) } }, tx);
    });
    return ok('/audit/periodes', 'Période verrouillée');
  });
}

export async function unlockPeriod(id: string, fd: FormData) {
  await act('/audit/periodes', async () => {
    const user = await requireAction('audit.lock');
    const reason = String(fd.get('reason') ?? '').trim();
    if (reason.length < 10) throw new AppError('Motif détaillé obligatoire (10 caractères min.) pour déverrouiller.');
    await db.$transaction(async (tx) => {
      const l = await tx.periodLock.findUnique({ where: { id } });
      if (!l || l.unlockedAt) throw new AppError('Période introuvable ou déjà déverrouillée.');
      await tx.periodLock.update({ where: { id }, data: { unlockedAt: new Date(), unlockReason: reason } });
      await audit({ userId: user.id, action: 'PERIOD_UNLOCK', entity: 'PeriodLock', entityId: id, reason }, tx);
    });
    return ok('/audit/periodes', 'Période déverrouillée (tracé dans le journal)');
  });
}

export async function scanAnomalies() {
  await act('/audit', async () => {
    const user = await requireAction('audit.view');
    const r = await runAnomalyScan();
    await audit({ userId: user.id, action: 'ANOMALY_SCAN', entity: 'AiInsight', after: r });
    revalidatePath('/audit');
    return ok('/audit', `Analyse terminée : ${r.created} nouvelle(s) alerte(s) sur ${r.scanned} opérations`);
  });
}

export async function resolveInsight(id: string) {
  await act('/audit', async () => {
    const user = await requireAction('audit.view');
    await db.aiInsight.update({ where: { id }, data: { resolved: true } });
    await audit({ userId: user.id, action: 'INSIGHT_RESOLVE', entity: 'AiInsight', entityId: id });
    revalidatePath('/audit');
    return '/audit';
  });
}