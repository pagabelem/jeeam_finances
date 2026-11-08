'use server';
import { revalidatePath } from 'next/cache';
import bcrypt from 'bcryptjs';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction } from '@/lib/session';
import { audit } from '@/lib/audit';
import { assertPeriodOpen } from '@/lib/domain';
import { deleteStored } from '@/lib/storage';
import { digest } from '@/lib/hash';
import { allowDelete, checkConfirm, plain, purgeTransactions, record } from '@/lib/delete';
import { dt } from '@/lib/format';

const done = () => revalidatePath('/', 'layout');

export async function deleteTransaction(id: string, fd: FormData) {
  await act(`/depenses/${id}`, async () => {
    const me = await requireAction('data.delete');
    const reason = checkConfirm(fd);
    let keys: string[] = [], back = '/depenses', label = '';
    await db.$transaction(async (tx) => {
      await allowDelete(tx);
      const t = await tx.transaction.findUnique({ where: { id } });
      if (!t) throw new AppError('Opération introuvable.');
      back = t.type === 'INCOME' ? '/tresorerie/recettes' : '/depenses';
      label = `${t.reference} — ${t.description}`;
      const r = await purgeTransactions(tx, [id]);
      keys = r.keys;
      await record(tx, me, { entity: 'Transaction', entityId: id, label, reason, snapshot: r.snapshot });
    });
    await Promise.all(keys.map(deleteStored));
    done();
    return ok(back, `Opération supprimée : ${label}`);
  });
}

export async function deleteActivity(id: string, fd: FormData) {
  await act(`/activites/${id}`, async () => {
    const me = await requireAction('data.delete');
    const reason = checkConfirm(fd);
    const cascade = fd.get('mode') === 'cascade';
    let keys: string[] = [], label = '';
    await db.$transaction(async (tx) => {
      await allowDelete(tx);
      const a = await tx.activity.findUnique({ where: { id }, include: { transactions: { select: { id: true } }, budgets: { include: { lines: true } } } });
      if (!a) throw new AppError('Activité introuvable.');
      label = a.name;
      let snapshot: unknown[] = [];
      if (cascade) { const r = await purgeTransactions(tx, a.transactions.map((t) => t.id)); keys = r.keys; snapshot = r.snapshot; }
      else await tx.transaction.updateMany({ where: { activityId: id }, data: { activityId: null } });
      await tx.account.updateMany({ where: { activityId: id }, data: { activityId: null } });
      await tx.activity.delete({ where: { id } }); // budgets et lignes budgétaires : suppression en cascade
      await record(tx, me, { entity: 'Activity', entityId: id, label, reason, count: 1 + (cascade ? a.transactions.length : 0),
        snapshot: { activite: { nom: a.name, debut: a.startDate, fin: a.endDate, statut: a.status }, budgets: a.budgets.map((b) => ({ nom: b.name, lignes: b.lines.map((l) => ({ ligne: l.label, prevu: Number(l.planned) })) })),
          operations: cascade ? snapshot : `${a.transactions.length} opération(s) conservée(s), détachées de l’activité` } });
    });
    await Promise.all(keys.map(deleteStored));
    done();
    return ok('/activites', `Activité « ${label} » supprimée`);
  });
}

export async function deleteAccount(id: string, fd: FormData) {
  await act('/tresorerie/comptes', async () => {
    const me = await requireAction('data.delete');
    const reason = checkConfirm(fd);
    const cascade = fd.get('mode') === 'cascade';
    let keys: string[] = [], label = '';
    await db.$transaction(async (tx) => {
      await allowDelete(tx);
      const a = await tx.account.findUnique({ where: { id }, include: { transactions: { select: { id: true } }, adjustments: true } });
      if (!a) throw new AppError('Compte introuvable.');
      label = a.name;
      if (a.transactions.length && !cascade) throw new AppError(`Ce compte contient ${a.transactions.length} opération(s) : cochez « supprimer aussi ses opérations » pour le supprimer.`);
      const r = await purgeTransactions(tx, a.transactions.map((t) => t.id));
      keys = r.keys;
      await tx.balanceAdjustment.deleteMany({ where: { accountId: id } });
      await tx.account.delete({ where: { id } });
      await record(tx, me, { entity: 'Account', entityId: id, label, reason, count: 1 + a.transactions.length,
        snapshot: { compte: { nom: a.name, type: a.type, devise: a.currency, soldeInitial: Number(a.openingBalance) }, ajustementsDeSolde: a.adjustments.length, operations: r.snapshot } });
    });
    await Promise.all(keys.map(deleteStored));
    done();
    return ok('/tresorerie/comptes', `Compte « ${label} » supprimé`);
  });
}

export async function deleteObservation(id: string, fd: FormData) {
  await act('/audit/observations', async () => {
    const me = await requireAction('data.delete');
    const reason = checkConfirm(fd);
    await db.$transaction(async (tx) => {
      const o = await tx.auditObservation.findUnique({ where: { id }, include: { transaction: true } });
      if (!o) throw new AppError('Observation introuvable.');
      await tx.auditObservation.delete({ where: { id } });
      await record(tx, me, { entity: 'AuditObservation', entityId: id, label: o.title, reason,
        snapshot: { titre: o.title, constat: o.description, statut: o.status, reponse: o.response, operation: o.transaction?.reference ?? null } });
    });
    done();
    return ok('/audit/observations', 'Observation supprimée');
  });
}

