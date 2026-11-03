import Link from 'next/link';
import { db } from '@/lib/db';
import { mad, dt } from '@/lib/format';
import { Badge, Empty, PageHeader, StatusBadge } from '@/components/ui';
import type { Prisma } from '@prisma/client';

export default async function ToControl({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const { done, min, from, to, noproof } = searchParams;
  const where: Prisma.TransactionWhereInput = {
    status: done ? 'CONTROLLED' : 'PAID',
    ...(min ? { amountMad: { gte: Number(min) } } : {}),
    ...(noproof ? { attachments: { none: {} } } : {}),
    ...(from || to ? { transactionDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + 'T23:59:59') } : {}) } } : {}),
  };
  const rows = await db.transaction.findMany({ where, orderBy: { transactionDate: 'asc' }, take: 200, include: { category: true, activity: true, _count: { select: { attachments: true } } } });
  return (
    <>
      <PageHeader title={done ? 'Opérations contrôlées' : 'Opérations à contrôler'} sub="Lecture globale — le Commissaire aux comptes ne modifie jamais une écriture" />
      <form className="card mb-4 grid gap-3 md:grid-cols-6">
        <select name="done" defaultValue={done ?? ''} className="input"><option value="">À contrôler</option><option value="1">Contrôlées</option></select>
        <input name="min" defaultValue={min} placeholder="Montant min (MAD)" className="input" />
        <input type="date" name="from" defaultValue={from} className="input" /><input type="date" name="to" defaultValue={to} className="input" />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="noproof" value="1" defaultChecked={!!noproof} /> Sans justificatif</label>
        <button className="btn">Filtrer</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="tbl"><thead><tr><th>Réf.</th><th>Date</th><th>Description</th><th>Catégorie / activité</th><th className="text-right">Montant</th><th>Pièces</th><th>Statut</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id} className="hover:bg-slate-50"><td><Link className="font-medium text-brand-700 underline" href={`/depenses/${t.id}`}>{t.reference}</Link></td><td>{dt(t.transactionDate)}</td><td>{t.description}</td>
              <td>{t.category.name}<div className="text-xs text-slate-400">{t.activity?.name}</div></td><td className="text-right">{mad(t.amountMad)}</td>
              <td>{t._count.attachments ? <Badge tone="green">{t._count.attachments}</Badge> : <Badge tone="red">aucune</Badge>}</td><td><StatusBadge status={t.status} /></td></tr>
          ))}</tbody></table>
        {!rows.length && <Empty text="Rien à afficher." />}
      </div>
    </>
  );
}
