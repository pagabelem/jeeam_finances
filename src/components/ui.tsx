import Link from 'next/link';
import type { ReactNode } from 'react';
import { STATUS_LABEL, STATUS_TONE } from '@/lib/format';

const TONES: Record<string, string> = {
  gray: 'bg-slate-100 text-slate-700', amber: 'bg-amber-100 text-amber-800', blue: 'bg-blue-100 text-blue-800',
  red: 'bg-red-100 text-red-800', indigo: 'bg-indigo-100 text-indigo-800', green: 'bg-green-100 text-green-800',
};

export function Badge({ children, tone = 'gray' }: { children: ReactNode; tone?: string }) {
  return <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone] ?? TONES.gray}`}>{children}</span>;
}
export const StatusBadge = ({ status }: { status: string }) => <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status] ?? status}</Badge>;

export function PageHeader({ title, sub, actions }: { title: string; sub?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div><h1 className="text-2xl font-bold text-slate-900">{title}</h1>{sub && <p className="mt-1 text-sm text-slate-500">{sub}</p>}</div>
      {actions && <div className="no-print flex gap-2">{actions}</div>}
    </div>
  );
}

export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (!error && !ok) return null;
  return (
    <div className={`mb-4 rounded-lg border px-4 py-3 text-sm ${error ? 'border-red-200 bg-red-50 text-red-800' : 'border-green-200 bg-green-50 text-green-800'}`}>
      {error ?? ok}
    </div>
  );
}

export function Tabs({ items, current }: { items: { href: string; label: string }[]; current: string }) {
  return (
    <div className="no-print mb-5 flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((i) => (
        <Link key={i.href} href={i.href}
          className={`-mb-px border-b-2 px-3 py-2 text-sm ${current === i.href ? 'border-brand-600 font-semibold text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
          {i.label}
        </Link>
      ))}
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'red' | 'green' | 'amber' }) {
  const c = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900';
  return <div className="card"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div><div className={`mt-1 text-2xl font-bold ${c}`}>{value}</div></div>;
}

export const Empty = ({ text }: { text: string }) => <p className="py-8 text-center text-sm text-slate-400">{text}</p>;

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><label className="label">{label}</label>{children}</div>;
}

export function Progress({ value }: { value: number }) {
  const v = Math.min(100, Math.max(0, value));
  return <div className="h-2 w-full rounded-full bg-slate-100"><div className={`h-2 rounded-full ${value > 100 ? 'bg-red-500' : value > 85 ? 'bg-amber-500' : 'bg-brand-500'}`} style={{ width: `${v}%` }} /></div>;
}
