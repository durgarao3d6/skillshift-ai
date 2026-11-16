import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { mkdir, writeFile, readFile, unlink, readdir } from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { HttpError } from './core';
function keyPath(key: string) {
  if (!/^(tenants|deletions)\/[a-f0-9-]{36}\/[a-zA-Z0-9/._-]+$/.test(key) || key.includes('..'))
    throw new Error('Invalid private object key');
  return key;
}
function localRoot() {
  if (process.env.NODE_ENV === 'production')
    throw new HttpError(503, 'Production evidence requires private object storage.');
  return path.resolve(
    /*turbopackIgnore: true*/ process.env.PRIVATE_STORAGE_PATH || '.private-storage',
  );
}
function s3() {
  return new S3Client({
    region: process.env.S3_REGION || 'us-east-1',
    endpoint: process.env.S3_ENDPOINT || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
}
export async function putPrivate(key: string, data: Buffer, type = 'application/octet-stream') {
  keyPath(key);
  if (process.env.S3_BUCKET) {
    await s3().send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: key,
        Body: data,
        ContentType: type,
        ServerSideEncryption: 'AES256',
      }),
    );
    return;
  }
  const file = path.join(/*turbopackIgnore: true*/ localRoot(), key);
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await writeFile(file, data, { mode: 0o600 });
}
export async function getPrivate(key: string) {
  keyPath(key);
  if (process.env.S3_BUCKET) {
    const r = await s3().send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    if (!r.Body) throw new Error('Object not found');
    return Buffer.from(await r.Body.transformToByteArray());
  }
  return readFile(/*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ localRoot(), key));
}
export async function deletePrivate(key: string) {
  keyPath(key);
  if (process.env.S3_BUCKET) {
    await s3().send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }));
    return;
  }
  await unlink(path.join(/*turbopackIgnore: true*/ localRoot(), key)).catch((e) => {
    if (e.code !== 'ENOENT') throw e;
  });
}
export async function listDeletionLedger(tenantId: string) {
  const prefix = `deletions/${tenantId}/`;
  keyPath(prefix + 'x');
  if (process.env.S3_BUCKET) {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const r = await s3().send(
        new ListObjectsV2Command({
          Bucket: process.env.S3_BUCKET,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      keys.push(...(r.Contents || []).flatMap((x) => (x.Key ? [x.Key] : [])));
      token = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
  try {
    return (
      await readdir(
        /*turbopackIgnore: true*/ path.join(/*turbopackIgnore: true*/ localRoot(), prefix),
      )
    ).map((name) => prefix + name);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw e;
  }
}
export function validateEvidence(data: Buffer, mime: string) {
  if (!data.length || data.length > 5 * 1024 * 1024)
    throw new HttpError(422, 'Evidence must be between 1 byte and 5 MB.');
  if (mime === 'application/pdf') {
    if (data.subarray(0, 5).toString() !== '%PDF-')
      throw new HttpError(422, 'File content is not a PDF.');
  } else if (mime === 'text/plain') {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(data);
    } catch {
      throw new HttpError(422, 'Text evidence must be valid UTF-8.');
    }
    if (data.includes(0)) throw new HttpError(422, 'Binary content is not accepted as text.');
  } else throw new HttpError(422, 'Only plain text and PDF evidence are supported.');
}
export async function scanClamAV(data: Buffer): Promise<'clean' | 'infected'> {
  if (!process.env.CLAMD_HOST) throw new Error('Malware scanner is not configured');
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({
      host: process.env.CLAMD_HOST!,
      port: Number(process.env.CLAMD_PORT || 3310),
    });
    let output = '';
    let settled = false;
    const finish = (error: Error | null, result?: 'clean' | 'infected') => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(result!);
    };
    socket.setTimeout(30000, () => finish(new Error('Malware scanner timed out')));
    socket.on('error', () => finish(new Error('Malware scanner unavailable')));
    socket.on('connect', () => {
      socket.write('zINSTREAM\0');
      for (let i = 0; i < data.length; i += 65536) {
        const chunk = data.subarray(i, i + 65536);
        const length = Buffer.alloc(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.on('data', (chunk) => {
      output += chunk.toString();
      if (output.length > 4096) {
        finish(new Error('Invalid scanner response'));
        return;
      }
      if (output.includes('\0') || output.includes('\n')) {
        if (/: OK[\0\n]/.test(output)) finish(null, 'clean');
        else if (/ FOUND[\0\n]/.test(output)) finish(null, 'infected');
        else finish(new Error('Malware scan failed'));
      }
    });
    socket.on('end', () => {
      if (!settled) finish(new Error('Incomplete scanner response'));
    });
  });
}
