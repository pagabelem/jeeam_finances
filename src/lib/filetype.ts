// Vérification du contenu réel d'un fichier (signature) : un .pdf déclaré mais contenant autre chose est refusé.
export function sniffMime(b: Uint8Array): string | null {
  const eq = (o: number, ...v: number[]) => v.every((x, i) => b[o + i] === x);
  if (b.length > 4 && eq(0, 0x25, 0x50, 0x44, 0x46)) return 'application/pdf';               // %PDF
  if (b.length > 3 && eq(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (b.length > 8 && eq(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (b.length > 12 && eq(0, 0x52, 0x49, 0x46, 0x46) && eq(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp'; // RIFF....WEBP
  return null;
}
