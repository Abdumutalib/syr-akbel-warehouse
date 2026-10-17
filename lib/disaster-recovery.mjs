import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';

export const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export const safePhotoName = name => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(name);
export const safeHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export async function readPhoto(directory, name) {
  if (!safePhotoName(name)) throw new Error('Invalid photo name');
  const target = path.join(directory, name);
  const stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) throw new Error('Invalid photo file');
  return fs.readFile(target);
}

export async function createSnapshot({ state, photoDirectory, scheduler = {}, build = null }) {
  const files = await fs.readdir(photoDirectory).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const photos = [];
  for (const name of files.sort()) {
    const bytes = await readPhoto(photoDirectory, name);
    photos.push({ name, size: bytes.length, sha256: digest(bytes) });
  }
  const content = { state, scheduler, photos, build };
  const revision = digest(JSON.stringify(content));
  return { format: 'akbel-backup-v1', capturedAt: new Date().toISOString(), revision, ...content };
}

export function validateSnapshot(snapshot) {
  if (snapshot?.format !== 'akbel-backup-v1' || !safeHash(snapshot.revision)
      || !snapshot.state?.warehouse || !Array.isArray(snapshot.state.users)
      || !Array.isArray(snapshot.photos) || snapshot.photos.length > 100000) throw new Error('Invalid backup snapshot');
  const names = new Set();
  for (const photo of snapshot.photos) {
    if (!safePhotoName(photo.name) || names.has(photo.name) || !safeHash(photo.sha256)
        || !Number.isSafeInteger(photo.size) || photo.size < 0 || photo.size > 16 * 1024 * 1024) throw new Error('Invalid backup photo');
    names.add(photo.name);
  }
  const { state, scheduler, photos, build } = snapshot;
  if (digest(JSON.stringify({ state, scheduler, photos, build })) !== snapshot.revision) throw new Error('Backup checksum mismatch');
  return snapshot;
}

function decodeKey(key) {
  const bytes = Buffer.from(key || '', 'base64');
  if (bytes.length !== 32) throw new Error('A 32-byte backup encryption key is required');
  return bytes;
}

export function seal(bytes, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', decodeKey(key), iv);
  const encrypted = Buffer.concat([cipher.update(gzipSync(bytes)), cipher.final()]);
  return Buffer.concat([Buffer.from('AKB1'), iv, cipher.getAuthTag(), encrypted]);
}

export function unseal(bytes, key) {
  if (bytes.subarray(0, 4).toString() !== 'AKB1') throw new Error('Invalid encrypted backup');
  const cipher = crypto.createDecipheriv('aes-256-gcm', decodeKey(key), bytes.subarray(4, 16));
  cipher.setAuthTag(bytes.subarray(16, 32));
  return gunzipSync(Buffer.concat([cipher.update(bytes.subarray(32)), cipher.final()]), { maxOutputLength: 128 * 1024 * 1024 });
}

export async function atomicWrite(target, bytes) {
  await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temp = `${target}.${crypto.randomBytes(8).toString('hex')}.tmp`;
  try {
    const file = await fs.open(temp, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    await fs.rename(temp, target);
  } finally { await fs.rm(temp, { force: true }); }
}

export function validateSource(baseUrl) {
  const url = new URL(baseUrl);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Backup source must be an HTTPS origin without credentials');
  return url.origin;
}

async function limitedBody(response, limit) {
  if (!response.ok) throw new Error(`Backup source returned HTTP ${response.status}`);
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) { await response.body.cancel?.().catch(() => {}); throw new Error('Backup response too large'); }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function pullBackup({ source, directory, authorization, key, fetchImpl = fetch, photoDelayMs = 0 }) {
  const origin = validateSource(source);
  const get = async (route, limit) => limitedBody(await fetchImpl(origin + route, {
    headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(60000),
  }), limit);
  const prefix = '/warehouse/api/warehouse/disaster-recovery/';
  const snapshot = validateSnapshot(JSON.parse(await get(prefix + 'snapshot', 128 * 1024 * 1024)));
  // Validate the encryption key before downloading or publishing anything.
  decodeKey(key);
  for (const photo of snapshot.photos) {
    const target = path.join(directory, 'blobs', `${photo.sha256}.enc`);
    let valid = false;
    try { valid = digest(unseal(await fs.readFile(target), key)) === photo.sha256; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!valid) {
      if (photoDelayMs) await new Promise(resolve => setTimeout(resolve, photoDelayMs));
      const bytes = await get(prefix + 'photos/' + encodeURIComponent(photo.name), 16 * 1024 * 1024);
      if (bytes.length !== photo.size || digest(bytes) !== photo.sha256) throw new Error('Downloaded photo checksum mismatch');
      await atomicWrite(target, seal(bytes, key));
    }
  }
  const target = path.join(directory, 'snapshots', `${snapshot.revision}.enc`);
  await atomicWrite(target, seal(Buffer.from(JSON.stringify(snapshot)), key));
  // Publish only after every state byte and photo has been stored successfully.
  await atomicWrite(path.join(directory, 'latest.json'), JSON.stringify({ revision: snapshot.revision, capturedAt: snapshot.capturedAt, checkedAt: new Date().toISOString(), photos: snapshot.photos.length }));
  return snapshot;
}

export async function restoreBackup({ directory, target, key }) {
  const latest = JSON.parse(await fs.readFile(path.join(directory, 'latest.json'), 'utf8'));
  if (!safeHash(latest.revision)) throw new Error('Invalid latest backup pointer');
  // Never overwrite an existing working database or merge two databases.
  await fs.mkdir(target, { recursive: false, mode: 0o700 });
  try {
    const snapshot = validateSnapshot(JSON.parse(unseal(await fs.readFile(path.join(directory, 'snapshots', `${latest.revision}.enc`)), key)));
    for (const photo of snapshot.photos) {
      const bytes = unseal(await fs.readFile(path.join(directory, 'blobs', `${photo.sha256}.enc`)), key);
      if (bytes.length !== photo.size || digest(bytes) !== photo.sha256) throw new Error('Stored photo checksum mismatch');
      await atomicWrite(path.join(target, 'transaction-photos', photo.name), bytes);
    }
    await atomicWrite(path.join(target, 'warehouse.json'), JSON.stringify(snapshot.state));
    await atomicWrite(path.join(target, 'scheduler.json'), JSON.stringify(snapshot.scheduler));
    await atomicWrite(path.join(target, 'backup-manifest.json'), JSON.stringify({ revision: snapshot.revision, capturedAt: snapshot.capturedAt, restoredAt: new Date().toISOString(), sourceBuild: snapshot.build }));
    return snapshot;
  } catch (error) {
    // Leave the partial restore for diagnosis, but it has no completion manifest.
    throw error;
  }
}
