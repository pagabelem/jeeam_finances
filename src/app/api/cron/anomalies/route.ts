import { db } from '@/lib/db';
import { runAnomalyScan } from '@/lib/anomalies';
import { notifyPerm } from '@/lib/domain';

// Appel planifié (cron système / Vercel Cron) : Authorization: Bearer $CRON_SECRET
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  const scan = await runAnomalyScan();
  const missing = await db.transaction.count({ where: { type: 'EXPENSE', status: 'PAID', attachments: { none: {} } } });
  if (missing) await notifyPerm(db, 'attachments.upload', { title: 'Justificatifs manquants', body: `${missing} dépense(s) payée(s) sans justificatif.`, link: '/justificatifs' });
  return Response.json({ ...scan, missing });
}
