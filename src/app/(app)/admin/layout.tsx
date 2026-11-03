import { requirePage } from '@/lib/session';
import { PageHeader, Tabs } from '@/components/ui';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const u = await requirePage(['admin.users', 'admin.roles', 'admin.regions', 'regions.manage', 'admin.auditlog', 'admin.settings']);
  const has = (...p: string[]) => p.some((k) => u.perms.has(k));
  return (
    <>
      <PageHeader title="Administration" />
      <Tabs current="" items={[
        has('admin.users') && { href: '/admin/utilisateurs', label: 'Utilisateurs' }, has('admin.roles') && { href: '/admin/roles', label: 'Rôles & permissions' },
        has('admin.regions', 'regions.manage') && { href: '/admin/regions', label: 'Églises régionales' }, has('admin.settings') && { href: '/admin/parametres', label: 'Paramètres' },
        has('admin.auditlog') && { href: '/admin/journal', label: 'Journal d’audit' },
      ].filter((x): x is { href: string; label: string } => !!x)} />
      {children}
    </>
  );
}
