import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { markNotificationsRead } from '@/actions/admin';
import { dtt } from '@/lib/format';
import { Empty, PageHeader } from '@/components/ui';

export default async function Notifications() {
  const user = await requirePage();
  const list = await db.notification.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  return (
    <>
      <PageHeader title="Notifications" actions={<form action={markNotificationsRead}><button className="btn-sec">Tout marquer comme lu</button></form>} />
      <div className="card">
        {!list.length && <Empty text="Aucune notification." />}
        {list.map((n) => (
          <div key={n.id} className={`border-b border-slate-100 py-3 text-sm ${n.readAt ? 'opacity-60' : ''}`}>
            <div className="flex justify-between"><b>{n.title}</b><span className="text-xs text-slate-400">{dtt(n.createdAt)}</span></div>
            <p className="text-slate-600">{n.body}</p>{n.link && <Link className="text-xs underline" href={n.link}>Ouvrir</Link>}
          </div>
        ))}
      </div>
    </>
  );
}
