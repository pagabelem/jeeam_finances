import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { createCategory, toggleCategory } from '@/actions/admin';
import { updateCategory, deleteCategory } from '@/actions/categories';
import { Flash, PageHeader, Tabs, Badge, Field } from '@/components/ui';
import { DeleteBox } from '@/components/delete-box';
import { TREASURY_TABS } from '@/lib/tabs';

export default async function Categories({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('transactions.view');
  const [cats, txCounts, lineCounts] = await Promise.all([
    db.category.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    db.transaction.groupBy({ by: ['categoryId'], _count: { _all: true } }),
    db.budgetLine.groupBy({ by: ['categoryId'], _count: { _all: true } }),
  ]);
  const used = (id: string) => (txCounts.find((c) => c.categoryId === id)?._count._all ?? 0) + (lineCounts.find((c) => c.categoryId === id)?._count._all ?? 0);
  const canEdit = user.perms.has('categories.manage');
  const canDelete = user.perms.has('data.delete');
  return (
    <>
      <PageHeader title="Catégories" sub="Configurables sans modifier le code : renommer, désactiver ou supprimer" />
      <Flash {...searchParams} />
      <Tabs items={TREASURY_TABS} current="/tresorerie/categories" />
      <div className="grid gap-6 md:grid-cols-2">
        {(['INCOME', 'EXPENSE'] as const).map((t) => (
          <div key={t} className="card"><h2 className="mb-3 font-semibold">{t === 'INCOME' ? 'Recettes' : 'Dépenses'}</h2>
            {cats.filter((c) => c.type === t).map((c) => {
              const others = cats.filter((o) => o.type === t && o.id !== c.id);
              return (
                <div key={c.id} className="border-b border-slate-100 py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className={c.active ? '' : 'text-slate-400 line-through'}>{c.name} <span className="text-xs text-slate-400">({used(c.id)} utilisation(s))</span></span>
                    <div className="flex items-start gap-2">
                      {canEdit && <form action={toggleCategory.bind(null, c.id)}><button className="btn-sec btn-sm">{c.active ? 'Désactiver' : 'Réactiver'}</button></form>}
                      {!canEdit && !c.active && <Badge>inactive</Badge>}
                    </div>
                  </div>
                  <div className="mt-1 flex flex-wrap items-start gap-3">
                    {canEdit && (
                      <details>
                        <summary className="cursor-pointer text-xs text-brand-700 underline">Modifier</summary>
                        <form action={updateCategory.bind(null, c.id)} className="mt-2 flex gap-2"><input name="name" required defaultValue={c.name} className="input" /><button className="btn btn-sm">Enregistrer</button></form>
                      </details>
                    )}
                    {canDelete && (
                      <DeleteBox compact action={deleteCategory.bind(null, c.id)} label="Supprimer"
                        warn={used(c.id) ? `Cette catégorie est utilisée ${used(c.id)} fois : tout sera réaffecté à la catégorie choisie ci-dessous.` : undefined}>
                        {used(c.id) > 0 && (
                          <select name="moveTo" required className="input"><option value="">Réaffecter vers…</option>{others.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                        )}
                      </DeleteBox>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {canEdit && (
        <form action={createCategory} className="card mt-6 grid gap-3 md:grid-cols-3">
          <Field label="Nom"><input name="name" required className="input" /></Field>
          <Field label="Type"><select name="type" className="input"><option value="INCOME">Recette</option><option value="EXPENSE">Dépense</option></select></Field>
          <div className="flex items-end"><button className="btn w-full">Ajouter</button></div>
        </form>
      )}
    </>
  );
}