import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { createExpense } from '@/actions/transactions';
import { Flash, PageHeader } from '@/components/ui';
import { TxFields, loadOptions } from '@/components/tx-fields';

export default async function NewExpense({ searchParams }: { searchParams: { error?: string } }) {
  await requirePage('expenses.request');
  const o = await loadOptions(db, 'EXPENSE');
  return (
    <>
      <PageHeader title="Nouvelle demande de dépense" sub="Une dépense n’est jamais enregistrée directement : elle suit le circuit de validation." />
      <Flash error={searchParams.error} />
      <form action={createExpense} className="card space-y-4">
        <TxFields {...o} showQuote />
        <div className="flex gap-2">
          <button name="intent" value="draft" className="btn-sec">Enregistrer en brouillon</button>
          <button name="intent" value="submit" className="btn">Soumettre pour autorisation</button>
        </div>
      </form>
    </>
  );
}
