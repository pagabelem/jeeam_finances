import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { dt, iso, KIND_LABEL } from '@/lib/format';
import { Badge, Empty, PageHeader } from '@/components/ui';
import { deleteAttachment } from '@/actions/delete';
import { DeleteBox } from '@/components/delete-box';
import type { Prisma } from '@prisma/client';

export default async function Attachments({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const user = await requirePage('attachments.view');
  const { q, kind, activityId, categoryId, from, to } = searchParams;
  const where: Prisma.AttachmentWhereInput = {
    ...(kind ? { kind: kind as never } : {}),
    ...(q ? { OR: [{ fileName: { contains: q, mode: 'insensitive' } }, { transaction: { reference: { contains: q, mode: 'insensitive' } } }] } : {}),
    transaction: { ...(activityId ? { activityId } : {}), ...(categoryId ? { categoryId } : {}), ...(from || to ? { transactionDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + 'T23:59:59') } : {}) } } : {}) },
  };
  const [rows, acts, cats, missing] = await Promise.all([
    db.attachment.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100, include: { transaction: true } }),
    db.activity.findMany({ orderBy: { name: 'asc' } }), db.category.findMany({ orderBy: { name: 'asc' } }),
    db.transaction.findMany({ where: { type: 'EXPENSE', status: { in: ['PAID', 'CONTROLLED'] }, attachments: { none: {} } }, select: { id: true, reference: true } }),
  ]);
  const zip = new URLSearchParams(Object.entries({ activityId, categoryId, from, to }).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Justificatifs" actions={<Link className="btn-sec" href={`/api/attachments/zip?${zip}`}>Téléchargement groupé (ZIP)</Link>} />
      {missing.length > 0 && (
        <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {missing.length} dépense(s) payée(s) sans justificatif : {missing.slice(0, 8).map((m) => <Link key={m.id} href={`/depenses/${m.id}`} className="mr-2 underline">{m.reference}</Link>)}
        </div>
      )}
      <form className="card mb-4 grid gap-3 md:grid-cols-6">
        <input name="q" defaultValue={q} placeholder="Nom de fichier, référence…" className="input" />
        <select name="kind" defaultValue={kind ?? ''} className="input"><option value="">Tous types</option>{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
        <select name="activityId" defaultValue={activityId ?? ''} className="input"><option value="">Toutes activités</option>{acts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select name="categoryId" defaultValue={categoryId ?? ''} className="input"><option value="">Toutes catégories</option>{cats.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <input type="date" name="from" defaultValue={from} className="input" /><input type="date" name="to" defaultValue={to ?? iso(null)} className="input" />
        <button className="btn md:w-40">Rechercher</button>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="tbl"><thead><tr><th>Fichier</th><th>Type</th><th>Opération</th><th>Ajouté le</th><th></th></tr></thead>
          <tbody>{rows.map((a) => (
            <tr key={a.id}><td><a className="underline" target="_blank" href={`/api/attachments/${a.id}`}>{a.fileName}</a></td><td><Badge tone="blue">{KIND_LABEL[a.kind]}</Badge></td>
              <td><Link className="underline" href={`/depenses/${a.transactionId}`}>{a.transaction.reference}</Link></td><td>{dt(a.createdAt)}</td>
              <td>{user.perms.has('data.delete') && <DeleteBox compact action={deleteAttachment.bind(null, a.id)} label="Supprimer" />}</td></tr>
          ))}</tbody></table>
        {!rows.length && <Empty text="Aucun justificatif." />}
      </div>
    </>
  );
}