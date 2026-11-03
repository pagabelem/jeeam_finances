// Copie les justificatifs du disque local (STORAGE_DIR) vers S3, en conservant les mêmes clés.
// Usage : STORAGE_DRIVER=s3 S3_BUCKET=... npm run storage:migrate   (ajouter --dry pour simuler)
import fs from 'fs/promises';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { putBuffer } from '../src/lib/storage';

const db = new PrismaClient();
const dry = process.argv.includes('--dry');

async function main() {
  if (process.env.STORAGE_DRIVER !== 's3') throw new Error('Définir STORAGE_DRIVER=s3 pour migrer.');
  const root = path.resolve(process.env.STORAGE_DIR ?? './storage');
  const rows = await db.attachment.findMany({ select: { storageKey: true, mimeType: true } });
  let ok = 0, missing = 0;
  for (const r of rows) {
    try {
      const buf = await fs.readFile(path.join(root, r.storageKey));
      if (!dry) await putBuffer(r.storageKey, buf, r.mimeType);
      ok++;
    } catch { missing++; console.warn('Introuvable en local :', r.storageKey); }
  }
  console.log(`${dry ? '[simulation] ' : ''}${ok} fichier(s) copié(s), ${missing} introuvable(s) sur ${rows.length}.`);
}
main().finally(() => db.$disconnect());
