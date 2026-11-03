'use server';
import { revalidatePath } from 'next/cache';
import { db } from '@/lib/db';
import { act, AppError, ok } from '@/lib/errors';
import { requireAction, forbidAuditor } from '@/lib/session';
import { audit } from '@/lib/audit';
import { accountBalances, notifyPerm, notifyUsers } from '@/lib/domain';
import { adjustmentOutcome } from '@/lib/workflow';
import { mad, num } from '@/lib/format';

const BACK = '/tresorerie/ajustements';
const round = (n: number) => Math.round(n * 100) / 100;
const parseMoney = (v: FormDataEntryValue | null) => Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));

/** 1. La Trésorière demande la modification du solde → CAC et Présidente sont notifiés. */
export async function requestAdjustment(fd: FormData) {
  await act(BACK, async () => {
    const me = await requireAction('balance.request');
    forbidAuditor(me);
    const accountId = String(fd.get('accountId') ?? '');
    const newBalance = parseMoney(fd.get('newBalance'));
    const reason = String(fd.get('reason') ?? '').trim();
    if (!Number.isFinite(newBalance)) throw new AppError('Nouveau solde invalide.');
    if (reason.length < 10) throw new AppError('Motif obligatoire et détaillé (10 caractères min.).');
    await db.$transaction(async (tx) => {
      const acc = (await accountBalances()).find((a) => a.id === accountId);
      if (!acc) throw new AppError('Compte introuvable ou inactif.');
      const open = await tx.balanceAdjustment.findFirst({ where: { accountId, status: { in: ['PENDING', 'APPROVED'] } } });
      if (open) throw new AppError('Une modification de solde est déjà en cours pour ce compte : terminez-la ou annulez-la avant d’en demander une autre.');
      const delta = round(newBalance - acc.balance);
      if (delta === 0) throw new AppError('Le nouveau solde est identique au solde actuel.');

      // Un rôle = une autorisation requise. Rôles détenant balance.approve avec au moins un utilisateur actif autre que le demandeur.
      const roles = await tx.role.findMany({
        where: { permissions: { some: { permission: { key: 'balance.approve' } } }, users: { some: { active: true, id: { not: me.id } } } },
      });
      if (!roles.length) throw new AppError('Aucun approbateur configuré : accordez « balance.approve » aux rôles Commissaire aux comptes et Présidente (Administration > Rôles).');

      const adj = await tx.balanceAdjustment.create({
        data: { accountId, currentBalance: acc.balance, newBalance: round(newBalance), delta, reason, requestedById: me.id,
          approvals: { create: roles.map((r) => ({ roleId: r.id, roleName: r.name })) } },
      });
      await audit({ userId: me.id, action: 'BALANCE_ADJ_REQUEST', entity: 'BalanceAdjustment', entityId: adj.id,
        after: { account: acc.name, soldeActuel: acc.balance, nouveauSolde: round(newBalance), ecart: delta, approbateurs: roles.map((r) => r.name) }, reason }, tx);
      await notifyPerm(tx, 'balance.approve', { title: 'Modification de solde à autoriser',
        body: `${acc.name} : ${mad(acc.balance)} → ${mad(newBalance)} (écart ${delta > 0 ? '+' : ''}${mad(delta)}). Motif : ${reason}`, link: BACK }, me.id);
    });
    revalidatePath('/', 'layout');
    return ok(BACK, 'Demande envoyée : le Commissaire aux comptes et la Présidente ont été notifiés');
  });
}

/** 2. Chaque rôle requis autorise ou refuse. Quand tous ont autorisé, la Trésorière est notifiée. */
export async function decideAdjustment(id: string, fd: FormData) {
  await act(BACK, async () => {
    const me = await requireAction('balance.approve');
    const decision = fd.get('decision') === 'APPROVED' ? 'APPROVED' : 'REJECTED';
    const comment = String(fd.get('comment') ?? '').trim();
    if (decision === 'REJECTED' && !comment) throw new AppError('Un motif est obligatoire pour refuser.');
    let msg = '';
    await db.$transaction(async (tx) => {
      const adj = await tx.balanceAdjustment.findUnique({ where: { id }, include: { account: true, approvals: true } });
      if (!adj) throw new AppError('Demande introuvable.');
      if (adj.status !== 'PENDING') throw new AppError('Cette demande n’est plus en attente d’autorisation.');
      if (adj.requestedById === me.id) throw new AppError('Vous ne pouvez pas autoriser votre propre demande.');
      const mine = adj.approvals.find((a) => a.roleId === me.roleId);
      if (!mine) throw new AppError('Votre rôle n’est pas concerné par cette demande.');
      if (mine.decision !== 'PENDING') throw new AppError('Votre rôle a déjà donné sa décision.');
      await tx.balanceAdjustmentApproval.update({ where: { id: mine.id }, data: { decision, comment: comment || null, approverId: me.id, decidedAt: new Date() } });
      const all = adj.approvals.map((a) => (a.id === mine.id ? decision : a.decision));
      const outcome = adjustmentOutcome(all);
      const done = all.filter((d) => d === 'APPROVED').length;
      await audit({ userId: me.id, action: decision === 'APPROVED' ? 'BALANCE_ADJ_APPROVE' : 'BALANCE_ADJ_REJECT', entity: 'BalanceAdjustment', entityId: id,
        before: { status: adj.status }, after: { status: outcome, role: mine.roleName, autorisations: `${done}/${all.length}` }, reason: comment || null }, tx);
      if (outcome === 'APPROVED') {
        await tx.balanceAdjustment.update({ where: { id }, data: { status: 'APPROVED', decidedAt: new Date() } });
        await notifyPerm(tx, 'balance.apply', { title: 'Modification de solde autorisée : vous pouvez l’appliquer',
          body: `${adj.account.name} : ${mad(adj.currentBalance)} → ${mad(adj.newBalance)}. Toutes les autorisations sont réunies.`, link: BACK });
        await notifyUsers(tx, [adj.requestedById], { title: 'Modification de solde autorisée', body: `${adj.account.name} : vous pouvez maintenant l’appliquer.`, link: BACK });
        msg = 'Autorisation enregistrée : toutes les autorisations sont réunies, la Trésorière est notifiée';
      } else if (outcome === 'REJECTED') {
        await tx.balanceAdjustment.update({ where: { id }, data: { status: 'REJECTED', decidedAt: new Date() } });
        await notifyUsers(tx, [adj.requestedById], { title: 'Modification de solde refusée', body: `${adj.account.name} — ${mine.roleName} : ${comment}`, link: BACK });
        msg = 'Demande refusée';
      } else {
        await notifyUsers(tx, [adj.requestedById], { title: 'Modification de solde : une autorisation donnée', body: `${adj.account.name} — ${mine.roleName} a autorisé (${done}/${all.length}).`, link: BACK });
        msg = `Autorisation enregistrée (${done}/${all.length}) : en attente des autres rôles`;
      }
    });
    revalidatePath('/', 'layout');
    return ok(BACK, msg);
  });
}

