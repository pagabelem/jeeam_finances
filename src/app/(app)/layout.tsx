import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/session';
import { db } from '@/lib/db';
import SignOut from '@/components/signout';

const NAV: { href: string; label: string; perms?: string[] }[] = [
  { href: '/', label: 'Tableau de bord' },
  { href: '/tresorerie', label: 'Trésorerie', perms: ['transactions.view'] },
  { href: '/depenses', label: 'Dépenses', perms: ['transactions.view'] },
  { href: '/activites', label: 'Activités', perms: ['activities.view'] },
  { href: '/audit', label: 'Commissaire aux comptes', perms: ['audit.view'] },
  { href: '/rapports', label: 'Rapports', perms: ['reports.view'] },
  { href: '/justificatifs', label: 'Justificatifs', perms: ['attachments.view'] },
  { href: '/assistant', label: 'Assistant IA', perms: ['ai.use'] },
  { href: '/admin/utilisateurs', label: 'Administration', perms: ['admin.users', 'admin.roles', 'admin.regions', 'regions.manage', 'admin.auditlog', 'admin.settings'] },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  if (!user) redirect('/login');
  // Mot de passe initial ou 2FA obligatoire non configurée : accès limité à /profil.
  if (user.mustChangePassword || user.needs2faSetup) redirect('/profil');
  const adminHref = ([['admin.users', '/admin/utilisateurs'], ['admin.roles', '/admin/roles'], ['admin.regions', '/admin/regions'], ['regions.manage', '/admin/regions'], ['admin.settings', '/admin/parametres'], ['admin.auditlog', '/admin/journal']] as const)
    .find(([p]) => user.perms.has(p))?.[1] ?? '/admin/utilisateurs';
  const unread = await db.notification.count({ where: { userId: user.id, readAt: null } });
  return (
    <div className="flex min-h-screen">
      <aside className="w-60 shrink-0 bg-brand-900 p-4 text-slate-200">
        <div className="mb-6"><div className="text-lg font-bold text-white">JEEAM Finance</div><div className="text-xs text-slate-400">Bureau National</div></div>
        <nav className="space-y-1">
          {NAV.filter((n) => !n.perms || n.perms.some((p) => user.perms.has(p))).map((n) => (
            <Link key={n.href} href={n.href === '/admin/utilisateurs' ? adminHref : n.href} className="block rounded-lg px-3 py-2 text-sm hover:bg-white/10">{n.label}</Link>
          ))}
          <Link href="/notifications" className="flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-white/10">
            Notifications {unread > 0 && <span className="rounded-full bg-red-500 px-2 text-xs text-white">{unread}</span>}
          </Link>
        </nav>
        <div className="mt-8 border-t border-white/10 pt-4 text-xs">
          <div className="font-medium text-white">{user.name}</div><div className="text-slate-400">{user.roleName}</div>
          <Link href="/profil" className="mt-2 block text-slate-300 underline">Mon compte{user.totpEnabled ? ' · 2FA ✓' : ''}</Link>
          <SignOut />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-8">{children}</main>
    </div>
  );
}
