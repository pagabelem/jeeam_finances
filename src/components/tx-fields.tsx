import { Field } from '@/components/ui';
import { iso } from '@/lib/format';
import { AiAssist } from '@/components/client';

type Opt = { id: string; name: string };
export type TxValues = {
  amount?: string; currency?: string; rate?: string; date?: string; categoryId?: string; accountId?: string;
  activityId?: string; regionId?: string; paymentMethod?: string; bankReference?: string; description?: string;
};
export function TxFields({ categories, accounts, activities, regions, showQuote, values: v = {}, type = 'EXPENSE', ai = true }: {
  categories: Opt[]; accounts: Opt[]; activities: Opt[]; regions: Opt[]; showQuote?: boolean; values?: TxValues; type?: 'INCOME' | 'EXPENSE'; ai?: boolean;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {ai && <AiAssist type={type} />}
      <Field label="Montant"><input name="amount" required inputMode="decimal" defaultValue={v.amount} className="input" placeholder="450" /></Field>
      <Field label="Devise"><select name="currency" defaultValue={v.currency ?? 'MAD'} className="input">{['MAD', 'EUR', 'USD', 'XOF', 'XAF'].map((c) => <option key={c}>{c}</option>)}</select></Field>
      <Field label="Taux vers MAD (si devise ≠ MAD)"><input name="rate" inputMode="decimal" defaultValue={v.rate} className="input" placeholder="10.8" /></Field>
      <Field label="Date"><input type="date" name="date" required defaultValue={v.date ?? iso(new Date())} className="input" /></Field>
      <Field label="Catégorie"><select name="categoryId" required defaultValue={v.categoryId ?? ''} className="input"><option value="">—</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Compte"><select name="accountId" required defaultValue={v.accountId ?? ''} className="input"><option value="">—</option>{accounts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Activité liée"><select name="activityId" defaultValue={v.activityId ?? ''} className="input"><option value="">—</option>{activities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Région d’origine (église qui verse / concernée)"><select name="regionId" defaultValue={v.regionId ?? ''} className="input"><option value="">—</option>{regions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      <Field label="Moyen de paiement"><input name="paymentMethod" defaultValue={v.paymentMethod} className="input" placeholder="Virement, espèces…" /></Field>
      <Field label="Référence bancaire"><input name="bankReference" defaultValue={v.bankReference} className="input" /></Field>
      <div className="md:col-span-2"><Field label="Description / motif"><input name="description" required defaultValue={v.description} className="input" /></Field></div>
      {showQuote && <Field label="Devis (PDF/image)"><input type="file" name="quote" accept=".pdf,image/*" className="input" /></Field>}
    </div>
  );
}

export async function loadOptions(db: typeof import('@/lib/db').db, type: 'INCOME' | 'EXPENSE') {
  const [categories, accounts, activities, regions] = await Promise.all([
    db.category.findMany({ where: { type, active: true }, orderBy: { name: 'asc' } }),
    db.account.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
    db.activity.findMany({ where: { status: { not: 'CANCELLED' } }, orderBy: { startDate: 'desc' } }),
    db.region.findMany({ where: { active: true }, orderBy: { name: 'asc' } }),
  ]);
  return { categories, accounts, activities, regions, type };
}
