import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { editPolicy } from '@/lib/workflow';
import { updateTransaction } from '@/actions/transactions';
import { Flash, PageHeader } from '@/components/ui';
import { TxFields, loadOptions } from '@/components/tx-fields';
import { iso, num } from '@/lib/format';

export default async function EditTx({ params, searchParams }: { params: { id: string }; searchParams: { error?: string } }) {
  const user = await requirePage('transactions.view');
  const t = await db.transaction.findUnique({ where: { id: params.id } });
  if (!t) notFound();
  const pol = editPolicy({ status: t.status, type: t.type, isCreator: t.createdById === user.id, canRequest: user.perms.has('expenses.request'), canEdit: user.perms.has('transactions.edit') });
  if (!pol.allowed || user.roleKey === 'CAC') redirect(`/depenses/${t.id}?error=${encodeURIComponent(pol.why ?? 'Modification non autorisée.')}`);
  const o = await loadOptions(db, t.type);
  const warn = t.type === 'EXPENSE' && (t.status === 'APPROVED' || t.status === 'PENDING_APPROVAL');
  return (
    <>
      <PageHeader title={`Modifier ${t.reference}`} sub="Chaque modification est tracée dans le journal d’audit (valeurs avant/après)." actions={<Link className="btn-sec" href={`/depenses/${t.id}`}>Annuler</Link>} />
      <Flash error={searchParams.error} />
      {warn && <div className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800">Si vous changez le montant, la devise, le taux, la date, la catégorie, le compte ou l’activité, les autorisations déjà données sont annulées et la dépense repart en attente d’autorisation.</div>}
      <form action={updateTransaction.bind(null, t.id)} className="card space-y-4">
        <TxFields {...o} values={{
          amount: String(num(t.amount)), currency: t.currency, rate: t.currency === 'MAD' ? '' : String(num(t.exchangeRate)), date: iso(t.transactionDate),
          categoryId: t.categoryId, accountId: t.accountId, activityId: t.activityId ?? '', regionId: t.regionId ?? '',
          paymentMethod: t.paymentMethod ?? '', bankReference: t.bankReference ?? '', description: t.description,
        }} />
        {pol.needsReason && <div><label className="label">Motif de la modification (obligatoire)</label><input name="reason" required minLength={5} className="input" /></div>}
        <button className="btn">Enregistrer les modifications</button>
      </form>
    </>
  );
}
