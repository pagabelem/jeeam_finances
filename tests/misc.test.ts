import { describe, it, expect } from 'vitest';
import { sniffMime } from '@/lib/filetype';
import { suggestFromHistory, cosine, tokens } from '@/lib/ai';
import { pdfSafe } from '@/lib/pdf';

describe('signature des fichiers', () => {
  it('reconnaît PDF / JPEG / PNG / WEBP et refuse le reste', () => {
    expect(sniffMime(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('image/png');
    expect(sniffMime(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(Buffer.from('<?php echo 1; ?>'))).toBeNull();
    expect(sniffMime(Buffer.from('MZ\x90\0\x03\0\0\0\x04\0'))).toBeNull();
  });
});

describe('IA locale', () => {
  it('découpe sans accents ni mots courts', () => expect(tokens('Déplacement à Rabat')).toEqual(['deplacement', 'rabat']));
  it('suggestion par historique', () => {
    const h = [{ description: 'Billets de train Rabat', categoryId: 'transport' }, { description: 'Train Casablanca Marrakech', categoryId: 'transport' }, { description: 'Repas équipe', categoryId: 'resto' }];
    expect(suggestFromHistory('Billet train Fès', h)?.categoryId).toBe('transport');
    expect(suggestFromHistory('xyz', h)).toBeNull();
  });
  it('cosinus', () => { expect(cosine([1, 0], [1, 0])).toBeCloseTo(1); expect(cosine([1, 0], [0, 1])).toBeCloseTo(0); expect(cosine([0, 0], [1, 1])).toBe(0); });
});

describe('PDF', () => {
  it('normalise les caractères non WinAnsi', () => {
    expect(pdfSafe('1\u202f234,50\u00a0MAD')).toBe('1 234,50 MAD');
    expect(pdfSafe('Café — « ok » ≠ ⚠')).toBe('Café — « ok » ? ?');
  });
});
