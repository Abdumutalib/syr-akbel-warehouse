import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createSnapshot, validateSnapshot, pullBackup, restoreBackup, seal, unseal, validateSource, safePhotoName } from '../lib/disaster-recovery.mjs';

test('encrypted backup restores all state and photos, and failed sync keeps the last complete copy', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'akbel-recovery-'));
  const key = crypto.randomBytes(32).toString('base64');
  try {
    const photoDirectory = path.join(dir, 'source-photos');
    await fs.mkdir(photoDirectory);
    const photo = Buffer.from('test image bytes');
    await fs.writeFile(path.join(photoDirectory, 'receipt.jpg'), photo);
    const state = { warehouse: { currentStockKg: 99 }, users: [{ id: 1, fullName: 'Private customer' }], transactions: [{ id: 1, amountKg: 1 }], staffAccounts: [{ username: 'staff', permissions: ['seller'] }] };
    let snapshot = await createSnapshot({ state, photoDirectory, scheduler: { lastSent: 'yesterday' }, build: 'test-build' });
    let corrupt = false;
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return new Response(url.endsWith('/snapshot') ? JSON.stringify(snapshot) : corrupt ? 'corrupt' : photo);
    };
    const directory = path.join(dir, 'backup');
    await pullBackup({ source: 'https://example.com', directory, authorization: 'Basic test', key, fetchImpl });
    const pointer = await fs.readFile(path.join(directory, 'latest.json'), 'utf8');
    const encrypted = await fs.readFile(path.join(directory, 'snapshots', snapshot.revision + '.enc'));
    assert.equal(encrypted.includes(Buffer.from('Private customer')), false);
    assert.ok(requests.every(r => r.options.redirect === 'error' && r.options.headers.Authorization === 'Basic test'));
    const target = path.join(dir, 'restored');
    const restored = await restoreBackup({ directory, target, key });
    assert.deepEqual(restored.state, state);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, 'warehouse.json'), 'utf8')), state);
    assert.deepEqual(await fs.readFile(path.join(target, 'transaction-photos', 'receipt.jpg')), photo);
    assert.equal(JSON.parse(await fs.readFile(path.join(target, 'scheduler.json'), 'utf8')).lastSent, 'yesterday');
    await assert.rejects(restoreBackup({ directory, target, key }), /EEXIST/);
    // A new snapshot references a new blob, but the download is incomplete/corrupt.
    await fs.writeFile(path.join(photoDirectory, 'receipt.jpg'), 'new photo');
    snapshot = await createSnapshot({ state: { ...state, users: [] }, photoDirectory });
    corrupt = true;
    await assert.rejects(pullBackup({ source: 'https://example.com', directory, authorization: 'Basic test', key, fetchImpl }), /checksum mismatch/);
    assert.equal(await fs.readFile(path.join(directory, 'latest.json'), 'utf8'), pointer);
    await restoreBackup({ directory, target: path.join(dir, 'after-failure'), key });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('backup encryption detects altered data and a wrong key', () => {
  const key = crypto.randomBytes(32).toString('base64');
  const bytes = seal(Buffer.from('confidential'), key);
  assert.equal(unseal(bytes, key).toString(), 'confidential');
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => unseal(bytes, key));
  assert.throws(() => unseal(seal(Buffer.from('x'), key), crypto.randomBytes(32).toString('base64')));
  assert.throws(() => seal(Buffer.from('x'), 'short'));
});

test('backup source, manifests and filenames cannot redirect credentials or escape directories', () => {
  for (const source of ['http://example.com', 'https://user:password@example.com', 'https://example.com/path', 'https://example.com/?key=secret']) assert.throws(() => validateSource(source));
  for (const name of ['../state.json', '..', '/root', 'a/b', 'a\\b', 'C:state', '.secret']) assert.equal(safePhotoName(name), false);
  assert.throws(() => validateSnapshot({ format: 'akbel-backup-v1', revision: '../bad', state: {} }));
});
