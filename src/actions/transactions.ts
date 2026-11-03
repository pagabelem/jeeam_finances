'use server';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction, forbidAuditor, type CurrentUser } from '@/lib/session';
import { audit } from '@/lib/audit';
import { assertPeriodOpen, nextReference, getThreshold, getDoubleThreshold, notifyPerm, notifyUsers, accountBalances, budgetCheck } from '@/lib/domain';
import { requiredApprovals, approvalBlock, editPolicy } from '@/lib/workflow';
import { saveFile, hasFile } from '@/lib/storage';
import { num, mad, iso } from '@/lib/format';

const money = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace(/\s/g, '').replace(',', '.') : v),
  z.coerce.number({ invalid_type_error: 'Montant invalide' }).positive('Montant invalide').max(1e9),
);
const optId = z.string().optional().transform((v) => v || undefined);
const optStr = z.string().max(120).optional().transform((v) => v?.trim() || undefined);

const schema = z.object({
  amount: money,
  currency: z.enum(['MAD', 'EUR', 'USD', 'XOF', 'XAF']).default('MAD'),
  rate: z.preprocess((v) => (v === '' || v == null ? undefined : String(v).replace(',', '.')), z.coerce.number().positive().optional()),
  date: z.coerce.date({ errorMap: () => ({ message: 'Date invalide' }) }),
  categoryId: z.string().min(1, 'Catégorie requise'),
  accountId: z.string().min(1, 'Compte requis'),
  activityId: optId,
  regionId: optId,
  paymentMethod: optStr,
  bankReference: optStr,
  description: z.string().trim().min(3, 'Description requise').max(500),
});

function parse(fd: FormData) {
  const r = schema.safeParse(Object.fromEntries(fd));
  if (!r.success) throw new AppError(r.error.issues[0].message);
  const d = r.data;
  if (d.currency !== 'MAD' && !d.rate) throw new AppError('Taux de change vers MAD requis pour une devise étrangère.');
  const rate = d.currency === 'MAD' ? 1 : d.rate!;
  return { ...d, rate, amountMad: Math.round(d.amount * rate * 100) / 100 };
}

async function createTx(type: 'INCOME' | 'EXPENSE', fd: FormData, user: CurrentUser, submit: boolean) {
  const d = parse(fd);
  const [cat, acc] = await Promise.all([
    db.category.findUnique({ where: { id: d.categoryId } }), db.account.findUnique({ where: { id: d.accountId } }),
  ]);
  if (!cat || !cat.active || cat.type !== type) throw new AppError('Catégorie invalide pour ce type d’opération.');
  if (!acc || !acc.active) throw new AppError('Compte invalide.');
  const quote = fd.get('quote');
  const saved = hasFile(quote) ? await saveFile(quote) : null;

  const id = await db.$transaction(async (tx) => {
    await assertPeriodOpen(d.date, tx);
    const reference = await nextReference(tx, d.date);
    const t = await tx.transaction.create({
      data: {
        reference, type, amount: d.amount, currency: d.currency, exchangeRate: d.rate, amountMad: d.amountMad,
        transactionDate: d.date, description: d.description, paymentMethod: d.paymentMethod, bankReference: d.bankReference,
        categoryId: d.categoryId, accountId: d.accountId, activityId: d.activityId, regionId: d.regionId,
        createdById: user.id, status: type === 'INCOME' ? 'PAID' : 'DRAFT', aiCategory: String(fd.get('aiCategory') ?? '').slice(0, 80) || undefined,
        paidById: type === 'INCOME' ? user.id : undefined, paidAt: type === 'INCOME' ? new Date() : undefined,
      },
    });
    if (saved) {
      await tx.attachment.create({ data: { transactionId: t.id, kind: 'QUOTE', fileName: saved.name, mimeType: saved.mime, size: saved.size, storageKey: saved.key, uploadedById: user.id } });
    }
    await audit({ userId: user.id, action: 'TX_CREATE', entity: 'Transaction', entityId: t.id, after: t }, tx);
    if (type === 'INCOME') {
      await notifyPerm(tx, 'audit.control', { title: 'Nouvelle recette à contrôler', body: `${reference} — ${mad(d.amountMad)}`, link: `/depenses/${t.id}` });
    } else if (submit) {
      await submitTx(tx, t.id, user);
    }
    return t.id;
  });
  return id;
}

