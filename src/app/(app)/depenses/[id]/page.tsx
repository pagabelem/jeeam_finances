import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { budgetCheck, getThreshold, getDoubleThreshold, accountBalances } from '@/lib/domain';
import { requiredApprovals, approvalBlock, editPolicy, routingBlock, approverRoleFor, describeVariance } from '@/lib/workflow';
import { submitExpense, decideExpense, payExpense, cancelTransaction, addAttachment } from '@/actions/transactions';
import { controlTransaction, openObservation } from '@/actions/audit';
import { deleteTransaction, deleteAttachment } from '@/actions/delete';
import { DeleteBox } from '@/components/delete-box';
import { mad, num, dt, dtt, KIND_LABEL, OBS_LABEL } from '@/lib/format';
import { Badge, Field, Flash, PageHeader, StatusBadge } from '@/components/ui';

export default async function TxDetail({ params, searchParams }: { params: { id: string }; searchParams: { error?: string; ok?: string } }) {
  const user = await requirePage('transactions.view');
  const t = await db.transaction.findUnique({
    where: { id: params.id },
    include: {
      category: true, account: true, activity: true, region: true, createdBy: { include: { role: true } }, validatedBy: true, paidBy: true, controlledBy: true, cancelledBy: true,
      attachments: { include: { uploadedBy: true }, orderBy: { createdAt: 'asc' } }, approvals: { include: { approver: true }, orderBy: { createdAt: 'asc' } },
      observations: { include: { raisedBy: true, assignee: true } },
    },
  });
  if (!t) notFound();
  const [history, threshold, dbl, budget, treasurers, accBal] = await Promise.all([
    db.auditLog.findMany({ where: { entity: 'Transaction', entityId: t.id }, orderBy: { seq: 'asc' }, include: { user: true } }),
    getThreshold(), getDoubleThreshold(),
    t.type === 'EXPENSE' ? budgetCheck(t.activityId, t.categoryId, num(t.amountMad), t.id) : null,
    user.perms.has('audit.observe') ? db.user.findMany({ where: { active: true, role: { key: 'TRESORIERE' } } }) : [],
    t.type === 'EXPENSE' && ['PENDING_APPROVAL', 'APPROVED'].includes(t.status) && user.perms.has('accounts.view') ? accountBalances().then((l) => l.find((a) => a.id === t.accountId)) : null,
  ]);
  const can = (p: string) => user.perms.has(p);
  const isExpense = t.type === 'EXPENSE';
  const active = t.approvals.filter((a) => !a.supersededAt);
  const approvedBy = active.filter((a) => a.decision === 'APPROVED' && a.approverId).map((a) => a.approverId!);
  const required = requiredApprovals(num(t.amountMad), dbl);
  const block = approvalBlock({ userId: user.id, creatorId: t.createdById, amountMad: num(t.amountMad), threshold, doubleThreshold: dbl, approvedBy });
  const route = routingBlock(approvedBy.length + 1, user.roleKey, t.createdBy.role.key);
  const approverLabel = approverRoleFor(t.createdBy.role.key) === 'CAC' ? 'le Commissaire aux comptes' : 'la Trésorière';
  const variance = t.quoteAmountMad != null ? describeVariance(num(t.quoteAmountMad), num(t.amountMad)) : null;
  const pol = editPolicy({ status: t.status, type: t.type, isCreator: t.createdById === user.id, canRequest: can('expenses.request'), canEdit: can('transactions.edit') });
  const closed = t.status === 'CANCELLED' || t.status === 'CONTROLLED';

  return (
    <>
      <PageHeader title={`${t.reference} — ${isExpense ? 'Dépense' : 'Recette'}`} sub={t.description} actions={<StatusBadge status={t.status} />} />
      <Flash error={searchParams.error} ok={searchParams.ok} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="card">
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div><dt className="label">Montant</dt><dd className="text-lg font-bold">{mad(t.amountMad)}{t.currency !== 'MAD' && <span className="ml-2 text-xs font-normal text-slate-500">({String(t.amount)} {t.currency} × {String(t.exchangeRate)})</span>}</dd></div>
              <div><dt className="label">Date</dt><dd>{dt(t.transactionDate)}</dd></div>
              <div><dt className="label">Catégorie</dt><dd>{t.category.name}</dd></div>
              <div><dt className="label">Compte</dt><dd>{t.account.name}</dd></div>
              <div><dt className="label">Activité</dt><dd>{t.activity ? <Link className="underline" href={`/activites/${t.activity.id}`}>{t.activity.name}</Link> : '—'}</dd></div>
              <div><dt className="label">Région d’origine</dt><dd>{t.region?.name ?? '—'}</dd></div>
              <div><dt className="label">Moyen de paiement</dt><dd>{t.paymentMethod ?? '—'}</dd></div>
              <div><dt className="label">Réf. bancaire</dt><dd>{t.bankReference ?? '—'}</dd></div>
              <div><dt className="label">Créée par</dt><dd>{t.createdBy.name} — {dtt(t.createdAt)}</dd></div>
              <div><dt className="label">Autorisée par</dt><dd>{t.validatedBy ? `${t.validatedBy.name} — ${dtt(t.validatedAt)}` : '—'}</dd></div>
              <div><dt className="label">Payée par</dt><dd>{t.paidBy ? `${t.paidBy.name} — ${dtt(t.paidAt)}` : '—'}</dd></div>
              <div><dt className="label">Contrôlée par</dt><dd>{t.controlledBy ? `${t.controlledBy.name} — ${dtt(t.controlledAt)}` : '—'}</dd></div>
              {t.cancelReason && <div className="col-span-2"><dt className="label">Annulée par {t.cancelledBy?.name}</dt><dd className="text-red-700">{t.cancelReason}</dd></div>}
            </dl>
            {budget && (
              <div className={`mt-4 rounded-lg px-3 py-2 text-sm ${budget.over || budget.noLine ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-800'}`}>
                {budget.noLine ? 'Aucune ligne budgétaire pour cette catégorie dans l’activité.' : `Budget disponible : ${mad(budget.remaining)} sur ${mad(budget.planned)} prévus${budget.over ? ' — dépassement !' : '.'}`}
              </div>
            )}
            {variance && (
              <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${variance.kind === 'EQUAL' ? 'bg-green-50 text-green-800' : variance.kind === 'OVER' ? 'bg-red-50 text-red-800' : 'bg-blue-50 text-blue-800'}`}>
                Devis : <b>{mad(t.quoteAmountMad)}</b> · Dépense réelle : <b>{mad(t.amountMad)}</b> →{' '}
                {variance.kind === 'EQUAL' ? 'aucune différence.' : <b>{variance.kind === 'OVER' ? '+' : '−'}{mad(Math.abs(variance.diff))}{variance.pct != null ? ` (${variance.pct > 0 ? '+' : ''}${variance.pct} %)` : ''}</b>}
                {t.varianceReason && <span> Motif : {t.varianceReason}</span>}
              </div>
            )}
            {accBal && (() => {
              const avail = accBal.available + (t.status === 'APPROVED' ? num(t.amountMad) : 0); // hors cette dépense
              const short = avail < num(t.amountMad);
              return <div className={`mt-3 rounded-lg px-3 py-2 text-sm ${short ? 'bg-red-50 text-red-800' : 'bg-slate-50 text-slate-700'}`}>
                Compte « {accBal.name} » : solde comptable {mad(accBal.balance)}, engagé {mad(accBal.committed)}, disponible {mad(accBal.available)}.{short && ' ⚠ Solde disponible insuffisant pour cette dépense.'}
                {t.status === 'APPROVED' && ' Le compte sera débité au paiement.'}
              </div>;
            })()}
            {t.aiRiskScore != null && t.aiRiskScore >= 0.6 && <div className="mt-3"><Badge tone="red">Score de risque IA : {Math.round(t.aiRiskScore * 100)} %</Badge></div>}
          </div>

          <div className="card">
            <h2 className="mb-3 font-semibold">Justificatifs ({t.attachments.length})</h2>
            {!t.attachments.length && <p className="text-sm text-amber-700">Aucun justificatif joint.</p>}
            <ul className="divide-y divide-slate-100 text-sm">
              {t.attachments.map((a) => (
                <li key={a.id} className="flex justify-between py-2">
                  <span><Badge tone="blue">{KIND_LABEL[a.kind]}</Badge> <a className="underline" href={`/api/attachments/${a.id}`} target="_blank">{a.fileName}</a></span>
                  <span className="text-right text-xs text-slate-400">{a.uploadedBy.name} · {dt(a.createdAt)}
                    {can('data.delete') && <div className="mt-1"><DeleteBox compact action={deleteAttachment.bind(null, a.id)} label="Supprimer" /></div>}</span>
                </li>
              ))}
            </ul>
            {can('attachments.upload') && !closed && (
              <form action={addAttachment.bind(null, t.id)} className="mt-4 flex flex-wrap items-end gap-2">
                <Field label="Type"><select name="kind" className="input">{Object.entries(KIND_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
                <Field label="Fichier"><input type="file" name="file" required accept=".pdf,image/*" className="input" /></Field>
                <button className="btn">Ajouter</button>
              </form>
            )}
          </div>

          {(t.observations.length > 0 || (can('audit.observe') && treasurers.length > 0)) && (
            <div className="card">
              <h2 className="mb-3 font-semibold">Observations d’audit</h2>
              {t.observations.map((o) => (
                <div key={o.id} className="mb-2 rounded-lg bg-slate-50 p-3 text-sm"><div className="flex justify-between"><b>{o.title}</b><Badge tone={o.status === 'CLOSED' ? 'green' : 'amber'}>{OBS_LABEL[o.status]}</Badge></div>
                  <p className="text-slate-600">{o.description}</p>{o.response && <p className="mt-1 text-slate-800">↳ {o.response}</p>}</div>
              ))}
              {can('audit.observe') && treasurers.length > 0 && (
                <form action={openObservation} className="mt-3 grid gap-2 md:grid-cols-2">
                  <input type="hidden" name="transactionId" value={t.id} /><input type="hidden" name="back" value={`/depenses/${t.id}`} />
                  <input name="title" required placeholder="Titre de l’observation" className="input" />
                  <select name="assigneeId" className="input">{treasurers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
                  <textarea name="description" required placeholder="Constat…" className="input md:col-span-2" rows={2} />
                  <button className="btn-sec md:w-56">Ouvrir une observation</button>
                </form>
              )}
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="card space-y-3">
            <h2 className="font-semibold">Actions</h2>
            {isExpense && t.status === 'DRAFT' && can('expenses.request') && (
              <form action={submitExpense.bind(null, t.id)}><button className="btn w-full">Soumettre pour autorisation</button></form>
            )}
            {isExpense && t.status === 'PENDING_APPROVAL' && can('expenses.approve') && (
              route ? <p className="text-sm text-amber-700">{route}</p> : block ? <p className="text-sm text-amber-700">{block}</p> : (
                <form action={decideExpense.bind(null, t.id)} className="space-y-2">
                  {required > 1 && <p className="text-xs text-slate-500">Double validation : autorisation {approvedBy.length + 1}/{required}.</p>}
                  <textarea name="comment" placeholder="Commentaire (obligatoire pour refuser)" className="input" rows={2} />
                  <div className="flex gap-2"><button name="decision" value="APPROVED" className="btn flex-1">Autoriser</button><button name="decision" value="REJECTED" className="btn-danger flex-1">Refuser</button></div>
                </form>
              )
            )}
            {isExpense && t.status === 'APPROVED' && can('expenses.pay') && (
              <form action={payExpense.bind(null, t.id)} className="space-y-2">
                <p className="text-xs text-slate-500">Devis autorisé : <b>{mad(t.amount)}</b>{t.currency !== 'MAD' && ` (${t.currency})`}. Saisissez le montant <b>réel</b> dépensé : le compte sera débité de ce montant.</p>
                <div><label className="label">Dépense réelle ({t.currency})</label><input name="actualAmount" inputMode="decimal" defaultValue={String(num(t.amount))} required className="input" /></div>
                <div><label className="label">Motif de l’écart (obligatoire si le réel diffère du devis)</label><input name="varianceReason" placeholder="Ex. : hausse du prix du transport" className="input" /></div>
                <input name="bankReference" defaultValue={t.bankReference ?? ''} placeholder="Référence bancaire / virement" className="input" />
                <input type="file" name="proof" accept=".pdf,image/*" className="input" />
                <button className="btn w-full">Enregistrer la dépense réelle</button>
              </form>
            )}
            {t.status === 'PAID' && can('audit.control') && (
              <form action={controlTransaction.bind(null, t.id)}><button className="btn w-full">Valider le contrôle</button></form>
            )}
            {pol.allowed && <Link className="btn-sec block text-center" href={`/depenses/${t.id}/modifier`}>Modifier{pol.needsReason ? ' (avec motif)' : ''}</Link>}
            {!closed && can('transactions.cancel') && (
              <form action={cancelTransaction.bind(null, t.id)} className="space-y-2 border-t border-slate-100 pt-3">
                <input name="reason" required placeholder="Motif d’annulation" className="input" />
                <button className="btn-danger w-full">Annuler l’opération</button>
              </form>
            )}
            {!['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID'].includes(t.status) && <p className="text-sm text-slate-400">Aucune action disponible.</p>}
            {can('data.delete') && (
              <div className="border-t border-slate-100 pt-3">
                <DeleteBox action={deleteTransaction.bind(null, t.id)} label="Supprimer l’opération" warn="L’opération, ses autorisations et ses justificatifs sont supprimés définitivement (impossible si la période est verrouillée par le Commissaire aux comptes)." />
              </div>
            )}
          </div>

          <div className="card"><h2 className="mb-3 font-semibold">Autorisations</h2>
            {isExpense && t.status === 'PENDING_APPROVAL' && <p className="mb-2 text-xs text-slate-500">Autorisation requise de {approverLabel} (demande de {t.createdBy.name}).</p>}
            {!t.approvals.length && <p className="text-sm text-slate-400">—</p>}
            {t.approvals.map((a) => (
              <div key={a.id} className={`mb-2 text-sm ${a.supersededAt ? 'opacity-50 line-through' : ''}`}><Badge tone={a.decision === 'APPROVED' ? 'green' : a.decision === 'REJECTED' ? 'red' : 'amber'}>{a.decision}</Badge> {a.approver?.name} <span className="text-xs text-slate-400">niv. {a.level} · {dt(a.decidedAt)}{a.supersededAt ? ' · invalidée par modification' : ''}</span>{a.comment && <p className="text-slate-500">{a.comment}</p>}</div>
            ))}
          </div>

          <div className="card"><h2 className="mb-3 font-semibold">Historique (journal immuable)</h2>
            <ul className="space-y-2 text-xs">{history.map((h) => (
              <li key={h.id}><b>{h.action}</b> — {h.user?.name ?? 'système'}<div className="text-slate-400">{dtt(h.createdAt)}{h.reason ? ` · ${h.reason}` : ''}</div></li>
            ))}</ul>
          </div>
        </div>
      </div>
    </>
  );
}