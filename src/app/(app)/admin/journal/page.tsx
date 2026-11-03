import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { verifyChain } from '@/lib/audit';
import { dtt } from '@/lib/format';
import { Badge } from '@/components/ui';

export default async function Journal({ searchParams }: { searchParams: { entity?: string; action?: string } }) {
  await requirePage('admin.auditlog');
  const [logs, chain] = await Promise.all([
    db.auditLog.findMany({ where: { ...(searchParams.entity ? { entity: searchParams.entity } : {}), ...(searchParams.action ? { action: { contains: searchParams.action } } : {}) }, orderBy: { seq: 'desc' }, take: 200, include: { user: true } }),
    verifyChain(),
  ]);
  return (
    <>
      <div className="mb-4 flex items-center gap-3 text-sm">
        {chain.valid ? <Badge tone="green">Chaîne d’intégrité valide ({chain.count} entrées vérifiées)</Badge> : <Badge tone="red">Chaîne ROMPUE à l’entrée n°{chain.brokenAt}</Badge>}
        <form className="flex gap-2"><input name="entity" defaultValue={searchParams.entity} placeholder="Entité" className="input w-36" /><input name="action" defaultValue={searchParams.action} placeholder="Action" className="input w-36" /><button className="btn-sec">Filtrer</button></form>
      </div>
      <div className="card overflow-x-auto p-0"><table className="tbl"><thead><tr><th>#</th><th>Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th><th>Avant → Après</th><th>Motif</th></tr></thead>
        <tbody>{logs.map((l) => (
          <tr key={l.id}><td>{l.seq}</td><td className="whitespace-nowrap">{dtt(l.createdAt)}</td><td>{l.user?.name ?? 'système'}</td><td><b>{l.action}</b></td><td>{l.entity}<div className="text-xs text-slate-400">{l.entityId}</div></td>
            <td className="max-w-md break-all font-mono text-[11px] text-slate-500">{l.before ? JSON.stringify(l.before).slice(0, 140) : ''}{l.after ? ' → ' + JSON.stringify(l.after).slice(0, 140) : ''}</td><td>{l.reason}</td></tr>
        ))}</tbody></table></div>
    </>
  );
}
