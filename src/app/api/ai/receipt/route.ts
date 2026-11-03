import { getUser } from '@/lib/session';
import { audit } from '@/lib/audit';
import { chatJson, aiEnabled, type Part } from '@/lib/ai';
import { sniffMime } from '@/lib/filetype';

const CUR = ['MAD', 'EUR', 'USD', 'XOF', 'XAF'];
type Out = { amount?: number | string; currency?: string; date?: string; merchant?: string; description?: string };

// Lecture d'un reçu / d'une facture (image ou PDF) : pré-remplit le formulaire, rien n'est enregistré ici.
export async function POST(req: Request) {
  const u = await getUser();
  if (!u || !(u.perms.has('expenses.request') || u.perms.has('income.record'))) return Response.json({ error: 'Non autorisé' }, { status: 403 });
  if (!aiEnabled()) return Response.json({ error: 'Module IA non configuré (OPENAI_API_KEY).' }, { status: 503 });
  const f = (await req.formData().catch(() => null))?.get('file');
  if (!(f instanceof File) || !f.size) return Response.json({ error: 'Fichier manquant.' }, { status: 400 });
  if (f.size > 10 * 1024 * 1024) return Response.json({ error: 'Fichier trop volumineux (10 Mo max).' }, { status: 400 });
  const buf = Buffer.from(await f.arrayBuffer());
  const mime = sniffMime(buf);
  if (!mime) return Response.json({ error: 'Format non accepté (PDF, JPG, PNG ou WEBP).' }, { status: 400 });
  const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
  const part: Part = mime === 'application/pdf' ? { type: 'file', file: { filename: 'recu.pdf', file_data: dataUrl } } : { type: 'image_url', image_url: { url: dataUrl } };
  const r = await chatJson<Out>(
    'Tu extrais les données d’un reçu ou d’une facture. Réponds en JSON : {"amount": <total TTC en nombre>, "currency": "MAD|EUR|USD|XOF|XAF", "date": "YYYY-MM-DD", "merchant": "<fournisseur>", "description": "<objet en 8 mots max>"}. Mets null pour toute valeur illisible ; n’invente rien.',
    [{ type: 'text', text: 'Extrais les informations de ce document.' }, part]);
  if (!r) return Response.json({ error: 'Lecture impossible (service IA indisponible ou document illisible).' }, { status: 502 });
  const amount = Number(String(r.amount ?? '').replace(',', '.'));
  const out = {
    amount: amount > 0 ? amount : null,
    currency: CUR.includes(String(r.currency)) ? String(r.currency) : null,
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(r.date)) ? String(r.date) : null,
    description: [r.merchant, r.description].filter(Boolean).join(' — ').slice(0, 200) || null,
  };
  await audit({ userId: u.id, action: 'AI_RECEIPT_READ', entity: 'AI', after: { file: f.name.slice(0, 80), extracted: out } });
  return Response.json({ data: out, note: 'Vérifiez ces informations avant d’enregistrer.' });
}
