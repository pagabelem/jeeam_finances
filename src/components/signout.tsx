'use client';
import { signOut } from 'next-auth/react';

export default function SignOut() {
  return <button onClick={() => signOut({ callbackUrl: '/login' })} className="mt-2 text-slate-300 underline hover:text-white">Se déconnecter</button>;
}
