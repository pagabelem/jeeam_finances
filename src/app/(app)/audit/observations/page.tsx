import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { advanceObservation, openObservation, respondObservation } from '@/actions/audit';
import { deleteObservation } from '@/actions/delete';
import { DeleteBox } from '@/components/delete-box';
import { dt, OBS_LABEL } from '@/lib/format';
import { Badge, Empty, Field, Flash, PageHeader } from '@/components/ui';
import Link from 'next/link';

export default async function Observations({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('audit.view');
  const [list, users] = await Promise.all([
    db.auditObservation.findMany({ orderBy: { createdAt: 'desc' }, include: { raisedBy: true, assignee: true, transaction: true } }),
    db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ]);
  const canObserve = user.perms.has('audit.observe');
  return (
    <>
      <PageHeader title="Observations d’audit" sub="Ouverte → Réponse fournie → Vérifiée → Clôturée" />
      <Flash {...searchParams} />
      {canObserve && (
        <form action={openObservation} className="card mb-6 grid gap-3 md:grid-cols-3">
          <Field label="Titre"><input name="title" required className="input" /></Field>
          <Field label="Destinataire"><select name="assigneeId" className="input">{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
          <div className="flex items-end"><button className="btn w-full">Ouvrir une observation</button></div>
          <div className="md:col-span-3"><Field label="Constat"><textarea name="description" required rows={2} className="input" /></Field></div>
        </form>
      )}
      {!list.length && <div className="card"><Empty text="Aucune observation." /></div>}
      {list.map((o) => (
        <div key={o.id} className="card mb-3">
          <div className="flex items-start justify-between"><div><b>{o.title}</b><div className="text-xs text-slate-400">
            {o.raisedBy.name} → {o.assignee.name} · {dt(o.createdAt)}{o.transaction && <> · <Link className="underline" href={`/depenses/${o.transaction.id}`}>{o.transaction.reference}</Link></>}</div></div>
            <Badge tone={o.status === 'CLOSED' ? 'green' : o.status === 'OPEN' ? 'red' : 'amber'}>{OBS_LABEL[o.status]}</Badge></div>
          <p className="mt-2 text-sm text-slate-700">{o.description}</p>
          {o.response && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm">Réponse : {o.response}</p>}
          {o.status === 'OPEN' && (o.assigneeId === user.id || user.perms.has('observations.respond')) && (
            <form action={respondObservation.bind(null, o.id)} className="mt-3 flex gap-2"><input name="response" required placeholder="Votre réponse…" className="input" /><button className="btn">Répondre</button></form>
          )}
          {canObserve && o.status === 'RESPONDED' && <form action={advanceObservation.bind(null, o.id, 'VERIFIED')} className="mt-3"><button className="btn">Marquer comme vérifiée</button></form>}
          {user.perms.has('data.delete') && <div className="mt-3"><DeleteBox action={deleteObservation.bind(null, o.id)} label="Supprimer l’observation" /></div>}
          {canObserve && o.status === 'VERIFIED' && <form action={advanceObservation.bind(null, o.id, 'CLOSED')} className="mt-3"><button className="btn">Clôturer</button></form>}
        </div>
      ))}
    </>
  );
}