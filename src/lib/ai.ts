// Utilitaires IA partagés (OpenAI). Aucune de ces fonctions ne valide ni ne modifie une opération.
export const aiEnabled = () => !!process.env.OPENAI_API_KEY;
const base = 'https://api.openai.com/v1';
const hdr = () => ({ Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' });
export const MODEL = () => process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } } | { type: 'file'; file: { filename: string; file_data: string } };

/** Appel « JSON strict » : retourne l'objet parsé ou null. */
export async function chatJson<T>(system: string, user: string | Part[]): Promise<T | null> {
  if (!aiEnabled()) return null;
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', headers: hdr(),
    body: JSON.stringify({ model: MODEL(), temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!r.ok) return null;
  try { return JSON.parse((await r.json()).choices?.[0]?.message?.content ?? 'null') as T; } catch { return null; }
}

export async function embed(texts: string[]): Promise<number[][] | null> {
  if (!aiEnabled() || !texts.length) return null;
  const r = await fetch(`${base}/embeddings`, {
    method: 'POST', headers: hdr(),
    body: JSON.stringify({ model: process.env.OPENAI_EMBED_MODEL ?? 'text-embedding-3-small', input: texts.map((t) => t.slice(0, 2000)) }),
  });
  if (!r.ok) return null;
  const j = await r.json();
  return (j.data as { embedding: number[]; index: number }[]).sort((a, b) => a.index - b.index).map((d) => d.embedding);
}

export function cosine(a: number[], b: number[]) {
  let d = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

export const strip = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export const tokens = (s: string) => Array.from(new Set(strip(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3)));

/** Suggestion sans IA : catégorie dont l'historique partage le plus de mots avec la description. */
export function suggestFromHistory(desc: string, history: { description: string; categoryId: string }[]) {
  const q = new Set(tokens(desc));
  if (!q.size) return null;
  const score = new Map<string, number>();
  for (const h of history) {
    const common = tokens(h.description).filter((w) => q.has(w)).length;
    if (common) score.set(h.categoryId, (score.get(h.categoryId) ?? 0) + common);
  }
  const ranked = Array.from(score).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  return { categoryId: ranked[0][0], confidence: Math.round((ranked[0][1] / total) * 100) / 100 };
}
export type { Part };
