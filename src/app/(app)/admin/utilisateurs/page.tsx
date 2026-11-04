import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { createUser, toggleUser, updateUser } from '@/actions/admin';
import { adminResetTotp } from '@/actions/account';
import { Badge, Field, Flash } from '@/components/ui';

export default async function Users({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const me = await requirePage('admin.users');
  const [users, roles] = await Promise.all([db.user.findMany({ include: { role: true }, orderBy: { name: 'asc' } }), db.role.findMany({ orderBy: { name: 'asc' } })]);
  const temp = cookies().get('jeeam_temp')?.value;
  const [tempName, ...tempRest] = (temp ?? '').split('|');
  const tempPwd = tempRest.join('|');
  return (
    <>
      <Flash {...searchParams} />
      {temp && tempPwd && (
        <div className="card mb-4 border-green-300">
          <h2 className="font-semibold">Mot de passe temporaire pour {tempName}</h2>
          <p className="my-2 select-all rounded bg-slate-100 px-3 py-2 font-mono text-lg">{tempPwd}</p>
          <p className="text-xs text-slate-500">Transmettez-le à la personne par un canal sûr. Il n’est affiché qu’une fois. À sa première connexion, elle devra le remplacer par son propre mot de passe (qu’elle seule connaîtra) puis scanner son propre QR de double authentification.</p>
        </div>
      )}
      <form action={createUser} className="card mb-6 grid gap-3 md:grid-cols-5">
        <Field label="Nom"><input name="name" required className="input" /></Field><Field label="E-mail"><input name="email" type="email" required className="input" /></Field>
        <Field label="Rôle"><select name="roleId" className="input">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Mot de passe initial (ou cochez « générer »)"><input name="password" type="password" autoComplete="new-password" className="input" /></Field>
        <div className="flex flex-col justify-end gap-2"><label className="flex items-center gap-2 text-sm"><input type="checkbox" name="generate" /> Générer un mot de passe temporaire</label><button className="btn w-full">Créer</button></div>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="tbl"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id} className="align-top"><td><b>{u.name}</b><div className="text-xs text-slate-400">{u.email}</div></td>
              <td>{u.role.name}</td>
              <td>{u.active ? <Badge tone="green">actif</Badge> : <Badge>désactivé</Badge>} {u.totpEnabled && <Badge tone="blue">2FA</Badge>}</td>
              <td className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  {u.id !== me.id && <form action={toggleUser.bind(null, u.id)}><button className="btn-sec btn-sm">{u.active ? 'Désactiver' : 'Réactiver'}</button></form>}
                  {(u.totpEnabled || u.totpSecret) && (u.id !== me.id
                    ? <form action={adminResetTotp.bind(null, u.id)}><button className="btn-sec btn-sm">Réinit. 2FA</button></form>
                    : <form action={adminResetTotp.bind(null, u.id)} className="flex gap-1"><input name="password" type="password" required placeholder="Votre mot de passe" className="input w-40" /><button className="btn-sec btn-sm">Réinit. ma 2FA</button></form>)}
                </div>
                <details>
                  <summary className="cursor-pointer text-sm text-brand-700 underline">Modifier (nom, e-mail, rôle, mot de passe)</summary>
                  <form action={updateUser.bind(null, u.id)} className="mt-2 grid gap-2 md:grid-cols-2">
                    <div><label className="label">Nom</label><input name="name" required defaultValue={u.name} className="input" /></div>
                    <div><label className="label">E-mail</label><input name="email" type="email" required defaultValue={u.email} className="input" /></div>
                    <div><label className="label">Rôle{u.id === me.id && ' (non modifiable sur votre propre compte)'}</label>
                      <select name="roleId" defaultValue={u.roleId} className="input">{roles.map((r) => <option key={r.id} value={r.id} disabled={u.id === me.id && r.id !== u.roleId}>{r.name}</option>)}</select></div>
                    <div><label className="label">Nouveau mot de passe (laisser vide = inchangé)</label><input name="password" type="password" autoComplete="new-password" placeholder="10 car. min., lettre + chiffre" className="input" />
                      <label className="mt-1 flex items-center gap-2 text-xs"><input type="checkbox" name="generate" /> Ou générer un mot de passe temporaire</label></div>
                    <p className="text-xs text-amber-700 md:col-span-2">Si vous changez l’e-mail, la double authentification de la personne est réinitialisée : elle scannera un nouveau QR à sa prochaine connexion.</p>
                    <button className="btn btn-sm md:col-span-2">Enregistrer les modifications</button>
                  </form>
                </details>
              </td></tr>
          ))}</tbody></table>
      </div>
    </>
  );
}