// Détection d'anomalies (règles statistiques). Chaque anomalie crée une alerte d'audit en langage clair.
// Le module GPT peut enrichir l'explication (voir /api/ai/chat) ; les règles ci-dessous fonctionnent sans IA.
import { db } from '@/lib/db';
import { mad, num } from '@/lib/format';
import { notifyPerm } from '@/lib/domain';

type NewInsight = { kind: string; severity: 'INFO' | 'WARNING' | 'CRITICAL'; title: string; message: string; transactionId?: string };

export async function runAnomalyScan() {
  const since = new Date(Date.now() - 400 * 86400_000);
  const txs = await db.transaction.findMany({
    where: { transactionDate: { gte: since }, status: { notIn: ['CANCELLED', 'REJECTED'] } },
    include: { attachments: { select: { id: true } }, category: true },
  });
  const found: NewInsight[] = [];
  const risk = new Map<string, number>();
  const bump = (id: string, v: number) => risk.set(id, Math.max(risk.get(id) ?? 0, v));
  const expenses = txs.filter((t) => t.type === 'EXPENSE');

  // 1. Doublons potentiels : même montant, même catégorie, même compte, à ≤ 3 jours.
  for (let i = 0; i < expenses.length; i++) for (let j = i + 1; j < expenses.length; j++) {
    const a = expenses[i], b = expenses[j];
    if (a.categoryId === b.categoryId && a.accountId === b.accountId && num(a.amountMad) === num(b.amountMad) &&
      Math.abs(+a.transactionDate - +b.transactionDate) <= 3 * 86400_000) {
      found.push({ kind: 'DUPLICATE', severity: 'WARNING', transactionId: b.id, title: 'Doublon potentiel',
        message: `${b.reference} a le même montant (${mad(b.amountMad)}), la même catégorie et le même compte que ${a.reference}, à moins de 3 jours d’écart.` });
      bump(a.id, 0.6); bump(b.id, 0.7);
    }
  }

  // 2. Montant inhabituel dans sa catégorie (> moyenne + 3 écarts-types, au moins 5 observations).
  const byCat = new Map<string, typeof expenses>();
  for (const t of expenses) byCat.set(t.categoryId, [...(byCat.get(t.categoryId) ?? []), t]);
  for (const list of byCat.values()) {
    if (list.length < 5) continue;
    const xs = list.map((t) => num(t.amountMad));
    const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length);
    for (const t of list) if (sd > 0 && num(t.amountMad) > mean + 3 * sd) {
      found.push({ kind: 'OUTLIER', severity: 'WARNING', transactionId: t.id, title: 'Montant inhabituel',
        message: `${t.reference} (${mad(t.amountMad)}) dépasse nettement la moyenne de la catégorie « ${t.category.name} » (${mad(mean)}).` });
      bump(t.id, 0.8);
    }
  }

  // 3. Dépenses payées depuis plus de 7 jours sans justificatif définitif.
  const limit = Date.now() - 7 * 86400_000;
  for (const t of expenses) {
    const hasFinal = t.attachments.length > 0;
    if (['PAID'].includes(t.status) && !hasFinal && t.paidAt && +t.paidAt < limit) {
      found.push({ kind: 'NO_RECEIPT', severity: 'CRITICAL', transactionId: t.id, title: 'Justificatif manquant',
        message: `${t.reference} (${mad(t.amountMad)}) est payée depuis plus de 7 jours sans aucune pièce justificative.` });
      bump(t.id, 0.9);
    }
  }

  // 4. Dépassements budgétaires > 10 %, par activité ET par catégorie : les dépenses d'une catégorie sont comparées
  //    au TOTAL prévu de toutes les lignes budgétaires de cette catégorie (plusieurs lignes, ex. Hébergement + Transport,
  //    peuvent partager une même catégorie : on ne compare jamais le total dépensé à une seule ligne).
  const lines = await db.budgetLine.findMany({ where: { categoryId: { not: null } }, include: { budget: { include: { activity: true } }, category: true } });
  const groups = new Map<string, { activity: string; category: string; activityId: string; categoryId: string; plan: number; labels: string[] }>();
  for (const l of lines) {
    const k = `${l.budget.activityId}:${l.categoryId}`;
    const g = groups.get(k) ?? { activity: l.budget.activity.name, category: l.category?.name ?? '', activityId: l.budget.activityId, categoryId: l.categoryId!, plan: 0, labels: [] };
    g.plan += num(l.planned); g.labels.push(l.label);
    groups.set(k, g);
  }
  const stillOver = new Set<string>();
  for (const [k, g] of Array.from(groups)) {
    const agg = await db.transaction.aggregate({ _sum: { amountMad: true },
      where: { activityId: g.activityId, categoryId: g.categoryId, type: 'EXPENSE', status: { in: ['APPROVED', 'PAID', 'CONTROLLED'] } } });
    const real = num(agg._sum.amountMad);
    if (g.plan > 0 && real > g.plan * 1.1) {
      const kind = 'BUDGET_OVER:' + k;
      stillOver.add(kind);
      found.push({ kind, severity: 'WARNING', title: 'Écart budgétaire',
        message: `Activité « ${g.activity} », catégorie « ${g.category} » (lignes : ${g.labels.join(', ')}) : ${mad(real)} dépensés pour ${mad(g.plan)} prévus au total (+${Math.round((real / g.plan - 1) * 100)} %).` });
    }
  }
  // Les anciennes alertes budgétaires (par ligne, ou qui ne se justifient plus) sont clôturées automatiquement.
  const open = await db.aiInsight.findMany({ where: { kind: { startsWith: 'BUDGET_OVER:' }, resolved: false }, select: { id: true, kind: true } });
  const stale = open.filter((i) => !stillOver.has(i.kind)).map((i) => i.id);
  if (stale.length) await db.aiInsight.updateMany({ where: { id: { in: stale } }, data: { resolved: true } });

  // Enregistrement sans doublonner les alertes déjà ouvertes.
  let created = 0;
  for (const f of found) {
    const exists = await db.aiInsight.findFirst({ where: { kind: f.kind, transactionId: f.transactionId ?? null, resolved: false } });
    if (exists) continue;
    await db.aiInsight.create({ data: f });
    created++;
  }
  for (const [id, score] of risk) await db.transaction.update({ where: { id }, data: { aiRiskScore: score } });
  if (created) await notifyPerm(db, 'audit.view', { title: 'Nouvelles alertes d’audit', body: `${created} anomalie(s) détectée(s).`, link: '/audit' });
  return { scanned: txs.length, created };
}