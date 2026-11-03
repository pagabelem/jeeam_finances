import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { scanAnomalies, resolveInsight } from '@/actions/audit';
import { dtt } from '@/lib/format';
import { Badge, Empty, Flash, PageHeader } from '@/components/ui';

export default async function AuditHome({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('audit.view');
  const insights = await db.aiInsight.findMany({ where: { resolved: false }, orderBy: { createdAt: 'desc' }, take: 50, include: { transaction: true } });
  const tone = { INFO: 'blue', WARNING: 'amber', CRITICAL: 'red' } as const;
  return (
    <>
      <PageHeader title="Espace Commissaire aux comptes" sub="Alertes d’audit (détection automatique d’anomalies)"
        actions={user.perms.has('audit.view') && <form action={scanAnomalies}><button className="btn">Lancer l’analyse</button></form>} />
      <Flash {...searchParams} />
      <div className="card">
        {!insights.length && <Empty text="Aucune alerte ouverte." />}
        {insights.map((i) => (
          <div key={i.id} className="flex items-start justify-between gap-4 border-b border-slate-100 py-3 text-sm">
            <div><Badge tone={tone[i.severity]}>{i.title}</Badge> <span className="text-xs text-slate-400">{dtt(i.createdAt)}</span>
              <p className="mt-1 text-slate-700">{i.message}</p>
              {i.transaction && <Link className="text-xs underline" href={`/depenses/${i.transaction.id}`}>Voir {i.transaction.reference}</Link>}</div>
            <form action={resolveInsight.bind(null, i.id)}><button className="btn-sec btn-sm">Traitée</button></form>
          </div>
        ))}
      </div>
    </>
  );
}