async function submitTx(tx: Prisma.TransactionClient, id: string, user: CurrentUser) {
  const t = await tx.transaction.findUnique({ where: { id } });
  if (!t || t.type !== 'EXPENSE') throw new AppError('Dépense introuvable.');
  if (t.status !== 'DRAFT') throw new AppError('Seul un brouillon peut être soumis.');
  await assertPeriodOpen(t.transactionDate, tx);
  const b = await budgetCheck(t.activityId, t.categoryId, num(t.amountMad), t.id);
  await tx.transaction.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
  await tx.approval.create({ data: { transactionId: id } });
  await audit({ userId: user.id, action: 'TX_SUBMIT', entity: 'Transaction', entityId: id, before: { status: 'DRAFT' }, after: { status: 'PENDING_APPROVAL', budget: b } }, tx);
  const warn = b?.over ? ` ⚠ Dépassement budgétaire (reste ${mad(b.remaining)}).` : b?.noLine ? ' ⚠ Aucune ligne budgétaire pour cette catégorie.' : '';
  await notifyPerm(tx, 'expenses.approve', { title: 'Dépense à autoriser', body: `${t.reference} — ${mad(t.amountMad)}.${warn}`, link: `/depenses/${id}` }, user.id);
}

export async function createIncome(fd: FormData) {
  await act('/tresorerie/recettes/nouvelle', async () => {
    const user = await requireAction('income.record');
    forbidAuditor(user);
    const id = await createTx('INCOME', fd, user, false);
    revalidatePath('/', 'layout');
    return ok(`/depenses/${id}`, 'Recette enregistrée');
  });
}

export async function createExpense(fd: FormData) {
  await act('/depenses/nouvelle', async () => {
    const user = await requireAction('expenses.request');
    forbidAuditor(user);
    const id = await createTx('EXPENSE', fd, user, fd.get('intent') === 'submit');
    revalidatePath('/', 'layout');
    return ok(`/depenses/${id}`, fd.get('intent') === 'submit' ? 'Demande soumise pour autorisation' : 'Brouillon enregistré');
  });
}

export async function submitExpense(id: string) {
  await act(`/depenses/${id}`, async () => {
    const user = await requireAction('expenses.request');
    forbidAuditor(user);
    await db.$transaction((tx) => submitTx(tx, id, user));
    revalidatePath('/', 'layout');
    return ok(`/depenses/${id}`, 'Demande soumise');
  });
}

