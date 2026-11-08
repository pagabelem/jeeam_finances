
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { accountBalances } from '@/lib/domain';
import { createAccount } from '@/actions/admin';
import { deleteAccount } from '@/actions/delete';
import { DeleteBox } from '@/components/delete-box';
import { mad, ACCOUNT_LABEL } from '@/lib/format';
import { Flash, PageHeader, Tabs, Field } from '@/components/ui';
import { TREASURY_TABS } from '@/lib/tabs';

export default async function Accounts({
  searchParams,
}: {
  searchParams: { error?: string; ok?: string };
}) {
  const user = await requirePage('accounts.view');

  const [balances, activities, counts] = await Promise.all([
    accountBalances(),
    db.activity.findMany({
      orderBy: { name: 'asc' },
    }),
    db.transaction.groupBy({
      by: ['accountId'],
      _count: { _all: true },
    }),
  ]);

  const nTx = (id: string) =>
    counts.find((c) => c.accountId === id)?._count._all ?? 0;

  return (
    <>
      <PageHeader title="Comptes et caisses" />

      <Flash {...searchParams} />

      <Tabs items={TREASURY_TABS} current="/tresorerie/comptes" />

      <p className="mb-3 text-sm text-slate-500">
        Un compte n’est débité qu’au <b>paiement</b> (statut « Payée »).
        Une dépense autorisée mais pas encore payée est <b>engagée</b> :
        elle réduit le solde disponible sans toucher au solde comptable.
      </p>

      <div className="card mb-6 overflow-x-auto p-0">
        <table className="tbl">
          <thead>
            <tr>
              <th>Compte</th>
              <th>Type</th>
              <th className="text-right">Solde initial</th>
              <th className="text-right">Solde comptable</th>
              <th className="text-right">
                Engagé (autorisé, non payé)
              </th>
              <th className="text-right">Disponible</th>
              <th></th>
            </tr>
          </thead>

          <tbody>
            {balances.map((a) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td>{ACCOUNT_LABEL[a.type]}</td>
                <td className="text-right">
                  {mad(a.openingBalance)}
                </td>
                <td className="text-right font-semibold">
                  {mad(a.balance)}
                </td>
                <td className="text-right text-amber-700">
                  {a.committed ? mad(a.committed) : '—'}
                </td>
                <td
                  className={`text-right font-semibold ${
                    a.available < 0 ? 'text-red-700' : ''
                  }`}
                >
                  {mad(a.available)}
                </td>

                <td>
                  {user.perms.has('data.delete') && (
                    <DeleteBox
                      compact
                      action={deleteAccount.bind(null, a.id)}
                      label="Supprimer"
                      warn={
                        nTx(a.id)
                          ? `Ce compte contient ${nTx(a.id)} opération(s).`
                          : undefined
                      }
                    >
                      {nTx(a.id) > 0 && (
                        <label className="flex items-start gap-2 text-xs text-red-800">
                          <input
                            type="checkbox"
                            name="mode"
                            value="cascade"
                          />
                          Supprimer aussi ses {nTx(a.id)} opération(s),
                          leurs justificatifs et les ajustements de solde
                        </label>
                      )}
                    </DeleteBox>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {user.perms.has('accounts.manage') && (
        <form
          action={createAccount}
          className="card grid gap-3 md:grid-cols-5"
        >
          <Field label="Nom">
            <input
              name="name"
              required
              className="input"
            />
          </Field>

          <Field label="Type">
            <select name="type" className="input">
              {Object.entries(ACCOUNT_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Solde initial (MAD)">
            <input
              name="openingBalance"
              defaultValue="0"
              className="input"
            />
          </Field>

          <Field label="Activité (fonds dédié)">
            <select name="activityId" className="input">
              <option value="">—</option>
              {activities.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </Field>

          <div className="flex items-end">
            <button className="btn w-full">
              Créer le compte
            </button>
          </div>
        </form>
      )}
    </>
  );
}
