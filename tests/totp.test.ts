import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, hotp, totp, verifyTotp, generateRecoveryCodes, hashRecovery, normalizeRecovery, otpauthUri } from '@/lib/totp';

const SECRET = base32Encode(Buffer.from('12345678901234567890')); // vecteur de test RFC 6238

describe('TOTP', () => {
  it('base32 aller-retour', () => {
    const b = Buffer.from('JEEAM-finance-2026');
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
  it('vecteurs RFC 4226 (HOTP)', () => {
    const s = Buffer.from('12345678901234567890');
    expect(['755224', '287082', '359152', '969429'].map((_, i) => hotp(s, i))).toEqual(['755224', '287082', '359152', '969429']);
  });
  it('vecteur RFC 6238 (T=59 s → 94287082 sur 8 chiffres)', () => {
    expect(totp(SECRET, 59_000, 8)).toBe('94287082');
  });
  it('accepte le code courant et la tolérance ±1 pas, refuse au-delà', () => {
    const t = 1_700_000_000_000;
    expect(verifyTotp(SECRET, totp(SECRET, t), { time: t })).not.toBeNull();
    expect(verifyTotp(SECRET, totp(SECRET, t - 30_000), { time: t })).not.toBeNull();
    expect(verifyTotp(SECRET, totp(SECRET, t - 120_000), { time: t })).toBeNull();
  });
  it('refuse le rejeu d’un code déjà consommé', () => {
    const t = 1_700_000_000_000;
    const step = verifyTotp(SECRET, totp(SECRET, t), { time: t })!;
    expect(verifyTotp(SECRET, totp(SECRET, t), { time: t, lastStep: step })).toBeNull();
  });
  it('refuse les formats invalides', () => {
    expect(verifyTotp(SECRET, '12345')).toBeNull();
    expect(verifyTotp(SECRET, 'abcdef')).toBeNull();
  });
  it('codes de secours : format, unicité, hachage insensible à la casse et aux tirets', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
    expect(hashRecovery(codes[0])).toBe(hashRecovery(codes[0].toLowerCase().replace('-', ' ')));
    expect(normalizeRecovery(codes[0])).toHaveLength(10);
  });
  it('URI otpauth', () => {
    expect(otpauthUri('ABC', 'a@b.c')).toContain('secret=ABC');
  });
});
