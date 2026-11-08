// Outils communs des suppressions. Toute suppression : permission + motif + confirmation tapée, puis inscription
// au registre inaltérable (DeletionRecord) ET au journal d'audit. Les triggers SQL ne laissent passer que ces suppressions.
import type { Prisma } from '@prisma/client';
import { AppError } from '@/lib/errors';
import { assertPeriodOpen } from '@/lib/domain';
import { audit } from '@/lib/audit';

export type Tx = Prisma.TransactionClient;

/** Lève la protection SQL pour la transaction en cours uniquement (set_config local). */
export const allowDelete = async (tx: Tx) => { await tx.$queryRaw`SELECT set_config('jeeam.allow_delete', 'on', true)`; };

export function checkConfirm(fd: FormData) {
  const reason = String(fd.get('reason') ?? '').trim();
  if (reason.length < 5) throw new AppError('Motif de suppression obligatoire (5 caractères min.).');
  if (String(fd.get('confirm') ?? '').trim().toUpperCase() !== 'SUPPRIMER') throw new AppError('Pour confirmer, tapez SUPPRIMER.');
  return reason;
}

export const plain = <T>(v: T): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null));

export async function record(tx: Tx, user: { id: string; name: string }, r: { entity: string; entityId?: string; label: string; reason: string; count?: number; snapshot?: unknown }) {
  await tx.deletionRecord.create({ data: { userId: user.id, userName: user.name, entity: r.entity, entityId: r.entityId, label: r.label, reason: r.reason, count: r.count ?? 1, snapshot: plain(r.snapshot) } });
  await audit({ userId: user.id, action: 'DELETE_' + r.entity.toUpperCase(), entity: r.entity, entityId: r.entityId, before: { label: r.label, count: r.count ?? 1 }, reason: r.reason }, tx);
}

/** Supprime des opérations et tout ce qui en dépend. Retourne les clés des fichiers à effacer du stockage (après validation de la transaction). */
export async function purgeTransactions(tx: Tx, ids: string[]) {
  if (!ids.length) return { keys: [] as string[], snapshot: [] as unknown[] };
  const rows = await tx.transaction.findMany({ where: { id: { in: ids } }, include: { attachments: { select: { storageKey: true, fileName: true } } } });
  for (const t of rows) await assertPeriodOpen(t.transactionDate, tx); // une période verrouillée par le CAC protège ses opérations
  const keys = rows.flatMap((t) => t.attachments.map((a) => a.storageKey));
  await tx.approval.deleteMany({ where: { transactionId: { in: ids } } });
  await tx.attachment.deleteMany({ where: { transactionId: { in: ids } } });
  await tx.aiInsight.deleteMany({ where: { transactionId: { in: ids } } });
  await tx.txEmbedding.deleteMany({ where: { transactionId: { in: ids } } });
  await tx.auditObservation.updateMany({ where: { transactionId: { in: ids } }, data: { transactionId: null } });
  await tx.transaction.deleteMany({ where: { id: { in: ids } } });
  return { keys, snapshot: rows.map((t) => ({ reference: t.reference, type: t.type, statut: t.status, montantMad: Number(t.amountMad), date: t.transactionDate, description: t.description, fichiers: t.attachments.map((a) => a.fileName) })) };
}