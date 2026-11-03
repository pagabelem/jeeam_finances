import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { mad, dt, iso } from '@/lib/format';
import { Flash, PageHeader, StatusBadge, Tabs, Empty, Badge } from '@/components/ui';
import type { Prisma } from '@prisma/client';
import { TREASURY_TABS } from '@/lib/tabs';

export default async function Treasury({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const user = await requirePage('transactions.view');
  const { type, status, q, from, to, page } = searchParams;
  const where: Prisma.TransactionWhereInput = {
    ...(type === 'INCOME' || type === 'EXPENSE' ? { type } : {}),
    ...(status ? { status: status as never } : {}),
    ...(q ? { OR: [{ reference: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
    ...(from || to ? { transactionDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + 'T23:59:59') } : {}) } } : {}),
  };
  const p = Math.max(1, Number(page) || 1), size = 25;
  const [rows, count] = await Promise.all([
    db.transaction.findMany({ where, orderBy: { transactionDate: 'desc' }, skip: (p - 1) * size, take: size, include: { category: true, account: true, activity: true } }),
    db.transaction.count({ where }),
  ]);
  const qs = (n: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(searchParams).filter(([, v]) => v) as [string, string][]), page: String(n) }).toString();
  return (
    <>
      <PageHeader title="Trésorerie" sub="Journal de toutes les recettes et dépenses" />
      <Flash error={searchParams.error} ok={searchParams.ok} />
      <Tabs items={TREASURY_TABS} current="/tresorerie" />
      <form className="card mb-4 grid gap-3 md:grid-cols-6">
        <input name="q" defaultValue={q} placeholder="Référence, description…" className="input md:col-span-2" />
        <select name="type" defaultValue={type ?? ''} className="input"><option value="">Tous types</option><option value="INCOME">Recettes</option><option value="EXPENSE">Dépenses</option></select>
        <select name="status" defaultValue={status ?? ''} className="input"><option value="">Tous statuts</option>
          {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID', 'CONTROLLED', 'CANCELLED'].map((s) => <option key={s} value={s}>{s}</option>)}</select>
        <input type="date" name="from" defaultValue={from} className="input" /><input type="date" name="to" defaultValue={to} className="input" />
        <button className="btn md:col-span-6 md:w-40">Filtrer</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>Réf.</th><th>Date</th><th>Description</th><th>Catégorie</th><th>Compte</th><th className="text-right">Montant (MAD)</th><th>Statut</th></tr></thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td><Link className="font-medium text-brand-700 underline" href={`/depenses/${t.id}`}>{t.reference}</Link></td>
                <td>{dt(t.transactionDate)}</td>
                <td>{t.description}{t.activity && <div className="text-xs text-slate-400">{t.activity.name}</div>}</td>
                <td>{t.category.name}</td><td>{t.account.name}</td>
                <td className={`text-right font-medium ${t.type === 'INCOME' ? 'text-green-700' : 'text-red-700'}`}>{t.type === 'INCOME' ? '+' : '−'} {mad(t.amountMad)}{t.currency !== 'MAD' && <div className="text-xs text-slate-400">{String(t.amount)} {t.currency}</div>}</td>
                <td><StatusBadge status={t.status} /> {t.aiRiskScore && t.aiRiskScore >= 0.7 ? <Badge tone="red">risque</Badge> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty text="Aucune opération." />}
      </div>
      <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
        <span>{count} opération(s)</span>
        <div className="flex gap-2">
          {p > 1 && <Link className="btn-sec btn-sm" href={`?${qs(p - 1)}`}>Précédent</Link>}
          {p * size < count && <Link className="btn-sec btn-sm" href={`?${qs(p + 1)}`}>Suivant</Link>}
        </div>
      </div>
      <span className="hidden">{iso(new Date())}{user.id}</span>
    </>
  );
}
