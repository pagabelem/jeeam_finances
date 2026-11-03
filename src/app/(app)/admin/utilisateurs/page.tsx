import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { createUser, resetPassword, toggleUser, updateUserRole } from '@/actions/admin';
import { adminResetTotp } from '@/actions/account';
import { Badge, Field, Flash } from '@/components/ui';

export default async function Users({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const me = await requirePage('admin.users');
  const [users, roles] = await Promise.all([db.user.findMany({ include: { role: true }, orderBy: { name: 'asc' } }), db.role.findMany({ orderBy: { name: 'asc' } })]);
  return (
    <>
      <Flash {...searchParams} />
      <form action={createUser} className="card mb-6 grid gap-3 md:grid-cols-5">
        <Field label="Nom"><input name="name" required className="input" /></Field><Field label="E-mail"><input name="email" type="email" required className="input" /></Field>
        <Field label="Rôle"><select name="roleId" className="input">{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <Field label="Mot de passe initial"><input name="password" type="password" required className="input" /></Field>
        <div className="flex items-end"><button className="btn w-full">Créer</button></div>
      </form>
      <div className="card overflow-x-auto p-0">
        <table className="tbl"><thead><tr><th>Utilisateur</th><th>Rôle</th><th>Statut</th><th>Actions</th></tr></thead>
          <tbody>{users.map((u) => (
            <tr key={u.id}><td><b>{u.name}</b><div className="text-xs text-slate-400">{u.email}</div></td>
              <td><form action={updateUserRole.bind(null, u.id)} className="flex gap-1"><select name="roleId" defaultValue={u.roleId} className="input w-48" disabled={u.id === me.id}>{roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select>{u.id !== me.id && <button className="btn-sec btn-sm">OK</button>}</form></td>
              <td>{u.active ? <Badge tone="green">actif</Badge> : <Badge>désactivé</Badge>} {u.totpEnabled && <Badge tone="blue">2FA</Badge>}</td>
              <td className="flex flex-wrap gap-2">
                {u.id !== me.id && <form action={toggleUser.bind(null, u.id)}><button className="btn-sec btn-sm">{u.active ? 'Désactiver' : 'Réactiver'}</button></form>}
                {u.id !== me.id && u.totpEnabled && <form action={adminResetTotp.bind(null, u.id)}><button className="btn-sec btn-sm">Réinit. 2FA</button></form>}
                <form action={resetPassword.bind(null, u.id)} className="flex gap-1"><input name="password" type="password" placeholder="Nouveau mot de passe" className="input w-44" /><button className="btn-sec btn-sm">Réinitialiser</button></form>
              </td></tr>
          ))}</tbody></table>
      </div>
    </>
  );
}
