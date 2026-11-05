import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { addBudgetLine, removeBudgetLine, setActivityStatus, closeActivity } from '@/actions/activities';
import { describeVariance } from '@/lib/workflow';
import { mad, num, dt, ACTIVITY_LABEL } from '@/lib/format';
import { Badge, Field, Flash, PageHeader, Progress, Stat, StatusBadge } from '@/components/ui';
import { PrintButton } from '@/components/client';

export default async function ActivityPage({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('activities.view');
  const a = await db.activity.findUnique({ where: { id: params.id }, include: { manager: true, region: true, budgets: { include: { lines: { include: { category: true } } } } } });
  if (!a) notFound();
  const [txs, cats] = await Promise.all([
    db.transaction.findMany({ where: { activityId: a.id, status: { notIn: ['CANCELLED', 'REJECTED', 'DRAFT'] } }, orderBy: { transactionDate: 'desc' }, include: { category: true } }),
    db.category.findMany({ where: { type: 'EXPENSE', active: true }, orderBy: { name: 'asc' } }),
  ]);
  const real = (catId: string | null) => txs.filter((t) => t.type === 'EXPENSE' && t.categoryId === catId && ['APPROVED', 'PAID', 'CONTROLLED'].includes(t.status)).reduce((s, t) => s + num(t.amountMad), 0);
  const lines = a.budgets.flatMap((b) => b.lines);
  const planned = lines.reduce((s, l) => s + num(l.planned), 0);
  const valid = txs.filter((t) => ['PAID', 'CONTROLLED'].includes(t.status));
  const income = valid.filter((t) => t.type === 'INCOME').reduce((s, t) => s + num(t.amountMad), 0);
  const spent = valid.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + num(t.amountMad), 0);
  const can = user.perms.has('activities.manage');
  // Devis autorisés vs dépenses réelles (devis conservé après paiement ; avant paiement le devis = montant demandé).
  const expenses = txs.filter((t) => t.type === 'EXPENSE' && ['APPROVED', 'PAID', 'CONTROLLED'].includes(t.status));
  const quoteTotal = expenses.reduce((s, t) => s + num(t.quoteAmountMad ?? t.amountMad), 0);
  const actualTotal = valid.filter((t) => t.type === 'EXPENSE').reduce((s, t) => s + num(t.amountMad), 0);
  const unsettled = txs.filter((t) => t.type === 'EXPENSE' && t.status === 'APPROVED').length;
  const ds = a.settledAt ? describeVariance(num(a.quoteTotalMad), num(a.actualTotalMad)) : describeVariance(quoteTotal - expenses.filter((t) => t.status === 'APPROVED').reduce((s, t) => s + num(t.quoteAmountMad ?? t.amountMad), 0), actualTotal);
  const coveredCats = new Set(lines.map((l) => l.categoryId));
  const unbudgeted = txs.filter((t) => t.type === 'EXPENSE' && !coveredCats.has(t.categoryId) && ['APPROVED', 'PAID', 'CONTROLLED'].includes(t.status));

  return (
    <>
      <PageHeader title={a.name} sub={`${dt(a.startDate)} → ${dt(a.endDate)} · Responsable : ${a.manager?.name ?? '—'}${a.region ? ' · ' + a.region.name : ''}`}
        actions={<><PrintButton />{can && (
          <form action={setActivityStatus.bind(null, a.id)} className="flex gap-2">
            <select name="status" defaultValue={a.status} className="input">{Object.entries(ACTIVITY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
            <button className="btn-sec">OK</button>
          </form>)}</>} />
      <Flash error={searchParams.error} ok={searchParams.ok} />
      {a.description && <p className="mb-4 text-sm text-slate-600">{a.description}</p>}
      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <Stat label="Budget prévu" value={mad(planned)} /><Stat label="Recettes encaissées" value={mad(income)} tone="green" />
        <Stat label="Dépenses payées" value={mad(spent)} tone="red" /><Stat label="Solde de l’activité" value={mad(income - spent)} tone={income - spent < 0 ? 'red' : 'green'} />
      </div>
      <div className="card mb-6">
        <h2 className="mb-2 font-semibold">Devis vs dépenses réelles</h2>
        <div className="grid gap-3 md:grid-cols-3">
          <Stat label="Devis autorisés" value={mad(a.settledAt ? num(a.quoteTotalMad) : quoteTotal)} />
          <Stat label="Dépenses réelles enregistrées" value={mad(a.settledAt ? num(a.actualTotalMad) : actualTotal)} tone="red" />
          <Stat label="Écart" value={ds.kind === 'EQUAL' ? 'Aucune différence' : `${ds.diff > 0 ? '+' : '−'}${mad(Math.abs(ds.diff))}`} tone={ds.kind === 'OVER' ? 'red' : 'green'} />
        </div>
        {a.settledAt ? <p className="mt-3 text-sm text-green-700">Activité clôturée le {dt(a.settledAt)} : le bureau a été notifié du comparatif.</p>
          : user.perms.has('activities.settle') && (
            <form action={closeActivity.bind(null, a.id)} className="mt-3 flex flex-wrap items-center gap-3">
              <button className="btn" disabled={unsettled > 0}>Clôturer l’activité et notifier le bureau</button>
              <span className="text-xs text-slate-500">{unsettled > 0 ? `${unsettled} devis autorisé(s) attend(ent) l’enregistrement des dépenses réelles.` : 'Le comparatif devis / dépenses réelles sera envoyé à tous les membres du bureau.'}</span>
            </form>)}
      </div>
      <div className="card mb-6 overflow-x-auto">
        <h2 className="mb-3 font-semibold">Prévision vs Réel</h2>
        <table className="tbl">
          <thead><tr><th>Ligne</th><th>Catégorie</th><th className="text-right">Prévu</th><th className="text-right">Réel</th><th className="text-right">Écart</th><th className="w-40">Consommation</th><th /></tr></thead>
          <tbody>{lines.map((l) => {
            const r = real(l.categoryId), p = num(l.planned), gap = p - r;
            return (
              <tr key={l.id}><td>{l.label}</td><td>{l.category?.name ?? '—'}</td><td className="text-right">{mad(p)}</td><td className="text-right">{mad(r)}</td>
                <td className={`text-right font-medium ${gap < 0 ? 'text-red-600' : 'text-green-700'}`}>{mad(gap)}</td><td><Progress value={p ? (r / p) * 100 : 0} /></td>
                <td>{can && <form action={removeBudgetLine.bind(null, a.id, l.id)}><button className="text-xs text-red-600 underline">retirer</button></form>}</td></tr>
            );
          })}</tbody>
        </table>
        {unbudgeted.length > 0 && <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{unbudgeted.length} dépense(s) engagée(s) hors lignes budgétaires : {mad(unbudgeted.reduce((s, t) => s + num(t.amountMad), 0))}.</p>}
        {can && (
          <form action={addBudgetLine.bind(null, a.id)} className="mt-4 grid gap-2 md:grid-cols-4">
            <Field label="Libellé"><input name="label" required className="input" placeholder="Hébergement" /></Field>
            <Field label="Catégorie"><select name="categoryId" className="input"><option value="">—</option>{cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Montant prévu (MAD)"><input name="planned" required className="input" /></Field>
            <div className="flex items-end"><button className="btn w-full">Ajouter la ligne</button></div>
          </form>
        )}
      </div>
      <div className="card overflow-x-auto p-0">
        <h2 className="p-5 pb-2 font-semibold">Opérations rattachées</h2>
        <table className="tbl"><thead><tr><th>Réf.</th><th>Date</th><th>Description</th><th>Catégorie</th><th className="text-right">Devis</th><th className="text-right">Montant (réel)</th><th>Statut</th></tr></thead>
          <tbody>{txs.map((t) => (
            <tr key={t.id}><td><Link className="underline" href={`/depenses/${t.id}`}>{t.reference}</Link></td><td>{dt(t.transactionDate)}</td><td>{t.description}</td><td>{t.category.name}</td><td className="text-right text-slate-500">{t.type === 'EXPENSE' && t.quoteAmountMad != null ? mad(t.quoteAmountMad) : '—'}</td>
              <td className={`text-right ${t.type === 'INCOME' ? 'text-green-700' : 'text-red-700'}`}>{t.type === 'INCOME' ? '+' : '−'} {mad(t.amountMad)}</td><td><StatusBadge status={t.status} /></td></tr>
          ))}</tbody></table>
      </div>
      <span className="hidden"><Badge>{a.status}</Badge></span>
    </>
  );
}