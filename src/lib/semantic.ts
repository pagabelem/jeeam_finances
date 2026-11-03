// Recherche sémantique : embeddings OpenAI stockés en base (Float[]), similarité cosinus calculée côté serveur.
// Adapté à quelques milliers d'opérations ; au-delà, migrer vers pgvector.
import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { embed, cosine, aiEnabled } from '@/lib/ai';

type T = Prisma.TransactionGetPayload<{ include: { category: true; activity: true; region: true } }>;
export const txText = (t: T) =>
  [t.description, `catégorie ${t.category.name}`, t.activity && `activité ${t.activity.name}`, t.region && `région ${t.region.name}`, t.paymentMethod, t.type === 'INCOME' ? 'recette' : 'dépense'].filter(Boolean).join(' · ');

export async function indexMissing(limit = 100) {
  if (!aiEnabled()) return 0;
  const rows = await db.transaction.findMany({ where: { embedding: null }, take: limit, include: { category: true, activity: true, region: true }, orderBy: { createdAt: 'desc' } });
  if (!rows.length) return 0;
  const texts = rows.map(txText);
  const vecs = await embed(texts);
  if (!vecs) return 0;
  const model = process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small';
  await db.$transaction(rows.map((t, i) => db.txEmbedding.upsert({ where: { transactionId: t.id }, update: { text: texts[i], vector: vecs[i], model }, create: { transactionId: t.id, text: texts[i], vector: vecs[i], model } })));
  return rows.length;
}

export async function semanticSearch(query: string, k = 10) {
  await indexMissing(50);
  const q = await embed([query]);
  if (!q) return null;
  const all = await db.txEmbedding.findMany({ include: { transaction: { include: { category: true, activity: true } } } });
  return all.map((e) => ({ t: e.transaction, score: cosine(q[0], e.vector) })).sort((a, b) => b.score - a.score).slice(0, Math.min(k, 30)).filter((x) => x.score > 0.2);
}
