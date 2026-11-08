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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden p-4" style={{ background: 'linear-gradient(135deg, #0b1b4d 0%, #1d2f78 45%, #8f2a38 100%)' }}>
      {/* Logo agrandi et fortement flouté en arrière-plan, accompagné de halos aux couleurs de la JEEAM */}
      <div aria-hidden className="absolute inset-0 scale-[1.9] bg-cover bg-center opacity-60 blur-[70px] saturate-150" style={{ backgroundImage: 'url(/logo-jeeam.png)' }} />
      <div aria-hidden className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-[#5cc3cc]/40 blur-3xl" />
      <div aria-hidden className="absolute -bottom-32 -right-20 h-[28rem] w-[28rem] rounded-full bg-[#b5303c]/50 blur-3xl" />
      <div aria-hidden className="absolute inset-0 bg-slate-950/25" />

      <form onSubmit={onSubmit} className="relative z-10 w-full max-w-md space-y-4 rounded-3xl border border-white/40 bg-white/85 p-8 shadow-2xl backdrop-blur-xl">
        <div className="flex flex-col items-center text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-jeeam.png" alt="Jeunesse de l’Église Évangélique au Maroc — JEEAM" width={140} height={163} className="h-32 w-auto drop-shadow-md" />
          <h1 className="mt-3 text-2xl font-bold text-brand-700">JEEAM Finance</h1>
          <p className="text-sm text-slate-500">Bureau National — connexion</p>
        </div>
        {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div><label className="label">E-mail</label><input name="email" type="email" required autoComplete="username" className="input bg-white" /></div>
        <div><label className="label">Mot de passe</label><input name="password" type="password" required autoComplete="current-password" className="input bg-white" /></div>
        <div><label className="label">Code de vérification (si activé)</label><input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="123456 ou code de secours" className="input bg-white" /></div>
        <button className="btn w-full" disabled={busy}>{busy ? 'Connexion…' : 'Se connecter'}</button>
        <p className="text-center text-[11px] text-slate-400">Accès réservé aux membres du Bureau National</p>
      </form>
    </div>
  );
}