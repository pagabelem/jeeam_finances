import { requirePage } from '@/lib/session';
import { Tabs } from '@/components/ui';

export default async function AuditLayout({ children }: { children: React.ReactNode }) {
  await requirePage('audit.view');
  return (
    <>
      <Tabs current="" items={[
        { href: '/audit', label: 'Synthèse & alertes' }, { href: '/audit/controle', label: 'Opérations à contrôler' },
        { href: '/audit/observations', label: 'Observations' }, { href: '/audit/periodes', label: 'Verrouillage de périodes' },
      ]} />
      {children}
    </>
  );
}
