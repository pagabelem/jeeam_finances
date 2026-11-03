import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { mad, num, iso } from '@/lib/format';
import { Flash, PageHeader, Stat, Empty } from '@/components/ui';
import { PrintButton } from '@/components/client';

export default async function Reports({ searchParams }: { searchParams: { from?: string; to?: string; error?: string } }) {
  await requirePage('reports.view');
  const now = new Date();
  const from = searchParams.from ? new Date(searchParams.from) : new Date(now.getFullYear(), now.getMonth(), 1);
  const to = searchParams.to ? new Date(searchParams.to + 'T23:59:59') : now;
  const valid = { status: { in: ['PAID', 'CONTROLLED'] as ('PAID' | 'CONTROLLED')[] } };
  const [opening, inPeriod, byCat, byAct, byRegion, missing, obs, cats, acts, regions, accounts] = await Promise.all([
    db.transaction.groupBy({ by: ['type'], where: { ...valid, transactionDate: { lt: from } }, _sum: { amountMad: true } }),
    db.transaction.groupBy({ by: ['type'], where: { ...valid, transactionDate: { gte: from, lte: to } }, _sum: { amountMad: true } }),
    db.transaction.groupBy({ by: ['categoryId', 'type'], where: { ...valid, transactionDate: { gte: from, lte: to } }, _sum: { amountMad: true } }),
    db.transaction.groupBy({ by: ['activityId', 'type'], where: { ...valid, activityId: { not: null }, transactionDate: { gte: from, lte: to } }, _sum: { amountMad: true } }),
    db.transaction.groupBy({ by: ['regionId'], where: { ...valid, type: 'INCOME', regionId: { not: null }, transactionDate: { gte: from, lte: to } }, _sum: { amountMad: true } }),
    db.transaction.findMany({ where: { ...valid, type: 'EXPENSE', attachments: { none: {} }, transactionDate: { gte: from, lte: to } }, select: { id: true, reference: true, description: true, amountMad: true } }),
    db.auditObservation.groupBy({ by: ['status'], _count: true }),
    db.category.findMany(), db.activity.findMany(), db.region.findMany(), db.account.aggregate({ _sum: { openingBalance: true } }),
  ]);
  const s = (rows: { type: string; _sum: { amountMad: unknown } }[], t: string) => num(rows.find((r) => r.type === t)?._sum.amountMad);
  const open = num(accounts._sum.openingBalance) + s(opening, 'INCOME') - s(opening, 'EXPENSE');
  const inc = s(inPeriod, 'INCOME'), exp = s(inPeriod, 'EXPENSE');
  const q = `from=${iso(from)}&to=${iso(to)}`;
  return (
    <>
      <PageHeader title="Rapports financiers" sub="Opérations payées / contrôlées sur la période" actions={<><PrintButton />
        <Link className="btn-sec" href={`/api/export?report=transactions&format=pdf&${q}`}>PDF (serveur)</Link><Link className="btn-sec" href={`/api/export?report=transactions&format=xlsx&${q}`}>Excel</Link><Link className="btn-sec" href={`/api/export?report=transactions&format=csv&${q}`}>CSV</Link></>} />
      <Flash error={searchParams.error} />
      <form className="card no-print mb-6 flex flex-wrap items-end gap-3">
        <div><label className="label">Du</label><input type="date" name="from" defaultValue={iso(from)} className="input" /></div>
        <div><label className="label">Au</label><input type="date" name="to" defaultValue={iso(to)} className="input" /></div>
        <button className="btn">Afficher</button>
      </form>
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat label="Solde initial" value={mad(open)} /><Stat label="Recettes" value={mad(inc)} tone="green" /><Stat label="Dépenses" value={mad(exp)} tone="red" /><Stat label="Solde final" value={mad(open + inc - exp)} />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Block title="Par catégorie">{byCat.map((r) => <Row key={r.categoryId + r.type} l={`${r.type === 'INCOME' ? '＋' : '－'} ${cats.find((c) => c.id === r.categoryId)?.name}`} v={r._sum.amountMad} />)}</Block>
        <Block title="Par activité">{byAct.map((r) => <Row key={r.activityId! + r.type} l={`${r.type === 'INCOME' ? '＋' : '－'} ${acts.find((c) => c.id === r.activityId)?.name}`} v={r._sum.amountMad} />)}</Block>
        <Block title="Contributions par région">{byRegion.map((r) => <Row key={r.regionId!} l={regions.find((c) => c.id === r.regionId)?.name ?? ''} v={r._sum.amountMad} />)}</Block>
        <Block title={`Justificatifs manquants (${missing.length})`}>{missing.map((m) => <Row key={m.id} l={`${m.reference} — ${m.description}`} v={m.amountMad} />)}</Block>
        <Block title="Observations d’audit">{obs.map((o) => <div key={o.status} className="flex justify-between border-b border-slate-100 py-2 text-sm"><span>{o.status}</span><b>{o._count}</b></div>)}</Block>
      </div>
    </>
  );
}
function Block({ title, children }: { title: string; children: React.ReactNode }) {
  const arr = Array.isArray(children) ? children : [children];
  return <div className="card"><h2 className="mb-2 font-semibold">{title}</h2>{arr.length ? children : <Empty text="Aucune donnée." />}</div>;
}
const Row = ({ l, v }: { l: string; v: unknown }) => <div className="flex justify-between border-b border-slate-100 py-2 text-sm"><span>{l}</span><b>{mad(v)}</b></div>;