export async function decideExpense(id: string, fd: FormData) {
  await act(`/depenses/${id}`, async () => {
    const user = await requireAction('expenses.approve');
    forbidAuditor(user);
    const decision = fd.get('decision') === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    const comment = String(fd.get('comment') ?? '').trim();
    if (decision === 'REJECTED' && !comment) throw new AppError('Un motif est obligatoire pour refuser.');
    let msg = decision === 'APPROVED' ? 'Dépense autorisée' : 'Dépense refusée';
    await db.$transaction(async (tx) => {
      const t = await tx.transaction.findUnique({ where: { id } });
      if (!t || t.type !== 'EXPENSE') throw new AppError('Dépense introuvable.');
      if (t.status !== 'PENDING_APPROVAL') throw new AppError('Cette dépense n’est pas en attente d’autorisation.');
      await assertPeriodOpen(t.transactionDate, tx);
      const [threshold, dbl] = await Promise.all([getThreshold(tx), getDoubleThreshold(tx)]);
      const required = requiredApprovals(num(t.amountMad), dbl);
      const approvals = await tx.approval.findMany({ where: { transactionId: id, supersededAt: null }, orderBy: { createdAt: 'asc' } });
      const approvedBy = approvals.filter((a) => a.decision === 'APPROVED' && a.approverId).map((a) => a.approverId!);
      if (decision === 'APPROVED') {
        const block = approvalBlock({ userId: user.id, creatorId: t.createdById, amountMad: num(t.amountMad), threshold, doubleThreshold: dbl, approvedBy });
        if (block) throw new AppError(block.includes('seuil') ? block.replace('du seuil', `de ${mad(threshold)}`) : block);
      }
      const level = approvedBy.length + 1;
      const pending = approvals.find((a) => a.decision === 'PENDING');
      const data = { decision, comment: comment || null, approverId: user.id, decidedAt: new Date(), level } as const;
      if (pending) await tx.approval.update({ where: { id: pending.id }, data });
      else await tx.approval.create({ data: { transactionId: id, ...data } });

      if (decision === 'APPROVED' && level < required) {
        // Double validation : 1re autorisation enregistrée, une 2e personne distincte est requise.
        await tx.approval.create({ data: { transactionId: id, level: level + 1 } });
        await audit({ userId: user.id, action: 'TX_APPROVE_L' + level, entity: 'Transaction', entityId: id,
          before: { status: t.status }, after: { status: t.status, niveau: `${level}/${required}` }, reason: comment || null }, tx);
        await notifyPerm(tx, 'expenses.approve', { title: 'Seconde autorisation requise', body: `${t.reference} — ${mad(t.amountMad)} (autorisation ${level}/${required} donnée)`, link: `/depenses/${id}` },
          [t.createdById, ...approvedBy, user.id]);
        await notifyUsers(tx, [t.createdById], { title: 'Dépense : 1re autorisation donnée', body: `${t.reference} — en attente de la seconde autorisation`, link: `/depenses/${id}` });
        msg = `Autorisation ${level}/${required} enregistrée : une seconde personne doit autoriser`;
        return;
      }
      const status = decision === 'APPROVED' ? 'APPROVED' : 'REJECTED';
      await tx.transaction.update({ where: { id }, data: { status, validatedById: user.id, validatedAt: new Date() } });
      await audit({ userId: user.id, action: decision === 'APPROVED' ? 'TX_APPROVE' : 'TX_REJECT', entity: 'Transaction', entityId: id,
        before: { status: t.status }, after: { status, niveau: `${level}/${required}` }, reason: comment || null }, tx);
      await notifyUsers(tx, [t.createdById], { title: decision === 'APPROVED' ? 'Dépense autorisée' : 'Dépense refusée',
        body: `${t.reference}${comment ? ' — ' + comment : ''}`, link: `/depenses/${id}` });
      if (decision === 'APPROVED') await notifyPerm(tx, 'expenses.pay', { title: 'Dépense autorisée : à payer (montant engagé sur le compte)', body: `${t.reference} — ${mad(t.amountMad)}`, link: `/depenses/${id}` });
    });
    revalidatePath('/', 'layout');
    return ok(`/depenses/${id}`, msg);
  });
}

export async function payExpense(id: string, fd: FormData) {
  await act(`/depenses/${id}`, async () => {
    const user = await requireAction('expenses.pay');
    forbidAuditor(user);
    const bankReference = String(fd.get('bankReference') ?? '').trim();
    const proof = fd.get('proof');
    // La référence bancaire déjà saisie à la demande compte aussi : il faut au moins une référence ou une preuve.
    const known = await db.transaction.findUnique({ where: { id }, select: { bankReference: true } });
    if (!hasFile(proof) && !bankReference && !known?.bankReference) throw new AppError('Joignez la preuve de paiement ou saisissez la référence bancaire.');
    const saved = hasFile(proof) ? await saveFile(proof) : null;
    await db.$transaction(async (tx) => {
      const t = await tx.transaction.findUnique({ where: { id } });
      if (!t || t.type !== 'EXPENSE') throw new AppError('Dépense introuvable.');
      if (t.status !== 'APPROVED') throw new AppError('Seule une dépense autorisée peut être payée.');
      if (!t.validatedById) throw new AppError('Autorisation manquante.');
      await assertPeriodOpen(t.transactionDate, tx);
      const bal = (await accountBalances()).find((a) => a.id === t.accountId);
      if (bal && bal.balance < num(t.amountMad)) throw new AppError(`Solde comptable insuffisant sur « ${bal.name} » (${mad(bal.balance)}) pour payer ${mad(t.amountMad)}.`);
      await tx.transaction.update({ where: { id }, data: { status: 'PAID', paidById: user.id, paidAt: new Date(), bankReference: bankReference || t.bankReference } });
      if (saved) await tx.attachment.create({ data: { transactionId: id, kind: 'TRANSFER_PROOF', fileName: saved.name, mimeType: saved.mime, size: saved.size, storageKey: saved.key, uploadedById: user.id } });
      await audit({ userId: user.id, action: 'TX_PAY', entity: 'Transaction', entityId: id, before: { status: 'APPROVED' }, after: { status: 'PAID', bankReference } }, tx);
      await notifyPerm(tx, 'audit.control', { title: 'Opération à contrôler', body: `${t.reference} payée — ${mad(t.amountMad)}`, link: `/depenses/${id}` });
    });
    revalidatePath('/', 'layout');
    return ok(`/depenses/${id}`, 'Paiement enregistré : le compte est débité');
  });
}

