// Fonctions pures de hachage du journal d'audit (sans dépendance à la base : testables).
import crypto from 'node:crypto';

export type HashEntry = { userId?: string | null; action: string; entity: string; entityId?: string | null; reason?: string | null };

// jsonb ne conserve pas l'ordre des clés : on hache une sérialisation canonique (clés triées).
export function canon(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return '{' + Object.keys(o).sort().map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

export function digest(prev: string, e: HashEntry, createdAt: Date, before: unknown, after: unknown) {
  return crypto.createHash('sha256')
    .update([prev, e.action, e.entity, e.entityId ?? '', e.userId ?? '', createdAt.toISOString(),
      canon(before), canon(after), e.reason ?? ''].join('|'))
    .digest('hex');
}
