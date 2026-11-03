import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { accountBalances } from '@/lib/domain';
import { requestAdjustment, decideAdjustment, applyAdjustment, cancelAdjustment } from '@/actions/balance';
import { mad, num, dtt, ADJ_LABEL, ADJ_TONE } from '@/lib/format';
import { Badge, Field, Flash, PageHeader, Tabs, Empty } from '@/components/ui';
import { TREASURY_TABS } from '@/lib/tabs';

export default async function Adjustments({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage(['balance.request', 'balance.approve', 'balance.apply', 'accounts.view']);
  const can = (p: string) => user.perms.has(p);
  const [balances, list] = await Promise.all([
    accountBalances(),
    db.balanceAdjustment.findMany({ orderBy: { createdAt: 'desc' }, take: 50, include: { account: true, requestedBy: true, appliedBy: true, approvals: { include: { approver: true }, orderBy: { roleName: 'asc' } } } }),
  ]);
  return (
    <>
      <PageHeader title="Ajustements de solde" sub="Toute modification du solde d’un compte exige l’autorisation de chaque rôle concerné (Commissaire aux comptes et Présidente par défaut) avant que la Trésorière puisse l’appliquer." />
      <Flash {...searchParams} />
      <Tabs items={TREASURY_TABS} current="/tresorerie/ajustements" />

      {can('balance.request') && user.roleKey !== 'CAC' && (
        <form action={requestAdjustment} className="card mb-6 grid gap-3 md:grid-cols-4">
          <Field label="Compte"><select name="accountId" required className="input"><option value="">—</option>{balances.map((a) => <option key={a.id} value={a.id}>{a.name} — actuel {mad(a.balance)}</option>)}</select></Field>
          <Field label="Nouveau solde comptable (MAD)"><input name="newBalance" required inputMode="decimal" className="input" /></Field>
          <div className="md:col-span-2"><Field label="Motif détaillé (obligatoire)"><input name="reason" required minLength={10} className="input" placeholder="Ex. : régularisation après rapprochement bancaire du …" /></Field></div>
          <div className="md:col-span-4 flex items-center gap-3"><button className="btn">Demander la modification</button>
            <span className="text-xs text-slate-500">Le solde comptable = solde initial + recettes − dépenses payées. Les dépenses autorisées non payées restent « engagées ».</span></div>
        </form>
      )}

      {!list.length && <div className="card"><Empty text="Aucune demande de modification de solde." /></div>}
      <div className="space-y-4">
        {list.map((a) => {
          const mine = a.approvals.find((x) => x.roleId === user.roleId);
          const canDecide = can('balance.approve') && a.status === 'PENDING' && a.requestedById !== user.id && mine?.decision === 'PENDING';
          return (
            <div key={a.id} className="card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{a.account.name} : {mad(a.currentBalance)} → {mad(a.newBalance)} <span className={num(a.delta) >= 0 ? 'text-green-700' : 'text-red-700'}>({num(a.delta) > 0 ? '+' : ''}{mad(a.delta)})</span></div>
                  <div className="text-xs text-slate-500">Demandé par {a.requestedBy.name} · {dtt(a.createdAt)}{a.appliedBy && ` · appliqué par ${a.appliedBy.name} le ${dtt(a.appliedAt)}`}</div>
                </div>
                <Badge tone={ADJ_TONE[a.status]}>{ADJ_LABEL[a.status]}</Badge>
              </div>
              <p className="mt-2 text-sm text-slate-700">Motif : {a.reason}{a.cancelReason && <span className="text-red-700"> · Annulée : {a.cancelReason}</span>}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {a.approvals.map((x) => (
                  <span key={x.id} className="rounded-lg bg-slate-50 px-2 py-1">
                    <Badge tone={x.decision === 'APPROVED' ? 'green' : x.decision === 'REJECTED' ? 'red' : 'amber'}>{x.roleName} : {x.decision === 'APPROVED' ? 'autorisé' : x.decision === 'REJECTED' ? 'refusé' : 'en attente'}</Badge>
                    {x.approver && <span className="ml-1 text-slate-500">{x.approver.name} · {dtt(x.decidedAt)}{x.comment ? ` · ${x.comment}` : ''}</span>}
                  </span>
                ))}
              </div>
              {canDecide && (
                <form action={decideAdjustment.bind(null, a.id)} className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                  <div className="min-w-[240px] flex-1"><label className="label">Commentaire (obligatoire pour refuser)</label><input name="comment" className="input" /></div>
                  <button name="decision" value="APPROVED" className="btn">Autoriser</button><button name="decision" value="REJECTED" className="btn-danger">Refuser</button>
                </form>
              )}
              {a.status === 'APPROVED' && can('balance.apply') && user.roleKey !== 'CAC' && (
                <form action={applyAdjustment.bind(null, a.id)} className="mt-3 border-t border-slate-100 pt-3">
                  <button className="btn">Appliquer la modification du solde</button>
                </form>
              )}
              {(a.status === 'PENDING' || a.status === 'APPROVED') && can('balance.request') && user.roleKey !== 'CAC' && (
                <form action={cancelAdjustment.bind(null, a.id)} className="mt-3 flex gap-2">
                  <input name="reason" required placeholder="Motif d’annulation" className="input max-w-xs" /><button className="btn-sec btn-sm">Annuler la demande</button>
                </form>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
