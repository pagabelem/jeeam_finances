import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { dtt } from '@/lib/format';
import { Badge, Empty } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Registre des suppressions : en ajout seul, ni modifiable ni supprimable (triggers SQL). */
export default async function Deletions() {
  await requirePage(['admin.auditlog', 'audit.purge', 'data.delete', 'audit.view']);
  const rows = await db.deletionRecord.findMany({ orderBy: { seq: 'desc' }, take: 300 });
  return (
    <>
      <p className="mb-4 text-sm text-slate-500">Trace permanente de toutes les suppressions : qui, quand, pourquoi et copie des données supprimées. Ce registre ne peut être ni modifié ni vidé, même par un administrateur.</p>
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>#</th><th>Date</th><th>Par</th><th>Élément</th><th>Supprimé</th><th>Motif</th><th>Copie</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id} className="align-top"><td>{r.seq}</td><td className="whitespace-nowrap">{dtt(r.at)}</td><td>{r.userName}</td>
              <td><Badge tone="red">{r.entity}</Badge></td><td>{r.label}{r.count > 1 && <div className="text-xs text-slate-400">{r.count} élément(s)</div>}</td><td className="text-sm">{r.reason}</td>
              <td className="max-w-md"><details><summary className="cursor-pointer text-xs text-brand-700 underline">Voir</summary><pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-50 p-2 text-[11px]">{JSON.stringify(r.snapshot, null, 1)?.slice(0, 6000)}</pre></details></td></tr>
          ))}</tbody>
        </table>
        {!rows.length && <Empty text="Aucune suppression enregistrée." />}
      </div>
    </>
  );
}