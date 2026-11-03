// TOTP (RFC 6238) + HOTP (RFC 4226), sans dépendance externe. Algorithme SHA-1, 6 chiffres, pas de 30 s
// (compatible Google Authenticator, Microsoft Authenticator, Authy, 2FAS…).
import crypto from 'node:crypto';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = '';
  for (const byte of buf) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/=+$/g, '').replace(/\s+/g, '').toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Base32 invalide');
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const generateSecret = (bytes = 20) => base32Encode(crypto.randomBytes(bytes));

export function hotp(secret: Buffer, counter: number, digits = 6): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 0xf;
  const code = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(code % 10 ** digits).padStart(digits, '0');
}

export const stepOf = (time = Date.now(), period = 30) => Math.floor(time / 1000 / period);

export function totp(secretB32: string, time = Date.now(), digits = 6, period = 30): string {
  return hotp(base32Decode(secretB32), stepOf(time, period), digits);
}

/**
 * Vérifie un code. Retourne le pas (step) correspondant, ou null.
 * `lastStep` : dernier pas déjà consommé → un même code ne peut pas être rejoué.
 */
export function verifyTotp(secretB32: string, token: string, opts: { time?: number; window?: number; lastStep?: number | null; digits?: number } = {}): number | null {
  const digits = opts.digits ?? 6;
  const t = token.replace(/\s+/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(t)) return null;
  const secret = base32Decode(secretB32);
  const cur = stepOf(opts.time ?? Date.now());
  const win = opts.window ?? 1;
  for (let d = -win; d <= win; d++) {
    const step = cur + d;
    if (opts.lastStep != null && step <= opts.lastStep) continue;
    const expected = hotp(secret, step, digits);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(t))) return step;
  }
  return null;
}

export const otpauthUri = (secretB32: string, account: string, issuer = 'JEEAM Finance') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;

/** Codes de secours : 8 codes de la forme XXXXX-XXXXX (stockés hachés). */
export function generateRecoveryCodes(n = 8): string[] {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: n }, () => {
    const b = crypto.randomBytes(10);
    const s = Array.from(b, (x) => alphabet[x % alphabet.length]).join('');
    return `${s.slice(0, 5)}-${s.slice(5)}`;
  });
}
export const normalizeRecovery = (c: string) => c.replace(/[\s-]/g, '').toUpperCase();
export const hashRecovery = (c: string) => crypto.createHash('sha256').update(normalizeRecovery(c)).digest('hex');
