import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { createActivity } from '@/actions/activities';
import { Field, Flash, PageHeader } from '@/components/ui';

export default async function NewActivity({ searchParams }: { searchParams: { error?: string } }) {
  await requirePage('activities.manage');
  const [users, regions] = await Promise.all([db.user.findMany({ where: { active: true }, orderBy: { name: 'asc' } }), db.region.findMany({ where: { active: true }, orderBy: { name: 'asc' } })]);
  return (
    <>
      <PageHeader title="Nouvelle activité" />
      <Flash error={searchParams.error} />
      <form action={createActivity} className="card grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2"><Field label="Nom"><input name="name" required className="input" /></Field></div>
        <div className="md:col-span-2"><Field label="Description"><textarea name="description" rows={2} className="input" /></Field></div>
        <Field label="Début"><input type="date" name="startDate" required className="input" /></Field>
        <Field label="Fin"><input type="date" name="endDate" required className="input" /></Field>
        <Field label="Responsable"><select name="managerId" className="input"><option value="">—</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></Field>
        <Field label="Région de rattachement"><select name="regionId" className="input"><option value="">—</option>{regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
        <div><button className="btn">Créer</button></div>
      </form>
    </>
  );
}
