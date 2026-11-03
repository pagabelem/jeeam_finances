import { db } from '@/lib/db';
import { getUser } from '@/lib/session';
import { chatJson, suggestFromHistory, aiEnabled } from '@/lib/ai';

// Suggestion de catégorie à la saisie. Ne modifie rien : le formulaire propose, l'utilisateur décide.
export async function POST(req: Request) {
  const u = await getUser();
  if (!u || !(u.perms.has('expenses.request') || u.perms.has('income.record'))) return Response.json({ error: 'Non autorisé' }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const description = String(b.description ?? '').trim().slice(0, 300);
  const type = b.type === 'INCOME' ? 'INCOME' : 'EXPENSE';
  if (description.length < 3) return Response.json({ suggestion: null });
  const [cats, hist] = await Promise.all([
    db.category.findMany({ where: { type, active: true } }),
    db.transaction.findMany({ where: { type, status: { not: 'CANCELLED' } }, orderBy: { createdAt: 'desc' }, take: 400, select: { description: true, categoryId: true } }),
  ]);
  const h = suggestFromHistory(description, hist.filter((x) => cats.some((c) => c.id === x.categoryId)));
  if (aiEnabled()) {
    const examples = hist.slice(0, 25).map((x) => `- ${x.description} → ${cats.find((c) => c.id === x.categoryId)?.name}`).join('\n');
    const r = await chatJson<{ category?: string; confidence?: number }>(
      'Tu classes des opérations d’une association (JEEAM) dans UNE catégorie de la liste fournie. Réponds en JSON : {"category": "<nom exact>", "confidence": <0..1>}. Si aucune ne convient, {"category": null, "confidence": 0}.',
      `Catégories : ${cats.map((c) => c.name).join(' | ')}\nExemples passés :\n${examples}\n\nMontant : ${Number(b.amount) || 'n/a'} MAD\nDescription : ${description}`);
    const c = cats.find((x) => x.name === r?.category);
    if (c) return Response.json({ suggestion: { categoryId: c.id, name: c.name, confidence: Math.min(1, Math.max(0, Number(r?.confidence) || 0.5)), source: 'IA' } });
  }
  const c = h && cats.find((x) => x.id === h.categoryId);
  return Response.json({ suggestion: c && h ? { categoryId: c.id, name: c.name, confidence: h.confidence, source: 'historique' } : null });
}
