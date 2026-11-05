import { db } from '@/lib/db';
import { getUser } from '@/lib/session';
import { audit } from '@/lib/audit';
import { assertPeriodOpen, nextReference } from '@/lib/domain';
import { AppError } from '@/lib/errors';
import { mad, num, dt } from '@/lib/format';
import { semanticSearch } from '@/lib/semantic';

type Msg = { role: 'user' | 'assistant' | 'system' | 'tool'; content: string | null; tool_calls?: unknown; tool_call_id?: string };

const TOOLS = [
  { type: 'function', function: { name: 'search_transactions', description: 'Recherche des opérations (lecture seule).', parameters: { type: 'object', properties: {
    type: { type: 'string', enum: ['INCOME', 'EXPENSE'] }, minAmountMad: { type: 'number' }, withoutAttachment: { type: 'boolean' },
    status: { type: 'string', enum: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CONTROLLED', 'CANCELLED'] },
    from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'semantic_search', description: 'Recherche par le sens (ex. « frais de déplacement pour la rencontre de Rabat ») dans les descriptions des opérations. Lecture seule.', parameters: { type: 'object', required: ['query'], properties: { query: { type: 'string' }, limit: { type: 'number' } } } } },
  { type: 'function', function: { name: 'financial_summary', description: 'Totaux recettes/dépenses, soldes et indicateurs pour une période.', parameters: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } } } },
  { type: 'function', function: { name: 'create_expense_draft', description: 'Crée un BROUILLON de dépense (jamais validé ni soumis). L’utilisateur devra le vérifier et le soumettre.', parameters: { type: 'object', required: ['amountMad', 'categoryName', 'description'], properties: {
    amountMad: { type: 'number' }, categoryName: { type: 'string' }, description: { type: 'string' }, activityName: { type: 'string' }, date: { type: 'string' } } } } },
];

async function runTool(name: string, args: Record<string, unknown>, user: NonNullable<Awaited<ReturnType<typeof getUser>>>) {
  if (name === 'search_transactions') {
    if (!user.perms.has('transactions.view')) return { error: 'Permission insuffisante' };
    const rows = await db.transaction.findMany({
      where: { ...(args.type ? { type: args.type as 'INCOME' } : {}), ...(args.status ? { status: args.status as 'PAID' } : {}),
        ...(args.minAmountMad ? { amountMad: { gte: Number(args.minAmountMad) } } : {}), ...(args.withoutAttachment ? { attachments: { none: {} } } : {}),
        ...(args.from || args.to ? { transactionDate: { ...(args.from ? { gte: new Date(String(args.from)) } : {}), ...(args.to ? { lte: new Date(String(args.to) + 'T23:59:59') } : {}) } } : {}) },
      orderBy: { transactionDate: 'desc' }, take: Math.min(Number(args.limit) || 20, 50), include: { category: true, activity: true },
    });
    return rows.map((t) => ({ ref: t.reference, date: dt(t.transactionDate), type: t.type, montant: mad(t.amountMad), statut: t.status, categorie: t.category.name, activite: t.activity?.name, description: t.description }));
  }
  if (name === 'semantic_search') {
    if (!user.perms.has('transactions.view')) return { error: 'Permission insuffisante' };
    const r = await semanticSearch(String(args.query ?? '').slice(0, 300), Math.min(Number(args.limit) || 10, 20));
    if (!r) return { error: 'Recherche sémantique indisponible.' };
    return r.map(({ t, score }) => ({ ref: t.reference, date: dt(t.transactionDate), montant: mad(t.amountMad), statut: t.status, categorie: t.category.name, description: t.description, pertinence: Math.round(score * 100) / 100 }));
  }
  if (name === 'financial_summary') {
    if (!user.perms.has('reports.view')) return { error: 'Permission insuffisante' };
    const from = args.from ? new Date(String(args.from)) : new Date(new Date().getFullYear(), 0, 1);
    const to = args.to ? new Date(String(args.to) + 'T23:59:59') : new Date();
    const [g, pending, noProof] = await Promise.all([
      db.transaction.groupBy({ by: ['type'], where: { status: { in: ['PAID', 'CONTROLLED'] }, transactionDate: { gte: from, lte: to } }, _sum: { amountMad: true } }),
      db.transaction.count({ where: { status: 'PENDING_APPROVAL' } }),
      db.transaction.count({ where: { type: 'EXPENSE', status: { in: ['PAID', 'CONTROLLED'] }, attachments: { none: {} } } }),
    ]);
    const s = (t: string) => num(g.find((x) => x.type === t)?._sum.amountMad);
    return { periode: `${dt(from)} → ${dt(to)}`, recettes: mad(s('INCOME')), depenses: mad(s('EXPENSE')), resultat: mad(s('INCOME') - s('EXPENSE')), depensesEnAttente: pending, depensesSansJustificatif: noProof };
  }
  if (name === 'create_expense_draft') {
    if (!user.perms.has('expenses.request')) return { error: 'Vous n’avez pas le droit de créer des dépenses.' };
    const cat = await db.category.findFirst({ where: { type: 'EXPENSE', active: true, name: { contains: String(args.categoryName), mode: 'insensitive' } } });
    if (!cat) return { error: `Catégorie « ${args.categoryName} » introuvable.` };
    const acc = await db.account.findFirst({ where: { active: true }, orderBy: { name: 'asc' } });
    if (!acc) return { error: 'Aucun compte actif.' };
    const act = args.activityName ? await db.activity.findFirst({ where: { name: { contains: String(args.activityName), mode: 'insensitive' } } }) : null;
    const date = args.date ? new Date(String(args.date)) : new Date();
    const amount = Number(args.amountMad);
    if (!(amount > 0)) return { error: 'Montant invalide.' };
    try {
      const t = await db.$transaction(async (tx) => {
        await assertPeriodOpen(date, tx);
        const t = await tx.transaction.create({ data: { reference: await nextReference(tx, date), type: 'EXPENSE', amount, amountMad: amount, transactionDate: date,
          description: String(args.description).slice(0, 500), categoryId: cat.id, accountId: acc.id, activityId: act?.id, createdById: user.id, status: 'DRAFT', aiCategory: cat.name } });
        await audit({ userId: user.id, action: 'TX_CREATE_AI_DRAFT', entity: 'Transaction', entityId: t.id, after: t }, tx);
        return t;
      });
      return { ok: true, reference: t.reference, note: `Brouillon créé sur le compte « ${acc.name} » : à vérifier et soumettre depuis /depenses/${t.id}.` };
    } catch (e) { return { error: e instanceof AppError ? e.message : 'Erreur' }; }
  }
  return { error: 'Outil inconnu' };
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user || !user.perms.has('ai.use')) return Response.json({ error: 'Non autorisé' }, { status: 403 });
  const key = process.env.OPENAI_API_KEY;
  if (!key) return Response.json({ reply: 'Le module IA n’est pas configuré : renseignez OPENAI_API_KEY dans .env.' });
  const body = await req.json().catch(() => ({}));
  const history: Msg[] = (Array.isArray(body.messages) ? body.messages : []).slice(-20)
    .filter((m: Msg) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .map((m: Msg) => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  const messages: Msg[] = [{ role: 'system', content: `Tu es l’assistant financier de JEEAM Finance (Bureau National, devise MAD). Utilisateur : ${user.name}, rôle ${user.roleName}. ` +
    'Réponds en français, de façon concise. Appuie-toi UNIQUEMENT sur les résultats des outils pour les chiffres ; n’invente jamais de données. ' +
    'Tu ne valides, n’autorises ni ne paies jamais rien : tu ne peux créer que des brouillons. Rappelle que le contrôle humain reste décisif.' }, ...history];

  for (let i = 0; i < 5; i++) {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini', messages, tools: TOOLS, tool_choice: 'auto' }),
    });
    if (!r.ok) return Response.json({ reply: `Erreur du service IA (${r.status}).` });
    const msg = (await r.json()).choices?.[0]?.message;
    if (!msg) return Response.json({ reply: 'Réponse vide.' });
    if (!msg.tool_calls?.length) return Response.json({ reply: msg.content ?? '' });
    messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const c of msg.tool_calls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(c.function.arguments || '{}'); } catch { /* arguments invalides */ }
      const result = await runTool(c.function.name, args, user);
      await audit({ userId: user.id, action: 'AI_TOOL:' + c.function.name, entity: 'AI', after: { args } });
      messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
  return Response.json({ reply: 'Je n’ai pas pu terminer la requête (trop d’étapes).' });
}