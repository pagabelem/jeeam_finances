import { redirect } from 'next/navigation';

export class AppError extends Error {}

function withParam(path: string, k: string, v: string) {
  return `${path}${path.includes('?') ? '&' : '?'}${k}=${encodeURIComponent(v)}`;
}

/** Exécute une server action : en cas d'AppError, redirige vers failPath?error=...; sinon redirige vers la cible retournée. */
export async function act(failPath: string, fn: () => Promise<string | void>) {
  let target: string | void;
  try {
    target = await fn();
  } catch (e) {
    if (e instanceof AppError) redirect(withParam(failPath, 'error', e.message));
    throw e;
  }
  if (target) redirect(target);
}

export const ok = (path: string, msg: string) => withParam(path, 'ok', msg);
