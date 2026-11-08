'use client';
import { useRef, useState } from 'react';
import { Avatar } from '@/components/avatar';

/** Choix de la photo de profil : recadrage carré et réduction (256 px, JPEG) dans le navigateur avant l'envoi. */
export function AvatarPicker({ name, current, save, remove }: { name: string; current?: string | null; save: (fd: FormData) => Promise<void>; remove: () => Promise<void> }) {
  const [preview, setPreview] = useState<string>('');
  const [err, setErr] = useState('');
  const input = useRef<HTMLInputElement>(null);

  function pick(file?: File) {
    setErr('');
    if (!file) return;
    if (!file.type.startsWith('image/')) { setErr('Choisissez une image (JPG, PNG ou WEBP).'); return; }
    if (file.size > 15 * 1024 * 1024) { setErr('Image trop volumineuse (15 Mo max).'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const size = 256, c = document.createElement('canvas');
      c.width = size; c.height = size;
      const side = Math.min(img.width, img.height);
      const ctx = c.getContext('2d');
      if (!ctx) { setErr('Navigateur non compatible.'); return; }
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      setPreview(c.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(url);
    };
    img.onerror = () => { setErr('Image illisible.'); URL.revokeObjectURL(url); };
    img.src = url;
  }

  return (
    <div className="flex flex-wrap items-center gap-5">
      <Avatar name={name} src={preview || current} size={96} />
      <div className="space-y-2">
        <form action={save} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="avatar" value={preview} />
          <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="btn-sec" onClick={() => input.current?.click()}>Choisir une photo</button>
          <button className="btn" disabled={!preview}>Enregistrer la photo</button>
        </form>
        {current && <form action={remove}><button className="text-xs text-red-600 underline">Supprimer ma photo</button></form>}
        {err && <p className="text-xs text-red-600">{err}</p>}
        <p className="text-xs text-slate-500">Elle est recadrée en carré et réduite automatiquement.</p>
      </div>
    </div>
  );
}