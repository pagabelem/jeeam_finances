import Link from 'next/link';
import { cookies } from 'next/headers';
import QRCode from 'qrcode';
import { db } from '@/lib/db';
import { requirePage } from '@/lib/session';
import { open } from '@/lib/secretbox';
import { otpauthUri } from '@/lib/totp';
import { updateAvatar, removeAvatar, updateMyName, changePassword, startTotpSetup, confirmTotp, regenerateRecovery, disableTotp } from '@/actions/account';
import { Flash } from '@/components/ui';
import { AvatarPicker } from '@/components/avatar-picker';

export const dynamic = 'force-dynamic';

export default async function Profile({ searchParams }: { searchParams: { error?: string; ok?: string } }) {
  const me = await requirePage();
  const u = await db.user.findUnique({ where: { id: me.id } });
  const pending = !!u?.totpSecret && !u.totpEnabled;
  let secret = '', qr = '';
  if (pending && u?.totpSecret) {
    secret = open(u.totpSecret);
    qr = await QRCode.toDataURL(otpauthUri(secret, me.email), { margin: 1, width: 220 });
  }
  const codes = (cookies().get('jeeam_codes')?.value ?? '').split(',').filter(Boolean);
  const gated = me.mustChangePassword || me.needs2faSetup;

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-jeeam.png" alt="Logo JEEAM" width={48} height={56} className="h-14 w-12 rounded-lg bg-white object-contain p-1 shadow" />
          <div><h1 className="text-2xl font-bold">Mon compte</h1><p className="text-sm text-slate-500">{me.name} — {me.roleName}</p></div>
        </div>
        {!gated && <Link href="/" className="btn-sec">← Retour</Link>}
      </div>
      <Flash {...searchParams} />
      {gated && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Avant de continuer :{me.mustChangePassword && ' changez votre mot de passe initial.'}{me.needs2faSetup && ' activez la double authentification (obligatoire pour votre rôle).'}
        </div>
      )}

      {codes.length > 0 && (
        <div className="card border-green-300">
          <h2 className="font-semibold">Codes de secours — à conserver maintenant</h2>
          <p className="mb-2 text-sm text-slate-500">Chaque code ne sert qu’une fois (téléphone perdu). Ils ne seront plus affichés.</p>
          <div className="grid grid-cols-2 gap-2 font-mono text-sm">{codes.map((c) => <div key={c} className="rounded bg-slate-100 px-3 py-1">{c}</div>)}</div>
        </div>
      )}

      <div className="card space-y-3">
        <h2 className="font-semibold">Photo de profil</h2>
        <AvatarPicker name={me.name} current={me.avatar} save={updateAvatar} remove={removeAvatar} />
      </div>

      <form action={updateMyName} className="card space-y-3">
        <h2 className="font-semibold">Informations personnelles</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label">Nom</label><input name="name" required minLength={2} maxLength={80} defaultValue={me.name} className="input" /></div>
          <div><label className="label">E-mail (identifiant de connexion)</label><input value={me.email} disabled readOnly className="input bg-slate-100 text-slate-500" /></div>
        </div>
        <p className="text-xs text-slate-500">L’e-mail et le rôle ne peuvent être modifiés que par le Commissaire aux comptes (Administration &gt; Utilisateurs).</p>
        <button className="btn">Enregistrer le nom</button>
      </form>

      <form action={changePassword} className="card space-y-3">
        <h2 className="font-semibold">Mot de passe</h2>
        <div><label className="label">Mot de passe actuel</label><input name="current" type="password" required autoComplete="current-password" className="input" /></div>
        <div className="grid gap-3 md:grid-cols-2">
          <div><label className="label">Nouveau (10 car. min., lettre + chiffre)</label><input name="next" type="password" required autoComplete="new-password" className="input" /></div>
          <div><label className="label">Confirmation</label><input name="confirm" type="password" required autoComplete="new-password" className="input" /></div>
        </div>
        <button className="btn">Changer le mot de passe</button>
      </form>

      <div className="card space-y-3">
        <h2 className="font-semibold">Double authentification (TOTP)</h2>
        {u?.totpEnabled ? (
          <>
            <p className="text-sm text-green-700">Activée · {u.totpRecovery.length} code(s) de secours restant(s).</p>
            <form action={regenerateRecovery} className="flex flex-wrap items-end gap-2">
              <div><label className="label">Mot de passe</label><input name="password" type="password" required className="input" /></div>
              <button className="btn-sec">Régénérer les codes de secours</button>
            </form>
            {!me.requires2fa ? (
              <form action={disableTotp} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <div><label className="label">Mot de passe</label><input name="password" type="password" required className="input" /></div>
                <button className="btn-danger">Désactiver</button>
              </form>
            ) : <p className="text-xs text-slate-500">Obligatoire pour votre rôle : désactivation impossible (un administrateur peut la réinitialiser en cas de perte du téléphone).</p>}
          </>
        ) : pending ? (
          <>
            <p className="text-sm text-slate-600">1. Scannez ce QR code avec Google Authenticator, Microsoft Authenticator, Authy ou 2FAS.</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="QR code TOTP" width={220} height={220} />
            <p className="text-xs text-slate-500">Saisie manuelle : <code className="rounded bg-slate-100 px-1">{secret}</code></p>
            <form action={confirmTotp} className="flex flex-wrap items-end gap-2">
              <div><label className="label">2. Code à 6 chiffres affiché par l’application</label><input name="code" inputMode="numeric" autoComplete="one-time-code" required className="input" /></div>
              <button className="btn">Activer</button>
            </form>
          </>
        ) : (
          <form action={startTotpSetup}>
            <p className="mb-2 text-sm text-slate-500">Ajoute un code temporaire à la connexion.{me.requires2fa && ' Obligatoire pour votre rôle.'}</p>
            <button className="btn">Configurer</button>
          </form>
        )}
      </div>
    </div>
  );
}