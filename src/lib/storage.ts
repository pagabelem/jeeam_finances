// Stockage des justificatifs : disque local (défaut) ou S3 compatible (AWS S3, Cloudflare R2, MinIO, Scaleway…).
// Choix par STORAGE_DRIVER=local|s3. Les clés (`storageKey`) sont identiques dans les deux modes :
// on peut donc migrer les fichiers existants avec `npm run storage:migrate` sans toucher à la base.
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { AppError } from '@/lib/errors';
import { sniffMime } from '@/lib/filetype';

const MAX = 10 * 1024 * 1024;
const ALLOWED: Record<string, string> = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
};
const root = () => path.resolve(process.env.STORAGE_DIR ?? './storage');
const driver = () => (process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local');

// ── S3 (chargé à la demande : le paquet n'est requis que si STORAGE_DRIVER=s3) ──
async function s3() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new AppError('S3_BUCKET manquant dans la configuration.');
  const mod = await import('@aws-sdk/client-s3');
  const client = new mod.S3Client({
    region: process.env.S3_REGION ?? 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
    credentials: process.env.S3_ACCESS_KEY_ID ? { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '' } : undefined,
  });
  return { mod, client, bucket };
}

export async function putBuffer(key: string, buf: Buffer, mime: string) {
  if (driver() === 's3') {
    const { mod, client, bucket } = await s3();
    await client.send(new mod.PutObjectCommand({ Bucket: bucket, Key: key, Body: buf, ContentType: mime, ServerSideEncryption: process.env.S3_SSE === 'aws:kms' ? 'aws:kms' : process.env.S3_SSE === 'AES256' ? 'AES256' : undefined }));
    return;
  }
  const full = path.join(root(), key);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, buf);
}

export async function saveFile(file: File) {
  if (!file || file.size === 0) throw new AppError('Fichier manquant.');
  if (file.size > MAX) throw new AppError('Fichier trop volumineux (10 Mo max).');
  const ext = ALLOWED[file.type];
  if (!ext) throw new AppError('Format non accepté (PDF, JPG, PNG ou WEBP).');
  const buf = Buffer.from(await file.arrayBuffer());
  if (sniffMime(buf) !== file.type) throw new AppError('Le contenu du fichier ne correspond pas à son format déclaré.');
  const key = `${new Date().getFullYear()}/${crypto.randomUUID()}${ext}`;
  await putBuffer(key, buf, file.type);
  return { key, size: file.size, mime: file.type, name: file.name.slice(0, 200) };
}

export async function readStored(key: string): Promise<Buffer> {
  if (driver() === 's3') {
    const { mod, client, bucket } = await s3();
    const r = await client.send(new mod.GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!r.Body) throw new AppError('Fichier introuvable.');
    return Buffer.from(await r.Body.transformToByteArray());
  }
  const full = path.resolve(root(), key);
  if (!full.startsWith(root() + path.sep)) throw new AppError('Chemin invalide.');
  return fs.readFile(full);
}

export const hasFile = (v: FormDataEntryValue | null): v is File => v instanceof File && v.size > 0;
