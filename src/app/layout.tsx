import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'JEEAM Finance', description: 'Gestion financière, contrôle interne et audit — JEEAM National' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body className="bg-slate-50 text-slate-800 antialiased">{children}</body></html>;
}
