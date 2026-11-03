import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { accountBalances } from '@/lib/domain';
import { createAccount } from '@/actions/admin';
import { mad, ACCOUNT_LABEL } from '@/lib/format';
import { Flash, PageHeader, Tabs, Field } from '@/components/ui';
import { TREASURY_TABS } from '@/lib/tabs';

export default async function Accounts({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('accounts.view');
  const [balances, activities] = await Promise.all([accountBalances(), db.activity.findMany({ orderBy: { name: 'asc' } })]);
  return (
    <>
      <PageHeader title="Comptes et caisses" />
      <Flash {...searchParams} />
      <Tabs items={TREASURY_TABS} current="/tresorerie/comptes" />
      <p className="mb-3 text-sm text-slate-500">Un compte n’est débité qu’au <b>paiement</b> (statut « Payée »). Une dépense autorisée mais pas encore payée est <b>engagée</b> : elle réduit le solde disponible sans toucher au solde comptable.</p>
      <div className="card mb-6 overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>Compte</th><th>Type</th><th className="text-right">Solde initial</th><th className="text-right">Solde comptable</th><th className="text-right">Engagé (autorisé, non payé)</th><th className="text-right">Disponible</th></tr></thead>
          <tbody>{balances.map((a) => (
            <tr key={a.id}><td>{a.name}</td><td>{ACCOUNT_LABEL[a.type]}</td><td className="text-right">{mad(a.openingBalance)}</td><td className="text-right font-semibold">{mad(a.balance)}</td><td className="text-right text-amber-700">{a.committed ? mad(a.committed) : '—'}</td><td className={`text-right font-semibold ${a.available < 0 ? 'text-red-700' : ''}`}>{mad(a.available)}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {user.perms.has('accounts.manage') && (
        <form action={createAccount} className="card grid gap-3 md:grid-cols-5">
          <Field label="Nom"><input name="name" required className="input" /></Field>
          <Field label="Type"><select name="type" className="input">{Object.entries(ACCOUNT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
          <Field label="Solde initial (MAD)"><input name="openingBalance" defaultValue="0" className="input" /></Field>
          <Field label="Activité (fonds dédié)"><select name="activityId" className="input"><option value="">—</option>{activities.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          <div className="flex items-end"><button className="btn w-full">Créer le compte</button></div>
        </form>
      )}
    </>
  );
}