export async function deleteAttachment(id: string, fd: FormData) {
  let txId = '';
  await act('/justificatifs', async () => {
    const me = await requireAction('data.delete');
    const reason = checkConfirm(fd);
    let key = '';
    await db.$transaction(async (tx) => {
      await allowDelete(tx);
      const a = await tx.attachment.findUnique({ where: { id }, include: { transaction: true } });
      if (!a) throw new AppError('Justificatif introuvable.');
      await assertPeriodOpen(a.transaction.transactionDate, tx);
      txId = a.transactionId; key = a.storageKey;
      await tx.attachment.delete({ where: { id } });
      await record(tx, me, { entity: 'Attachment', entityId: id, label: `${a.fileName} (${a.transaction.reference})`, reason, snapshot: { fichier: a.fileName, type: a.kind, taille: a.size, operation: a.transaction.reference } });
    });
    await deleteStored(key);
    done();
    return ok(`/depenses/${txId}`, 'Justificatif supprimé');
  });
}

/** Avec « data.delete » : supprime la notification chez TOUT LE MONDE (même titre, texte et lien, envoyés au même moment). Sinon : seulement chez soi. */
export async function deleteNotification(id: string) {
  const me = await requireAction();
  const n = await db.notification.findUnique({ where: { id } });
  if (!n) return;
  if (me.perms.has('data.delete')) {
    const t = n.createdAt.getTime();
    await db.notification.deleteMany({ where: { title: n.title, body: n.body, link: n.link, createdAt: { gte: new Date(t - 5000), lte: new Date(t + 5000) } } });
  } else if (n.userId === me.id) {
    await db.notification.delete({ where: { id } });
  }
  done();
}

/** Journal d'audit : suppression individuelle (sélection), par critère ou totale. Confirmée par le mot de passe ; la chaîne de hachage est re-scellée ; l'opération est inscrite au registre inaltérable. */
export async function purgeAuditLogs(fd: FormData) {
  await act('/admin/journal', async () => {
    const me = await requireAction('audit.purge');
    const reason = checkConfirm(fd);
    const u = await db.user.findUnique({ where: { id: me.id } });
    if (!u || !(await bcrypt.compare(String(fd.get('password') ?? ''), u.passwordHash))) throw new AppError('Mot de passe incorrect : confirmez votre mot de passe pour supprimer des entrées du journal.');
    const mode = String(fd.get('purgeMode') ?? '');
    let where: Prisma.AuditLogWhereInput = {};
    let criteria = '';
    if (mode === 'selection') {
      const ids = fd.getAll('ids').map(String);
      if (!ids.length) throw new AppError('Cochez au moins une entrée.');
      where = { id: { in: ids } }; criteria = `${ids.length} entrée(s) sélectionnée(s)`;
    } else if (mode === 'filter') {
      const entity = String(fd.get('f_entity') ?? '').trim(), action = String(fd.get('f_action') ?? '').trim(), userId = String(fd.get('f_user') ?? '').trim();
      const from = String(fd.get('f_from') ?? ''), to = String(fd.get('f_to') ?? '');
      if (!entity && !action && !userId && !from && !to) throw new AppError('Renseignez au moins un critère (entité, action, utilisateur ou dates) — ou choisissez « Tout supprimer ».');
      where = { ...(entity ? { entity } : {}), ...(action ? { action: { contains: action } } : {}), ...(userId ? { userId } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: new Date(from + 'T00:00:00') } : {}), ...(to ? { lte: new Date(to + 'T23:59:59.999') } : {}) } } : {}) };
      criteria = [entity && `entité=${entity}`, action && `action~${action}`, userId && 'utilisateur ciblé', from && `depuis ${from}`, to && `jusqu’au ${to}`].filter(Boolean).join(', ');
    } else if (mode === 'all') { criteria = 'tout le journal'; }
    else throw new AppError('Choisissez un mode de suppression.');

    let n = 0;
    await db.$transaction(async (tx) => {
      await allowDelete(tx);
      const rows = await tx.auditLog.findMany({ where, orderBy: { seq: 'asc' }, select: { seq: true, action: true, entity: true, entityId: true, userId: true, createdAt: true } });
      if (!rows.length) throw new AppError('Aucune entrée ne correspond.');
      n = rows.length;
      const minSeq = rows[0].seq;
      await tx.auditLog.deleteMany({ where });
      // Re-scellement : on recalcule la chaîne à partir de la première entrée touchée, pour qu'elle reste vérifiable.
      let prev = (await tx.auditLog.findFirst({ where: { seq: { lt: minSeq } }, orderBy: { seq: 'desc' }, select: { hash: true } }))?.hash ?? 'GENESIS';
      const rest = await tx.auditLog.findMany({ where: { seq: { gt: minSeq } }, orderBy: { seq: 'asc' } });
      for (const l of rest) {
        const h = digest(prev, { userId: l.userId, action: l.action, entity: l.entity, entityId: l.entityId, reason: l.reason }, l.createdAt, l.before, l.after);
        if (l.prevHash !== prev || l.hash !== h) await tx.auditLog.update({ where: { id: l.id }, data: { prevHash: prev, hash: h } });
        prev = h;
      }
      await record(tx, me, { entity: 'AuditLog', label: `Journal d’audit : ${criteria}`, reason, count: n,
        snapshot: { mode, criteres: criteria, premiereEntree: rows[0].seq, derniereEntree: rows[rows.length - 1].seq, aperçu: rows.slice(0, 300) } });
    }, { timeout: 120_000, maxWait: 15_000 });
    done();
    return ok('/admin/journal', `${n} entrée(s) du journal supprimée(s) (${criteria})`);
  });
}