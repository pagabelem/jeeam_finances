import { requirePage } from '@/lib/session';
import { getThreshold, getDoubleThreshold, getSettingNumber } from '@/lib/domain';
import { saveSettings } from '@/actions/admin';
import { Field, Flash } from '@/components/ui';

export default async function Settings({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  await requirePage('admin.settings');
  const [t, d, days, day] = await Promise.all([getThreshold(), getDoubleThreshold(), getSettingNumber('reminderPendingDays', 3), getSettingNumber('contributionReminderDay', 5)]);
  return (
    <>
      <Flash {...searchParams} />
      <form action={saveSettings} className="card max-w-xl space-y-4">
        <Field label="Seuil d’auto-autorisation (MAD)"><input name="threshold" defaultValue={t} className="input" /></Field>
        <p className="-mt-2 text-xs text-slate-500">En dessous (ou égal à) ce montant, le demandeur habilité peut autoriser sa propre dépense. Au-delà, une personne distincte doit l’autoriser.</p>
        <Field label="Seuil de double validation (MAD) — vide = désactivée"><input name="doubleThreshold" defaultValue={d ?? ''} className="input" /></Field>
        <p className="-mt-2 text-xs text-slate-500">Au-delà de ce montant, deux personnes distinctes (différentes du demandeur) doivent autoriser la dépense.</p>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Rappels : délai (jours)"><input name="reminderDays" defaultValue={days ?? 3} className="input" /></Field>
          <Field label="Rappel cotisations : jour du mois"><input name="contributionDay" defaultValue={day ?? 5} className="input" /></Field>
        </div>
        <button className="btn">Enregistrer</button>
      </form>
    </>
  );
}
