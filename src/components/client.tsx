'use client';
import { useEffect, useRef, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export function PrintButton() {
  return <button type="button" className="btn-sec" onClick={() => window.print()}>Imprimer / PDF</button>;
}

export function MonthlyChart({ data }: { data: { month: string; recettes: number; depenses: number }[] }) {
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="month" fontSize={12} /><YAxis fontSize={12} /><Tooltip /><Legend />
          <Bar dataKey="recettes" name="Recettes" fill="#2f5fd0" /><Bar dataKey="depenses" name="Dépenses" fill="#e0693a" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

type Msg = { role: 'user' | 'assistant'; content: string };
export function ChatBox() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...msgs, { role: 'user' as const, content: text }];
    setMsgs(next); setInput(''); setBusy(true);
    try {
      const r = await fetch('/api/ai/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ messages: next }) });
      const j = await r.json();
      setMsgs([...next, { role: 'assistant', content: j.reply ?? j.error ?? 'Erreur.' }]);
    } catch {
      setMsgs([...next, { role: 'assistant', content: 'Erreur réseau.' }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="card flex h-[65vh] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto">
        {!msgs.length && <p className="text-sm text-slate-400">Exemples : « montre les dépenses de plus de 1000 MAD sans justificatif », « résume la situation financière en 5 points », « ajoute un brouillon de dépense de 450 MAD transport pour… ».</p>}
        {msgs.map((m, i) => (
          <div key={i} className={`max-w-[85%] whitespace-pre-wrap rounded-xl px-4 py-2 text-sm ${m.role === 'user' ? 'ml-auto bg-brand-600 text-white' : 'bg-slate-100 text-slate-800'}`}>{m.content}</div>
        ))}
        {busy && <div className="text-sm text-slate-400">…</div>}
      </div>
      <div className="mt-3 flex gap-2">
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Posez votre question…" />
        <button className="btn" onClick={send} disabled={busy}>Envoyer</button>
      </div>
    </div>
  );
}

type Suggestion = { categoryId: string; name: string; confidence: number; source: string };

/** Aides IA à la saisie : suggestion de catégorie (jamais appliquée automatiquement) et lecture d'un reçu qui pré-remplit le formulaire. */
export function AiAssist({ type }: { type: 'INCOME' | 'EXPENSE' }) {
  const box = useRef<HTMLDivElement>(null);
  const [sug, setSug] = useState<Suggestion | null>(null);
  const [applied, setApplied] = useState(false);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const field = (n: string) => box.current?.closest('form')?.elements.namedItem(n) as HTMLInputElement | HTMLSelectElement | null;

  async function suggest(force = false) {
    const d = field('description')?.value ?? '';
    if (d.trim().length < 3 || (!force && field('categoryId')?.value)) return;
    try {
      const r = await fetch('/api/ai/suggest-category', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ description: d, type, amount: field('amount')?.value }) });
      const j = await r.json();
      setSug(j.suggestion ?? null); setApplied(false);
      if (!j.suggestion && force) setMsg('Aucune suggestion pour cette description.');
    } catch { /* suggestion facultative */ }
  }

  useEffect(() => {
    const d = field('description');
    if (!d) return;
    const h = () => { void suggest(false); };
    d.addEventListener('blur', h);
    return () => d.removeEventListener('blur', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function apply() {
    if (!sug) return;
    const c = field('categoryId'); if (c) c.value = sug.categoryId;
    setApplied(true);
  }

  async function readReceipt(file: File | undefined) {
    if (!file) return;
    setBusy(true); setMsg('Lecture du document…');
    try {
      const fd = new FormData(); fd.set('file', file);
      const r = await fetch('/api/ai/receipt', { method: 'POST', body: fd });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error ?? 'Lecture impossible.'); return; }
      const d = j.data as { amount: number | null; currency: string | null; date: string | null; description: string | null };
      const set = (n: string, v: string | number | null) => { const f = field(n); if (f && v != null && v !== '') f.value = String(v); };
      set('amount', d.amount); set('currency', d.currency); set('date', d.date); set('description', d.description);
      setMsg('Champs pré-remplis depuis le document. Vérifiez-les avant d’enregistrer ; joignez ensuite le justificatif à l’opération.');
      void suggest(false);
    } catch { setMsg('Erreur réseau.'); } finally { setBusy(false); }
  }

  return (
    <div ref={box} className="md:col-span-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 text-sm">
      <input type="hidden" name="aiCategory" value={applied && sug ? sug.name : ''} />
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-medium text-slate-600">Aide IA</span>
        <button type="button" className="btn-sec btn-sm" onClick={() => suggest(true)}>Suggérer la catégorie</button>
        <label className="btn-sec btn-sm cursor-pointer">{busy ? '…' : 'Lire un reçu / une facture'}
          <input type="file" accept=".pdf,image/*" className="hidden" disabled={busy} onChange={(e) => { void readReceipt(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        {sug && <span>Suggestion : <b>{sug.name}</b> <span className="text-xs text-slate-500">({Math.round(sug.confidence * 100)} % · {sug.source})</span>{' '}
          {applied ? <span className="text-green-700">✓ appliquée</span> : <button type="button" className="underline" onClick={apply}>Appliquer</button>}</span>}
      </div>
      {msg && <p className="mt-2 text-xs text-slate-500">{msg}</p>}
    </div>
  );
}
