import { db } from '@/lib/db';
import { getUser } from '@/lib/session';
import { readStored } from '@/lib/storage';

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const u = await getUser();
  if (!u || !u.perms.has('attachments.view')) return new Response('Forbidden', { status: 403 });
  const a = await db.attachment.findUnique({ where: { id: params.id } });
  if (!a) return new Response('Not found', { status: 404 });
  const buf = await readStored(a.storageKey);
  return new Response(new Uint8Array(buf), {
    headers: { 'Content-Type': a.mimeType, 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(a.fileName)}`, 'X-Content-Type-Options': 'nosniff' },
  });
}
