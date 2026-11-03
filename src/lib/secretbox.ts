// Chiffrement AES-256-GCM des secrets TOTP au repos (clé dérivée de TOTP_ENC_KEY, à défaut NEXTAUTH_SECRET).
import crypto from 'node:crypto';

const key = () => {
  const base = process.env.TOTP_ENC_KEY || process.env.NEXTAUTH_SECRET;
  if (!base) throw new Error('NEXTAUTH_SECRET (ou TOTP_ENC_KEY) manquant');
  return crypto.createHash('sha256').update('jeeam-totp:' + base).digest();
};

export function seal(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join(':');
}

export function open(sealed: string): string {
  const [v, iv, tag, ct] = sealed.split(':');
  if (v !== 'v1') throw new Error('Format de secret inconnu');
  const d = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  d.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
}
