'use client';
import type { ReactNode } from 'react';

/**
 * Suppression sécurisée : motif obligatoire, confirmation tapée (« SUPPRIMER ») et fenêtre de confirmation.
 * `action` est une server action déjà liée à l'élément (ex. deleteActivity.bind(null, id)).
 */
export function DeleteBox({ action, label = 'Supprimer', warn, children, password = false, compact = false }: {
  action: (fd: FormData) => Promise<void>; label?: string; warn?: string; children?: ReactNode; password?: boolean; compact?: boolean;
}) {
  return (
    <details className={compact ? 'inline-block align-top' : 'w-full'}>
      <summary className="btn-danger btn-sm inline-block cursor-pointer list-none select-none">{label}</summary>
      <form action={action} onSubmit={(e) => { if (!window.confirm('Cette suppression est DÉFINITIVE. Voulez-vous continuer ?')) e.preventDefault(); }}
        className="mt-2 w-full min-w-[260px] max-w-md space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-left">
        {warn && <p className="text-xs text-red-800">{warn}</p>}
        {children}
        <input name="reason" required minLength={5} placeholder="Motif de la suppression (obligatoire)" className="input" />
        <input name="confirm" required autoComplete="off" placeholder="Tapez SUPPRIMER pour confirmer" className="input" />
        {password && <input name="password" type="password" required autoComplete="current-password" placeholder="Votre mot de passe" className="input" />}
        <button className="btn-danger w-full">Confirmer la suppression</button>
        <p className="text-[11px] text-red-700">La suppression est inscrite dans le registre des suppressions (qui, quand, pourquoi, copie des données).</p>
      </form>
    </details>
  );
}

/** Petit bouton de suppression avec fenêtre de confirmation (notifications). */
export function ConfirmButton({ action, label, confirm }: { action: () => Promise<void>; label: string; confirm: string }) {
  return (
    <form action={action} onSubmit={(e) => { if (!window.confirm(confirm)) e.preventDefault(); }} className="inline">
      <button className="text-xs text-red-600 underline">{label}</button>
    </form>
  );
}