export async function cancelTransaction(id: string, fd: FormData) {
  await act(`/depenses/${id}`, async () => {
    const user = await requireAction('transactions.cancel');
    forbidAuditor(user);
    const reason = String(fd.get('reason') ?? '').trim();
    if (reason.length < 5) throw new AppError('Motif d’annulation obligatoire (5 caractères min.).');
    await db.$transaction(async (tx) => {
      const t = await tx.transaction.findUnique({ where: { id } });
      if (!t) throw new AppError('Opération introuvable.');
      if (['CANCELLED', 'CONTROLLED'].includes(t.status)) throw new AppError('Une opération contrôlée ou déjà annulée ne peut plus être annulée. Ouvrez une demande de correction auprès du Commissaire aux comptes.');
      await assertPeriodOpen(t.transactionDate, tx);
      await tx.transaction.update({ where: { id }, data: { status: 'CANCELLED', cancelledById: user.id, cancelledAt: new Date(), cancelReason: reason } });
      await audit({ userId: user.id, action: 'TX_CANCEL', entity: 'Transaction', entityId: id, before: { status: t.status }, after: { status: 'CANCELLED' }, reason }, tx);
      await notifyPerm(tx, 'audit.view', { title: 'Opération annulée', body: `${t.reference} — ${reason}`, link: `/depenses/${id}` });
    });
    revalidatePath('/', 'layout');
    return ok(`/depenses/${id}`, 'Opération annulée');
  });
}

const kinds = ['INVOICE', 'RECEIPT', 'BANK_STATEMENT', 'TRANSFER_PROOF', 'QUOTE', 'CONTRACT', 'OTHER'] as const;
export async function addAttachment(id: string, fd: FormData) {
  await act(`/depenses/${id}`, async () => {
    const user = await requireAction('attachments.upload');
    forbidAuditor(user);
    const file = fd.get('file');
    if (!hasFile(file)) throw new AppError('Sélectionnez un fichier.');
    const kind = kinds.find((k) => k === fd.get('kind')) ?? 'OTHER';
    const saved = await saveFile(file);
    await db.$transaction(async (tx) => {
      const t = await tx.transaction.findUnique({ where: { id } });
      if (!t) throw new AppError('Opération introuvable.');
      if (['CANCELLED', 'CONTROLLED'].includes(t.status)) throw new AppError('Opération verrouillée : pièce non ajoutable.');
      await assertPeriodOpen(t.transactionDate, tx);
      const a = await tx.attachment.create({ data: { transactionId: id, kind, fileName: saved.name, mimeType: saved.mime, size: saved.size, storageKey: saved.key, uploadedById: user.id } });
      await audit({ userId: user.id, action: 'ATTACHMENT_ADD', entity: 'Attachment', entityId: a.id, after: { transactionId: id, kind, fileName: saved.name } }, tx);
    });
    revalidatePath(`/depenses/${id}`);
    return ok(`/depenses/${id}`, 'Justificatif ajouté');
  });
}

// ───────────────────────── Modification d'une opération ─────────────────────────
const snap = (v: { amount: unknown; currency: string; rate: unknown; date: Date; categoryId: string; accountId: string; activityId?: string | null;
  regionId?: string | null; paymentMethod?: string | null; bankReference?: string | null; description: string }) => ({
  amount: num(v.amount), currency: v.currency, rate: num(v.rate), date: iso(v.date), categoryId: v.categoryId, accountId: v.accountId,
  activityId: v.activityId ?? null, regionId: v.regionId ?? null, paymentMethod: v.paymentMethod ?? null, bankReference: v.bankReference ?? null, description: v.description,
});
const FINANCIAL = ['amount', 'currency', 'rate', 'date', 'categoryId', 'accountId', 'activityId'] as const;

