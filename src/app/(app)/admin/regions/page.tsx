import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { createRegion, toggleRegion, updateRegion } from '@/actions/admin';
import { Badge, Field, Flash } from '@/components/ui';

export default async function Regions({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  await requirePage(['admin.regions', 'regions.manage']);
  const regions = await db.region.findMany({ orderBy: { name: 'asc' } });
  return (
    <>
      <Flash {...searchParams} />
      <p className="mb-4 text-sm text-slate-500">Liste des églises / régions du réseau. Elle sert uniquement à qualifier une opération : <b>région d’origine</b> d’une recette (qui a versé la contribution) ou rattachement d’une activité. Elle alimente les rapports « Contributions par région » et les rappels de cotisations. Les deux lignes « Région exemple » viennent du jeu de démarrage : renommez-les ou désactivez-les, puis ajoutez les vôtres ci-dessous. Aucune gestion financière régionale.</p>
      <form action={createRegion} className="card mb-6 grid gap-3 md:grid-cols-5">
        <Field label="Église / région"><input name="name" required className="input" /></Field><Field label="Zone"><input name="zone" className="input" /></Field>
        <Field label="Contact"><input name="contactName" className="input" /></Field><Field label="Téléphone"><input name="contactPhone" className="input" /></Field>
        <div className="flex items-end"><button className="btn w-full">Ajouter</button></div>
      </form>
      <div className="card overflow-x-auto p-0"><table className="tbl"><thead><tr><th>Nom</th><th>Zone</th><th>Contact</th><th /></tr></thead>
        <tbody>{regions.map((r) => (
          <tr key={r.id}><td>{r.name} {!r.active && <Badge>inactive</Badge>}</td><td>{r.zone ?? '—'}</td><td>{r.contactName ?? '—'} {r.contactPhone}</td>
            <td className="space-y-2">
              <div className="flex gap-2">
                <form action={toggleRegion.bind(null, r.id)}><button className="btn-sec btn-sm">{r.active ? 'Désactiver' : 'Réactiver'}</button></form>
              </div>
              <details>
                <summary className="cursor-pointer text-sm text-brand-700 underline">Modifier</summary>
                <form action={updateRegion.bind(null, r.id)} className="mt-2 grid gap-2 md:grid-cols-2">
                  <input name="name" required defaultValue={r.name} placeholder="Église / région" className="input" />
                  <input name="zone" defaultValue={r.zone ?? ''} placeholder="Zone" className="input" />
                  <input name="contactName" defaultValue={r.contactName ?? ''} placeholder="Contact" className="input" />
                  <input name="contactPhone" defaultValue={r.contactPhone ?? ''} placeholder="Téléphone" className="input" />
                  <button className="btn btn-sm md:col-span-2">Enregistrer</button>
                </form>
              </details>
            </td></tr>
        ))}</tbody></table></div>
    </>
  );
}