import { describe, it, expect } from 'vitest';
import { canon, digest } from '@/lib/hash';

describe('journal d’audit : chaîne de hachage', () => {
  it('sérialisation canonique indépendante de l’ordre des clés', () => {
    expect(canon({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe(canon({ a: { c: [3, { y: 2, z: 1 }], d: 2 }, b: 1 }));
  });
  const d = new Date('2026-01-01T10:00:00Z');
  const e = { action: 'TX_CREATE', entity: 'Transaction', entityId: 'x', userId: 'u' };
  it('le hash dépend du hash précédent (chaînage)', () => {
    expect(digest('GENESIS', e, d, null, { a: 1 })).not.toBe(digest('AUTRE', e, d, null, { a: 1 }));
  });
  it('toute altération change le hash', () => {
    const h = digest('GENESIS', e, d, { a: 1 }, { a: 2 });
    expect(digest('GENESIS', e, d, { a: 1 }, { a: 3 })).not.toBe(h);
    expect(digest('GENESIS', { ...e, userId: 'v' }, d, { a: 1 }, { a: 2 })).not.toBe(h);
    expect(digest('GENESIS', e, new Date('2026-01-01T10:00:01Z'), { a: 1 }, { a: 2 })).not.toBe(h);
    expect(digest('GENESIS', { ...e, reason: 'x' }, d, { a: 1 }, { a: 2 })).not.toBe(h);
  });
  it('déterministe', () => {
    expect(digest('G', e, d, null, { a: [1, 2] })).toBe(digest('G', e, d, null, { a: [1, 2] }));
  });
});