/** 3. La Trésorière applique la modification une fois toutes les autorisations réunies. */
export async function applyAdjustment(id: string) {
  await act(BACK, async () => {
    const me = await requireAction('balance.apply');
    forbidAuditor(me);
    await db.$transaction(async (tx) => {
      const adj = await tx.balanceAdjustment.findUnique({ where: { id }, include: { account: true, approvals: true } });
      if (!adj) throw new AppError('Demande introuvable.');
      if (adj.status !== 'APPROVED') throw new AppError('Seule une modification autorisée par tous les rôles requis peut être appliquée.');
      if (adj.approvals.some((a) => a.decision !== 'APPROVED')) throw new AppError('Autorisations incomplètes.');
      const cur = (await accountBalances()).find((a) => a.id === adj.accountId);
      if (!cur) throw new AppError('Compte introuvable ou inactif.');
      if (Math.abs(cur.balance - num(adj.currentBalance)) > 0.005) {
        throw new AppError(`Le solde de « ${adj.account.name} » a changé depuis la demande (${mad(adj.currentBalance)} → ${mad(cur.balance)}) : annulez cette demande et refaites-en une.`);
      }
      const delta = num(adj.delta);
      const opening = round(num(adj.account.openingBalance) + delta);
      await tx.account.update({ where: { id: adj.accountId }, data: { openingBalance: opening } });
      await tx.balanceAdjustment.update({ where: { id }, data: { status: 'APPLIED', appliedById: me.id, appliedAt: new Date() } });
      await audit({ userId: me.id, action: 'BALANCE_ADJ_APPLY', entity: 'BalanceAdjustment', entityId: id,
        before: { account: adj.account.name, soldeInitial: num(adj.account.openingBalance), solde: cur.balance },
        after: { soldeInitial: opening, solde: num(adj.newBalance), ecart: delta }, reason: adj.reason }, tx);
      await audit({ userId: me.id, action: 'ACCOUNT_OPENING_BALANCE', entity: 'Account', entityId: adj.accountId,
        before: { openingBalance: num(adj.account.openingBalance) }, after: { openingBalance: opening }, reason: `Ajustement ${id}` }, tx);
      const approvers = adj.approvals.map((a) => a.approverId).filter((x): x is string => !!x);
      await notifyUsers(tx, approvers, { title: 'Modification de solde appliquée', body: `${adj.account.name} : ${mad(adj.currentBalance)} → ${mad(adj.newBalance)}`, link: BACK });
    });
    revalidatePath('/', 'layout');
    return ok(BACK, 'Solde modifié');
  });
}

export async function cancelAdjustment(id: string, fd: FormData) {
  await act(BACK, async () => {
    const me = await requireAction('balance.request');
    forbidAuditor(me);
    const reason = String(fd.get('reason') ?? '').trim();
    if (reason.length < 5) throw new AppError('Motif d’annulation obligatoire (5 caractères min.).');
    await db.$transaction(async (tx) => {
      const adj = await tx.balanceAdjustment.findUnique({ where: { id }, include: { account: true, approvals: true } });
      if (!adj) throw new AppError('Demande introuvable.');
      if (adj.status !== 'PENDING' && adj.status !== 'APPROVED') throw new AppError('Cette demande ne peut plus être annulée.');
      await tx.balanceAdjustment.update({ where: { id }, data: { status: 'CANCELLED', cancelReason: reason, decidedAt: new Date() } });
      await audit({ userId: me.id, action: 'BALANCE_ADJ_CANCEL', entity: 'BalanceAdjustment', entityId: id, before: { status: adj.status }, after: { status: 'CANCELLED' }, reason }, tx);
      await notifyPerm(tx, 'balance.approve', { title: 'Modification de solde annulée', body: `${adj.account.name} — ${reason}`, link: BACK }, me.id);
    });
    revalidatePath('/', 'layout');
    return ok(BACK, 'Demande annulée');
  });
}