export async function updateTransaction(id: string, fd: FormData) {
  await act(`/depenses/${id}/modifier`, async () => {
    const user = await requireAction();
    forbidAuditor(user);
    const d = parse(fd);
    const reason = String(fd.get('reason') ?? '').trim();
    let msg = 'Opération modifiée';
    await db.$transaction(async (tx) => {
      const t = await tx.transaction.findUnique({ where: { id } });
      if (!t) throw new AppError('Opération introuvable.');
      const pol = editPolicy({ status: t.status, type: t.type, isCreator: t.createdById === user.id, canRequest: user.perms.has('expenses.request'), canEdit: user.perms.has('transactions.edit') });
      if (!pol.allowed) throw new AppError(pol.why ?? 'Modification non autorisée.');
      if (pol.needsReason && reason.length < 5) throw new AppError('Motif de modification obligatoire (5 caractères min.).');
      const [cat, acc] = await Promise.all([tx.category.findUnique({ where: { id: d.categoryId } }), tx.account.findUnique({ where: { id: d.accountId } })]);
      if (!cat || !cat.active || cat.type !== t.type) throw new AppError('Catégorie invalide pour ce type d’opération.');
      if (!acc || !acc.active) throw new AppError('Compte invalide.');
      await assertPeriodOpen(t.transactionDate, tx);
      await assertPeriodOpen(d.date, tx);

      const before = snap({ ...t, rate: t.exchangeRate, date: t.transactionDate });
      const after = snap({ ...d, rate: d.rate });
      const keys = (Object.keys(after) as (keyof typeof after)[]).filter((k) => before[k] !== after[k]);
      if (!keys.length) throw new AppError('Aucune modification détectée.');
      const financial = keys.some((k) => (FINANCIAL as readonly string[]).includes(k));

      let status = t.status;
      let invalidated = false;
      if (t.type === 'EXPENSE') {
        if (t.status === 'REJECTED') status = 'DRAFT';
        else if ((t.status === 'APPROVED' || t.status === 'PENDING_APPROVAL') && financial) { status = 'PENDING_APPROVAL'; invalidated = true; }
      }
      await tx.transaction.update({
        where: { id },
        data: {
          amount: d.amount, currency: d.currency, exchangeRate: d.rate, amountMad: d.amountMad, transactionDate: d.date,
          description: d.description, paymentMethod: d.paymentMethod ?? null, bankReference: d.bankReference ?? null,
          categoryId: d.categoryId, accountId: d.accountId, activityId: d.activityId ?? null, regionId: d.regionId ?? null,
          status, ...(status !== t.status || invalidated ? { validatedById: null, validatedAt: null } : {}),
        },
      });
      if (invalidated) {
        await tx.approval.updateMany({ where: { transactionId: id, supersededAt: null }, data: { supersededAt: new Date() } });
        await tx.approval.create({ data: { transactionId: id, level: 1 } });
        const b = await budgetCheck(d.activityId ?? null, d.categoryId, d.amountMad, id);
        await notifyPerm(tx, 'expenses.approve', { title: 'Dépense modifiée : nouvelle autorisation requise', body: `${t.reference} — ${mad(d.amountMad)}${b?.over ? ' ⚠ dépassement budgétaire' : ''}`, link: `/depenses/${id}` }, user.id);
        msg = 'Opération modifiée : les autorisations précédentes sont annulées, une nouvelle autorisation est requise';
      }
      const changed = (o: Record<string, unknown>) => Object.fromEntries(keys.map((k) => [k, o[k]]));
      await audit({ userId: user.id, action: 'TX_UPDATE', entity: 'Transaction', entityId: id,
        before: { ...changed(before), status: t.status }, after: { ...changed(after), status }, reason: reason || null }, tx);
      if (t.status === 'PAID' || t.status === 'APPROVED') await notifyPerm(tx, 'audit.view', { title: 'Opération modifiée', body: `${t.reference} — ${reason}`, link: `/depenses/${id}` });
    });
    revalidatePath('/', 'layout');
    return ok(`/depenses/${id}`, msg);
  });
}