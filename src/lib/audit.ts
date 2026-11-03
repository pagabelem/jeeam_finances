import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { digest } from '@/lib/hash';

export type AuditEntry = {
  userId?: string | null; action: string; entity: string; entityId?: string | null;
  before?: unknown; after?: unknown; reason?: string | null;
};

const clean = (v: unknown) => (v === undefined || v === null ? undefined : JSON.parse(JSON.stringify(v)));

async function write(tx: Prisma.TransactionClient, e: AuditEntry) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(727001)`; // sérialise la chaîne de hachage
  const last = await tx.auditLog.findFirst({ orderBy: { seq: 'desc' }, select: { hash: true } });
  const prevHash = last?.hash ?? 'GENESIS';
  const createdAt = new Date();
  const before = clean(e.before), after = clean(e.after);
  const hash = digest(prevHash, e, createdAt, before, after);
  await tx.auditLog.create({
    data: { userId: e.userId ?? null, action: e.action, entity: e.entity, entityId: e.entityId ?? null,
      before, after, reason: e.reason ?? null, prevHash, hash, createdAt },
  });
}

/** Écrit une entrée du journal d'audit (chaînée par hash). Passer `tx` pour rester dans la transaction appelante. */
export async function audit(e: AuditEntry, tx?: Prisma.TransactionClient) {
  if (tx) return write(tx, e);
  return db.$transaction((t) => write(t, e));
}

/** Vérifie l'intégrité de la chaîne (affiché dans l'écran du journal). */
export async function verifyChain(limit = 5000) {
  const logs = await db.auditLog.findMany({ orderBy: { seq: 'asc' }, take: limit });
  let prev = 'GENESIS';
  for (const l of logs) {
    const h = digest(prev, { userId: l.userId, action: l.action, entity: l.entity, entityId: l.entityId, reason: l.reason },
      l.createdAt, l.before, l.after);
    if (l.prevHash !== prev || l.hash !== h) return { valid: false, brokenAt: l.seq, count: logs.length };
    prev = l.hash;
  }
  return { valid: true, brokenAt: null as number | null, count: logs.length };
}
