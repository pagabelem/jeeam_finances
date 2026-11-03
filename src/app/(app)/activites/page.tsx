import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { mad, num, dt, ACTIVITY_LABEL } from '@/lib/format';
import { Badge, Flash, PageHeader, Empty } from '@/components/ui';

export default async function Activities({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('activities.view');
  const list = await db.activity.findMany({ orderBy: { startDate: 'desc' }, include: { manager: true, region: true, budgets: { include: { lines: true } } } });
  const sums = await db.transaction.groupBy({ by: ['activityId', 'type'], where: { activityId: { not: null }, status: { in: ['APPROVED', 'PAID', 'CONTROLLED'] } }, _sum: { amountMad: true } });
  return (
    <>
      <PageHeader title="Activités nationales" sub="Conventions, retraites, croisades, séminaires, formations, visites régionales"
        actions={user.perms.has('activities.manage') ? <Link href="/activites/nouvelle" className="btn">+ Nouvelle activité</Link> : undefined} />
      <Flash {...searchParams} />
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>Activité</th><th>Dates</th><th>Responsable</th><th className="text-right">Budget</th><th className="text-right">Dépensé</th><th className="text-right">Recettes</th><th>Statut</th></tr></thead>
          <tbody>{list.map((a) => {
            const planned = a.budgets.flatMap((b) => b.lines).reduce((s, l) => s + num(l.planned), 0);
            const g = (type: string) => num(sums.find((s) => s.activityId === a.id && s.type === type)?._sum.amountMad);
            return (
              <tr key={a.id} className="hover:bg-slate-50">
                <td><Link className="font-medium text-brand-700 underline" href={`/activites/${a.id}`}>{a.name}</Link>{a.region && <div className="text-xs text-slate-400">{a.region.name}</div>}</td>
                <td>{dt(a.startDate)} → {dt(a.endDate)}</td><td>{a.manager?.name ?? '—'}</td>
                <td className="text-right">{mad(planned)}</td><td className="text-right">{mad(g('EXPENSE'))}</td><td className="text-right">{mad(g('INCOME'))}</td>
                <td><Badge tone={a.status === 'COMPLETED' ? 'green' : a.status === 'IN_PROGRESS' ? 'blue' : 'gray'}>{ACTIVITY_LABEL[a.status]}</Badge></td>
              </tr>
            );
          })}</tbody>
        </table>
        {!list.length && <Empty text="Aucune activité." />}
      </div>
    </>
  );
}
