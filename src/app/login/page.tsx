'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function LoginPage() {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    const fd = new FormData(e.currentTarget);
    const r = await signIn('credentials', { email: fd.get('email'), password: fd.get('password'), code: fd.get('code') ?? '', redirect: false });
    if (r?.error) { setError('Identifiants ou code invalides, ou compte temporairement verrouillé.'); setBusy(false); }
    else window.location.href = '/';
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4">
        <div><h1 className="text-xl font-bold text-brand-700">JEEAM Finance</h1><p className="text-sm text-slate-500">Bureau National — connexion</p></div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div><label className="label">E-mail</label><input name="email" type="email" required autoComplete="username" className="input" /></div>
        <div><label className="label">Mot de passe</label><input name="password" type="password" required autoComplete="current-password" className="input" /></div>
        <div><label className="label">Code de vérification (si activé)</label><input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456 ou code de secours" className="input" /></div>
        <button className="btn w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
      </form>
    </div>
  );
}
