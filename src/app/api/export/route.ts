import ExcelJS from 'exceljs';
import { db } from '@/lib/db';
import { getUser } from '@/lib/session';
import { audit } from '@/lib/audit';
import { dt, num, mad, STATUS_LABEL } from '@/lib/format';
import { PdfReport } from '@/lib/pdf';

export async function GET(req: Request) {
  const u = await getUser();
  if (!u || !u.perms.has('reports.view')) return new Response('Forbidden', { status: 403 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from') ? new Date(sp.get('from')!) : new Date(new Date().getFullYear(), 0, 1);
  const to = sp.get('to') ? new Date(sp.get('to') + 'T23:59:59') : new Date();
  const rows = await db.transaction.findMany({
    where: { transactionDate: { gte: from, lte: to } }, orderBy: { transactionDate: 'asc' },
    include: { category: true, account: true, activity: true, region: true, createdBy: true, _count: { select: { attachments: true } } },
  });
  const header = ['Référence', 'Date', 'Type', 'Description', 'Catégorie', 'Compte', 'Activité', 'Région', 'Montant', 'Devise', 'Montant MAD', 'Statut', 'Créée par', 'Pièces'];
  const data = rows.map((t) => [t.reference, dt(t.transactionDate), t.type === 'INCOME' ? 'Recette' : 'Dépense', t.description, t.category.name, t.account.name,
    t.activity?.name ?? '', t.region?.name ?? '', num(t.amount), t.currency, num(t.amountMad), STATUS_LABEL[t.status], t.createdBy.name, t._count.attachments]);
  await audit({ userId: u.id, action: 'EXPORT', entity: 'Report', after: { format: sp.get('format'), rows: rows.length } });

  if (sp.get('format') === 'pdf') {
    const valid = rows.filter((t) => t.status === 'PAID' || t.status === 'CONTROLLED');
    const sum = (f: (t: (typeof rows)[number]) => boolean) => valid.filter(f).reduce((s, t) => s + num(t.amountMad), 0);
    const inc = sum((t) => t.type === 'INCOME'), exp = sum((t) => t.type === 'EXPENSE');
    const noProof = valid.filter((t) => t.type === 'EXPENSE' && t._count.attachments === 0).length;
    const rep = await PdfReport.create('Rapport financier', `Période du ${dt(from)} au ${dt(to)} — opérations payées ou contrôlées pour les totaux — édité par ${u.name}`);
    rep.kpis([{ label: 'Recettes', value: mad(inc) }, { label: 'Dépenses', value: mad(exp) }, { label: 'Résultat', value: mad(inc - exp) },
      { label: 'Opérations', value: String(rows.length) }, { label: 'Dépenses sans justificatif', value: String(noProof) }]);
    const byCat = new Map<string, { inc: number; exp: number }>();
    for (const t of valid) { const e = byCat.get(t.category.name) ?? { inc: 0, exp: 0 }; if (t.type === 'INCOME') e.inc += num(t.amountMad); else e.exp += num(t.amountMad); byCat.set(t.category.name, e); }
    rep.section('Synthèse par catégorie');
    rep.table([{ label: 'Catégorie', width: 300 }, { label: 'Recettes (MAD)', width: 140, align: 'right' }, { label: 'Dépenses (MAD)', width: 140, align: 'right' }],
      Array.from(byCat, ([k, v]) => [k, v.inc ? mad(v.inc) : '', v.exp ? mad(v.exp) : '']), 8);
    rep.section('Détail des opérations');
    rep.table([
      { label: 'Référence', width: 88 }, { label: 'Date', width: 52 }, { label: 'Type', width: 44 }, { label: 'Description', width: 200 }, { label: 'Catégorie', width: 95 },
      { label: 'Activité', width: 90 }, { label: 'Montant MAD', width: 72, align: 'right' }, { label: 'Statut', width: 80 }, { label: 'Pièces', width: 38, align: 'right' },
    ], rows.map((t) => [t.reference, dt(t.transactionDate), t.type === 'INCOME' ? 'Recette' : 'Dépense', t.description, t.category.name, t.activity?.name ?? '', mad(t.amountMad), STATUS_LABEL[t.status], String(t._count.attachments)]));
    const pdf = await rep.finish();
    return new Response(new Uint8Array(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="rapport-financier.pdf"' } });
  }

  if (sp.get('format') === 'csv') {
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const csv = '\uFEFF' + [header, ...data].map((r) => r.map(esc).join(';')).join('\n');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="operations.csv"' } });
  }
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Opérations');
  ws.addRow(header).font = { bold: true };
  data.forEach((r) => ws.addRow(r));
  ws.columns.forEach((c) => { c.width = 18; });
  const buf = await wb.xlsx.writeBuffer();
  return new Response(new Uint8Array(buf as ArrayBuffer), {
    headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': 'attachment; filename="operations.xlsx"' },
  });
}
