import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { mad, dt } from '@/lib/format';
import { Flash, PageHeader, StatusBadge, Tabs, Empty } from '@/components/ui';

const TABS = [
  { href: '/depenses', label: 'Toutes' }, { href: '/depenses?s=PENDING_APPROVAL', label: 'En attente' },
  { href: '/depenses?s=APPROVED', label: 'Autorisées' }, { href: '/depenses?s=PAID', label: 'Payées' },
  { href: '/depenses?s=REJECTED', label: 'Refusées' }, { href: '/depenses?s=DRAFT', label: 'Brouillons' },
];

/** Action attendue de l'utilisateur sur une dépense, selon son statut et ses permissions (le bouton ouvre la fiche où l'action se fait). */
function nextAction(status: string, perms: Set<string>): string | null {
  if (status === 'DRAFT' && perms.has('expenses.request')) return 'Soumettre';
  if (status === 'PENDING_APPROVAL' && perms.has('expenses.approve')) return 'Autoriser / refuser';
  if (status === 'APPROVED' && perms.has('expenses.pay')) return 'Payer';
  if (status === 'PAID' && perms.has('audit.control')) return 'Contrôler';
  return null;
}

export default async function Expenses({ searchParams }: { searchParams: { s?: string; error?: string; ok?: string } }) {
  const user = await requirePage('transactions.view');
  const s = searchParams.s;
  const rows = await db.transaction.findMany({
    where: { type: 'EXPENSE', ...(s ? { status: s as never } : {}) }, orderBy: { createdAt: 'desc' }, take: 100,
    include: { category: true, activity: true, createdBy: true },
  });
  return (
    <>
      <PageHeader title="Dépenses" sub="Demande → autorisation → paiement → justificatif → contrôle"
        actions={user.perms.has('expenses.request') ? <Link href="/depenses/nouvelle" className="btn">+ Nouvelle demande</Link> : undefined} />
      <Flash error={searchParams.error} ok={searchParams.ok} />
      <Tabs items={TABS} current={s ? `/depenses?s=${s}` : '/depenses'} />
      <div className="card overflow-x-auto p-0">
        <table className="tbl">
          <thead><tr><th>Réf.</th><th>Date</th><th>Motif</th><th>Catégorie / activité</th><th>Demandeur</th><th className="text-right">Montant</th><th>Statut</th><th>Action</th></tr></thead>
          <tbody>{rows.map((t) => (
            <tr key={t.id} className="hover:bg-slate-50">
              <td><Link className="font-medium text-brand-700 underline" href={`/depenses/${t.id}`}>{t.reference}</Link></td>
              <td>{dt(t.transactionDate)}</td><td>{t.description}</td>
              <td>{t.category.name}<div className="text-xs text-slate-400">{t.activity?.name}</div></td>
              <td>{t.createdBy.name}</td><td className="text-right font-medium">{mad(t.amountMad)}</td><td><StatusBadge status={t.status} /></td>
              <td>{(() => {
                const a = nextAction(t.status, user.perms);
                return a ? <Link href={`/depenses/${t.id}`} className="btn btn-sm whitespace-nowrap">{a}</Link> : <Link href={`/depenses/${t.id}`} className="text-xs text-slate-400 underline">Voir</Link>;
              })()}</td>
            </tr>
          ))}</tbody>
        </table>
        {!rows.length && <Empty text="Aucune dépense." />}
      </div>
    </>
  );
}