import type { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { verifyChain } from '@/lib/audit';
import { purgeAuditLogs } from '@/actions/delete';
import { dtt } from '@/lib/format';
import { Badge, Flash } from '@/components/ui';

type SP = { entity?: string; action?: string; user?: string; from?: string; to?: string; error?: string; ok?: string };

export default async function Journal({ searchParams: sp }: { searchParams: SP }) {
  const me = await requirePage(['admin.auditlog', 'audit.purge']);
  const canPurge = me.perms.has('audit.purge');
  const where: Prisma.AuditLogWhereInput = {
    ...(sp.entity ? { entity: sp.entity } : {}), ...(sp.action ? { action: { contains: sp.action } } : {}), ...(sp.user ? { userId: sp.user } : {}),
    ...(sp.from || sp.to ? { createdAt: { ...(sp.from ? { gte: new Date(sp.from + 'T00:00:00') } : {}), ...(sp.to ? { lte: new Date(sp.to + 'T23:59:59.999') } : {}) } } : {}),
  };
  const [logs, total, matching, chain, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { seq: 'desc' }, take: 200, include: { user: true } }),
    db.auditLog.count(),
    db.auditLog.count({ where }),
    verifyChain(),
    db.user.findMany({ orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ]);
  const filtered = !!(sp.entity || sp.action || sp.user || sp.from || sp.to);
  return (
    <>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="mb-4 space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          {chain.valid ? <Badge tone="green">Chaîne d’intégrité valide ({chain.count} entrées vérifiées)</Badge> : <Badge tone="red">Chaîne ROMPUE à l’entrée n°{chain.brokenAt}</Badge>}
          <span className="text-slate-500">{total} entrée(s) au total · {matching} correspondant au filtre</span>
        </div>
        <form className="flex flex-wrap items-end gap-2">
          <input name="entity" defaultValue={sp.entity} placeholder="Entité (ex. Transaction)" className="input w-44" />
          <input name="action" defaultValue={sp.action} placeholder="Action (ex. TX_PAY)" className="input w-40" />
          <select name="user" defaultValue={sp.user ?? ''} className="input w-44"><option value="">Tous les utilisateurs</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <div><label className="label">Du</label><input type="date" name="from" defaultValue={sp.from} className="input" /></div>
          <div><label className="label">Au</label><input type="date" name="to" defaultValue={sp.to} className="input" /></div>
          <button className="btn-sec">Filtrer</button>
        </form>
      </div>

      <form action={purgeAuditLogs}>
        {/* critères actuels, repris par la suppression « par critère » */}
        <input type="hidden" name="f_entity" value={sp.entity ?? ''} /><input type="hidden" name="f_action" value={sp.action ?? ''} /><input type="hidden" name="f_user" value={sp.user ?? ''} />
        <input type="hidden" name="f_from" value={sp.from ?? ''} /><input type="hidden" name="f_to" value={sp.to ?? ''} />

        <div className="card mb-4 overflow-x-auto p-0"><table className="tbl">
          <thead><tr>{canPurge && <th></th>}<th>#</th><th>Date</th><th>Utilisateur</th><th>Action</th><th>Entité</th><th>Avant → Après</th><th>Motif</th></tr></thead>
          <tbody>{logs.map((l) => (
            <tr key={l.id}>{canPurge && <td><input type="checkbox" name="ids" value={l.id} aria-label={`Sélectionner l’entrée ${l.seq}`} /></td>}
              <td>{l.seq}</td><td className="whitespace-nowrap">{dtt(l.createdAt)}</td><td>{l.user?.name ?? 'système'}</td><td><b>{l.action}</b></td>
              <td>{l.entity}<div className="text-xs text-slate-400">{l.entityId?.slice(0, 10)}</div></td>
              <td className="max-w-md break-all font-mono text-[11px] text-slate-500">{l.before ? JSON.stringify(l.before).slice(0, 140) : ''}{l.after ? ' → ' + JSON.stringify(l.after).slice(0, 140) : ''}</td>
              <td className="text-xs">{l.reason}</td></tr>
          ))}</tbody></table>
          {matching > 200 && <p className="p-3 text-xs text-slate-500">Affichage des 200 entrées les plus récentes sur {matching}. La suppression « par critère » concerne les {matching} entrées.</p>}
        </div>

        {canPurge && (
          <div className="card space-y-3 border-red-200">
            <h2 className="font-semibold text-red-700">Supprimer des entrées du journal</h2>
            <p className="text-xs text-slate-500">La suppression est définitive. Elle est inscrite dans le registre des suppressions (inaltérable) et la chaîne d’intégrité est re-scellée.</p>
            <div className="space-y-1 text-sm">
              <label className="flex items-center gap-2"><input type="radio" name="purgeMode" value="selection" /> Uniquement les entrées cochées ci-dessus (suppression individuelle)</label>
              <label className="flex items-center gap-2"><input type="radio" name="purgeMode" value="filter" disabled={!filtered} /> Toutes les entrées correspondant au filtre actuel ({filtered ? matching : 'aucun filtre appliqué'})</label>
              <label className="flex items-center gap-2"><input type="radio" name="purgeMode" value="all" /> <b className="text-red-700">Tout supprimer</b> ({total} entrées)</label>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <input name="reason" required minLength={5} placeholder="Motif (obligatoire)" className="input" />
              <input name="confirm" required autoComplete="off" placeholder="Tapez SUPPRIMER" className="input" />
              <input name="password" type="password" required autoComplete="current-password" placeholder="Votre mot de passe" className="input" />
            </div>
            <button className="btn-danger" formNoValidate={false}>Supprimer</button>
          </div>
        )}
      </form>
    </>
  );
}