import { indexMissing } from '@/lib/semantic';

// Indexe les opérations sans embedding (1×/jour ou à la demande). Authorization: Bearer $CRON_SECRET
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) return new Response('Unauthorized', { status: 401 });
  return Response.json({ indexed: await indexMissing(300) });
}
