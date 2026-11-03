import JSZip from 'jszip';
import { db } from '@/lib/db';
import { getUser } from '@/lib/session';
import { readStored } from '@/lib/storage';
import { audit } from '@/lib/audit';

export async function GET(req: Request) {
  const u = await getUser();
  if (!u || !u.perms.has('attachments.view')) return new Response('Forbidden', { status: 403 });
  const sp = new URL(req.url).searchParams;
  const from = sp.get('from'), to = sp.get('to'), activityId = sp.get('activityId'), categoryId = sp.get('categoryId');
  const list = await db.attachment.findMany({
    where: { transaction: { ...(activityId ? { activityId } : {}), ...(categoryId ? { categoryId } : {}),
      ...(from || to ? { transactionDate: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(to + 'T23:59:59') } : {}) } } : {}) } },
    include: { transaction: true }, take: 500,
  });
  const zip = new JSZip();
  for (const a of list) zip.file(`${a.transaction.reference}/${a.kind}_${a.fileName}`, await readStored(a.storageKey));
  await audit({ userId: u.id, action: 'ATTACHMENTS_ZIP', entity: 'Attachment', after: { count: list.length, from, to, activityId, categoryId } });
  const out = await zip.generateAsync({ type: 'uint8array' });
  return new Response(new Uint8Array(out), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="justificatifs.zip"' } });
}