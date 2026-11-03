import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { lockPeriod, unlockPeriod } from '@/actions/audit';
import { dt } from '@/lib/format';
import { Badge, Empty, Field, Flash, PageHeader } from '@/components/ui';

export default async function Periods({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('audit.view');
  const locks = await db.periodLock.findMany({ orderBy: { startDate: 'desc' }, include: { lockedBy: true } });
  const can = user.perms.has('audit.lock');
  return (
    <>
      <PageHeader title="Verrouillage de périodes" sub="Une période verrouillée interdit toute modification rétroactive." />
      <Flash {...searchParams} />
      {can && (
        <form action={lockPeriod} className="card mb-6 grid gap-3 md:grid-cols-4">
          <Field label="Libellé"><input name="label" required placeholder="T3 2026" className="input" /></Field>
          <Field label="Du"><input type="date" name="start" required className="input" /></Field>
          <Field label="Au"><input type="date" name="end" required className="input" /></Field>
          <div className="flex items-end"><button className="btn w-full">Verrouiller</button></div>
        </form>
      )}
      <div className="card">{!locks.length && <Empty text="Aucune période verrouillée." />}
        {locks.map((l) => (
          <div key={l.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 py-3 text-sm">
            <div><b>{l.label}</b> <span className="text-slate-500">{dt(l.startDate)} → {dt(l.endDate)} · par {l.lockedBy.name}</span>
              {l.unlockedAt && <div className="text-xs text-amber-700">Déverrouillée le {dt(l.unlockedAt)} — {l.unlockReason}</div>}</div>
            {l.unlockedAt ? <Badge>déverrouillée</Badge> : can ? (
              <form action={unlockPeriod.bind(null, l.id)} className="flex gap-2"><input name="reason" required placeholder="Motif du déverrouillage" className="input w-64" /><button className="btn-danger btn-sm">Déverrouiller</button></form>
            ) : <Badge tone="green">verrouillée</Badge>}
          </div>
        ))}
      </div>
    </>
  );
}
