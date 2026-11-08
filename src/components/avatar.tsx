/** Photo de profil (ou initiales). Composant sans état : utilisable dans les pages serveur. */
export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
  const style = { width: size, height: size, fontSize: Math.max(10, Math.round(size / 2.6)) };
  // eslint-disable-next-line @next/next/no-img-element
  if (src) return <img src={src} alt={name} style={style} className="shrink-0 rounded-full object-cover ring-2 ring-white/70" />;
  return <span style={style} className="inline-flex shrink-0 items-center justify-center rounded-full bg-brand-700 font-semibold text-white ring-2 ring-white/70">{initials}</span>;
}