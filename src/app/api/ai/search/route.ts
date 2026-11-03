import { getUser } from '@/lib/session';
import { semanticSearch } from '@/lib/semantic';
import { aiEnabled } from '@/lib/ai';
import { mad, dt } from '@/lib/format';

export async function GET(req: Request) {
  const u = await getUser();
  if (!u || !u.perms.has('ai.use') || !u.perms.has('transactions.view')) return Response.json({ error: 'Non autorisé' }, { status: 403 });
  if (!aiEnabled()) return Response.json({ error: 'Module IA non configuré (OPENAI_API_KEY).' }, { status: 503 });
  const q = new URL(req.url).searchParams.get('q')?.trim().slice(0, 300);
  if (!q) return Response.json({ results: [] });
  const r = await semanticSearch(q);
  if (!r) return Response.json({ error: 'Recherche indisponible.' }, { status: 502 });
  return Response.json({ results: r.map(({ t, score }) => ({ id: t.id, reference: t.reference, date: dt(t.transactionDate), montant: mad(t.amountMad), statut: t.status, categorie: t.category.name, description: t.description, score: Math.round(score * 100) / 100 })) });
}
