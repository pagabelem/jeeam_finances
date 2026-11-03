import { db } from '@/lib/db';
import { getSettingNumber, notifyOnce, usersWithPerm } from '@/lib/domain';
import { mad } from '@/lib/format';

// Rappels planifiés (1×/jour) : Authorization: Bearer $CRON_SECRET
// Chaque rappel est dédoublonné (même titre + lien dans la fenêtre de relance).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });

  const days = (await getSettingNumber('reminderPendingDays', 3)) ?? 3;
  const day = (await getSettingNumber('contributionReminderDay', 5)) ?? 5;
  const ago = (n: number) => new Date(Date.now() - n * 86_400_000);
  const sent = { pending: 0, toPay: 0, toControl: 0, observations: 0, contributions: 0, balance: 0 };

  const [approvers, payers, controllers] = await Promise.all([usersWithPerm(db, 'expenses.approve'), usersWithPerm(db, 'expenses.pay'), usersWithPerm(db, 'audit.control')]);
  // 1. Dépenses en attente d'autorisation
  for (const t of await db.transaction.findMany({ where: { type: 'EXPENSE', status: 'PENDING_APPROVAL', updatedAt: { lt: ago(days) } }, take: 100 })) {
    sent.pending += await notifyOnce(db, approvers.filter((u) => u !== t.createdById), { title: 'Rappel : dépense en attente d’autorisation', body: `${t.reference} — ${mad(t.amountMad)}`, link: `/depenses/${t.id}` }, days);
  }
  // 2. Dépenses autorisées non payées
  for (const t of await db.transaction.findMany({ where: { type: 'EXPENSE', status: 'APPROVED', validatedAt: { lt: ago(days) } }, take: 100 })) {
    sent.toPay += await notifyOnce(db, payers, { title: 'Rappel : dépense autorisée à payer', body: `${t.reference} — ${mad(t.amountMad)}`, link: `/depenses/${t.id}` }, days);
  }
  // 3. Opérations payées non contrôlées
  for (const t of await db.transaction.findMany({ where: { status: 'PAID', updatedAt: { lt: ago(days * 2) } }, take: 100 })) {
    sent.toControl += await notifyOnce(db, controllers, { title: 'Rappel : opération à contrôler', body: `${t.reference} — ${mad(t.amountMad)}`, link: `/depenses/${t.id}` }, days * 2);
  }
  // 4. Observations d'audit sans réponse
  for (const o of await db.auditObservation.findMany({ where: { status: 'OPEN', createdAt: { lt: ago(days) } }, take: 100 })) {
    sent.observations += await notifyOnce(db, [o.assigneeId], { title: 'Rappel : observation d’audit sans réponse', body: o.title, link: '/audit/observations' }, days);
  }
  // 4b. Modifications de solde : approbateurs n'ayant pas répondu / Trésorière à qui il reste à appliquer
  for (const a of await db.balanceAdjustment.findMany({ where: { status: { in: ['PENDING', 'APPROVED'] }, createdAt: { lt: ago(days) } }, include: { account: true, approvals: true }, take: 50 })) {
    const who = a.status === 'PENDING'
      ? (await db.user.findMany({ where: { active: true, roleId: { in: a.approvals.filter((x) => x.decision === 'PENDING').map((x) => x.roleId) } }, select: { id: true } })).map((u) => u.id)
      : await usersWithPerm(db, 'balance.apply');
    sent.balance += await notifyOnce(db, who, { title: a.status === 'PENDING' ? 'Rappel : modification de solde à autoriser' : 'Rappel : modification de solde autorisée à appliquer', body: a.account.name, link: '/tresorerie/ajustements' }, days);
  }
  // 5. Cotisations mensuelles : régions actives sans contribution ce mois-ci (à partir du jour paramétré)
  const now = new Date();
  if (now.getDate() >= day) {
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cats = await db.category.findMany({ where: { type: 'INCOME', name: { in: ['Cotisations', 'Contributions régionales'] } }, select: { id: true } });
    if (cats.length) {
      const got = await db.transaction.findMany({ where: { type: 'INCOME', categoryId: { in: cats.map((c) => c.id) }, regionId: { not: null }, status: { not: 'CANCELLED' }, transactionDate: { gte: monthStart } }, select: { regionId: true } });
      const paid = new Set(got.map((r) => r.regionId));
      const missing = (await db.region.findMany({ where: { active: true } })).filter((r) => !paid.has(r.id));
      if (missing.length) {
        const label = now.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
        sent.contributions = await notifyOnce(db, await usersWithPerm(db, 'income.record'),
          { title: `Rappel : cotisations de ${label} non reçues`, body: `${missing.length} région(s) : ${missing.slice(0, 8).map((r) => r.name).join(', ')}${missing.length > 8 ? '…' : ''}`, link: '/tresorerie' }, 7);
      }
    }
  }
  return Response.json({ ok: true, sent });
}
