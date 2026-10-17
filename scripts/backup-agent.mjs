import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { pullBackup, restoreBackup, atomicWrite, unseal, validateSnapshot, safeHash } from '../lib/disaster-recovery.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const directory = path.resolve(process.env.AKBEL_BACKUP_DIRECTORY || '');
if (!process.env.AKBEL_BACKUP_DIRECTORY || directory === root) throw new Error('Set a separate AKBEL_BACKUP_DIRECTORY');
const source = process.env.AKBEL_BACKUP_SOURCE || 'https://akbelim.com';
const key = process.env.AKBEL_BACKUP_KEY;
const authorization = 'Basic ' + Buffer.from(`${process.env.AKBEL_BACKUP_USERNAME || ''}:${process.env.AKBEL_BACKUP_PASSWORD || ''}`).toString('base64');
const restoreIndex = process.argv.indexOf('--restore');
if (restoreIndex !== -1) {
  const target = process.argv[restoreIndex + 1];
  if (!target) throw new Error('--restore requires a NEW directory');
  const snapshot = await restoreBackup({ directory, target: path.resolve(target), key });
  console.log(JSON.stringify({ restored: true, revision: snapshot.revision, photos: snapshot.photos.length }));
  process.exit(0);
}
if (!process.env.AKBEL_BACKUP_USERNAME || !process.env.AKBEL_BACKUP_PASSWORD) throw new Error('Admin credentials are required; use start-local-backup.ps1');
await fs.mkdir(directory, { recursive: true, mode: 0o700 });
const lockPath = path.join(directory, 'agent.lock');
const lock = await fs.open(lockPath, 'wx').catch(() => { throw new Error('Another backup agent may be running. Check agent.lock before restarting.'); });
await lock.writeFile(String(process.pid));
let stopping = false;
let standby = null;
let activeRevision = '';
let retryMs = 30000;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; standby?.kill(); });

async function startStandby(snapshot) {
  if (!process.argv.includes('--standby') || activeRevision === snapshot.revision) return;
  const restored = path.join(directory, 'restores', snapshot.revision);
  await fs.mkdir(path.dirname(restored), { recursive: true, mode: 0o700 });
  try {
    await fs.access(path.join(restored, 'backup-manifest.json'));
  } catch {
    // A failed previous restore is never overwritten; use a unique directory.
    const actual = await fs.stat(restored).then(() => `${restored}-${Date.now()}`).catch(() => restored);
    await restoreBackup({ directory, target: actual, key });
    return launch(actual, snapshot);
  }
  return launch(restored, snapshot);
}

async function launch(restored, snapshot) {
  if (standby) {
    const previous = standby;
    const exited = new Promise(resolve => previous.once('exit', resolve));
    previous.kill('SIGTERM');
    await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 10000))]);
    if (previous.exitCode === null && previous.signalCode === null) throw new Error('Old standby did not stop; refusing a second process');
  }
  const env = { ...process.env, WAREHOUSE_LOAD_ENV_FILE: 'false', WAREHOUSE_STANDBY: '1', WAREHOUSE_BIND_HOST: '127.0.0.1', PORT: '8793',
    WAREHOUSE_STATE_FILE: path.join(restored, 'warehouse.json'), WAREHOUSE_DB_URL: '', DATABASE_URL: '',
    WAREHOUSE_ALLOWED_ORIGIN: 'http://127.0.0.1:8793', WAREHOUSE_CANONICAL_ORIGIN: '',
    WAREHOUSE_ADMIN_USERNAME: '', WAREHOUSE_ADMIN_PASSWORD: '', TELEGRAM_BOT_TOKEN: '', TELEGRAM_WEBHOOK_SECRET: '',
    DEPLOY_COMMIT_SHA: snapshot.build || 'local-standby' };
  for (const name of Object.keys(env)) if (name.startsWith('AKBEL_BACKUP_')) delete env[name];
  standby = spawn(process.execPath, ['server.mjs'], { cwd: root, env, windowsHide: true, stdio: 'ignore' });
  standby.on('error', () => { activeRevision = ''; });
  standby.on('exit', () => { activeRevision = ''; });
  activeRevision = snapshot.revision;
  console.log('Read-only standby: http://127.0.0.1:8793/warehouse/admin');
}

try {
  // On restart during an outage, serve the last COMPLETE backup immediately.
  if (process.argv.includes('--standby')) {
    try {
      const latest = JSON.parse(await fs.readFile(path.join(directory, 'latest.json'), 'utf8'));
      if (!safeHash(latest.revision)) throw new Error('Invalid backup pointer');
      const snapshot = validateSnapshot(JSON.parse(unseal(await fs.readFile(path.join(directory, 'snapshots', `${latest.revision}.enc`)), key)));
      await startStandby(snapshot);
    } catch (error) {
      if (error.code !== 'ENOENT') console.error('Existing backup could not start; retained unchanged.');
    }
  }
  do {
    try {
      const snapshot = await pullBackup({ source, directory, authorization, key, photoDelayMs: 1200 });
      await startStandby(snapshot);
      await atomicWrite(path.join(directory, 'agent-status.json'), JSON.stringify({ ok: true, checkedAt: new Date().toISOString(), capturedAt: snapshot.capturedAt, revision: snapshot.revision, photos: snapshot.photos.length, readOnly: true }));
      console.log(`Backup OK: ${snapshot.capturedAt}; ${snapshot.photos.length} photos`);
      retryMs = 30000;
    } catch (error) {
      // Never log request headers, passwords, encrypted keys or state contents.
      const message = String(error.message).replace(/https?:\/\/\S+/g, '[source]');
      await atomicWrite(path.join(directory, 'agent-status.json'), JSON.stringify({ ok: false, checkedAt: new Date().toISOString(), error: message, readOnly: true }));
      console.error(`Backup failed: ${message}. Previous complete backup retained.`);
      retryMs = Math.min(300000, retryMs * 2);
      if (process.argv.includes('--once')) process.exitCode = 1;
    }
    if (process.argv.includes('--once')) break;
    for (let elapsed = 0; elapsed < retryMs && !stopping; elapsed += 1000) await new Promise(resolve => setTimeout(resolve, 1000));
  } while (!stopping);
} finally {
  standby?.kill();
  await lock.close();
  await fs.rm(lockPath, { force: true });
}
