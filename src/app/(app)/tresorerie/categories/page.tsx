import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { createCategory, toggleCategory } from '@/actions/admin';
import { Flash, PageHeader, Tabs, Badge, Field } from '@/components/ui';
import { TREASURY_TABS } from '@/lib/tabs';

export default async function Categories({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('transactions.view');
  const cats = await db.category.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] });
  const canEdit = user.perms.has('categories.manage');
  return (
    <>
      <PageHeader title="Catégories" sub="Configurables sans modifier le code" />
      <Flash {...searchParams} />
      <Tabs items={TREASURY_TABS} current="/tresorerie/categories" />
      <div className="grid gap-6 md:grid-cols-2">
        {(['INCOME', 'EXPENSE'] as const).map((t) => (
          <div key={t} className="card"><h2 className="mb-3 font-semibold">{t === 'INCOME' ? 'Recettes' : 'Dépenses'}</h2>
            {cats.filter((c) => c.type === t).map((c) => (
              <div key={c.id} className="flex items-center justify-between border-b border-slate-100 py-2 text-sm">
                <span className={c.active ? '' : 'text-slate-400 line-through'}>{c.name}</span>
                {canEdit && <form action={toggleCategory.bind(null, c.id)}><button className="btn-sec btn-sm">{c.active ? 'Désactiver' : 'Réactiver'}</button></form>}
                {!canEdit && !c.active && <Badge>inactive</Badge>}
              </div>
            ))}
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
