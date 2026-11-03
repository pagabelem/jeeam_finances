import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { createIncome } from '@/actions/transactions';
import { Flash, PageHeader, Tabs } from '@/components/ui';
import { TxFields, loadOptions } from '@/components/tx-fields';
import { TREASURY_TABS } from '@/lib/tabs';

export default async function NewIncome({ searchParams }: { searchParams: { error?: string } }) {
  await requirePage('income.record');
  const o = await loadOptions(db, 'INCOME');
  return (
    <>
      <PageHeader title="Nouvelle recette" sub="Cotisation, don, offrande, contribution régionale, inscription, subvention…" />
      <Flash error={searchParams.error} />
      <Tabs items={TREASURY_TABS} current="/tresorerie/recettes/nouvelle" />
      <form action={createIncome} className="card space-y-4"><TxFields {...o} /><button className="btn">Enregistrer la recette</button></form>
    </>
  );
}
