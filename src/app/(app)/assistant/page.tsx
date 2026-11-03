import { requirePage } from '@/lib/session';
import { PageHeader } from '@/components/ui';
import { ChatBox } from '@/components/client';

export default async function Assistant() {
  await requirePage('ai.use');
  return (
    <>
      <PageHeader title="Assistant IA" sub="L’IA assiste et résume ; elle n’écrit jamais d’opération validée (seulement des brouillons, soumis à votre vérification)." />
      <ChatBox />
    </>
  );
}
