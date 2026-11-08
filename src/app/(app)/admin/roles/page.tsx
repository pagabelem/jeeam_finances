import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { saveRolePermissions } from '@/actions/admin';
import { Flash } from '@/components/ui';

export const dynamic = 'force-dynamic';

export default async function Roles({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  await requirePage('admin.roles');
  const [roles, perms] = await Promise.all([db.role.findMany({ include: { permissions: true }, orderBy: { name: 'asc' } }), db.permission.findMany({ orderBy: [{ group: 'asc' }, { label: 'asc' }] })]);
  const groups = Array.from(new Set(perms.map((p) => p.group)));
  return (
    <>
      <Flash {...searchParams} />
      <p className="mb-4 text-sm text-slate-500">RBAC configurable : les permissions se règlent par <b>rôle</b> (elles s’appliquent à tous les membres de ce rôle) et sont contrôlées par le serveur à chaque action. Le rôle Commissaire aux comptes ne peut pas recevoir de permission opérationnelle (saisie, autorisation, paiement).</p>
      <div className="grid gap-6 xl:grid-cols-2">
        {roles.map((r) => (
          <form key={r.id} action={saveRolePermissions.bind(null, r.id)} className="card">
            <h2 className="mb-3 font-semibold">{r.name}</h2>
            {groups.map((g) => (
              <fieldset key={g} className="mb-3"><legend className="label">{g}</legend>
                {perms.filter((p) => p.group === g).map((p) => (
                  <label key={p.id} className="flex items-center gap-2 py-0.5 text-sm"><input type="checkbox" name="perm" value={p.key} defaultChecked={r.permissions.some((rp) => rp.permissionId === p.id)} />{p.label}</label>
                ))}
              </fieldset>
            ))}
            <button className="btn">Enregistrer</button>
          </form>
        ))}
      </div>
    </>
  );
}