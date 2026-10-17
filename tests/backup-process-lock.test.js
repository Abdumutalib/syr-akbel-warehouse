import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { acquireBackupProcessLock } from '../lib/backup-process-lock.mjs';

test('OS lock excludes a second agent, cleans an empty crash artifact, and can be reacquired', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'akbel-agent-lock-'));
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const port = s.address().port; s.close(() => resolve(port)); }); });
  let release;
  try {
    await fs.writeFile(path.join(dir, 'agent.lock'), '');
    release = await acquireBackupProcessLock(dir, port);
    await assert.rejects(acquireBackupProcessLock(dir, port), { code: 'EADDRINUSE' });
    assert.equal(await fs.readFile(path.join(dir, 'agent.lock'), 'utf8'), String(process.pid));
    await release(); release = null;
    release = await acquireBackupProcessLock(dir, port);
  } finally { if (release) await release(); await fs.rm(dir, { recursive: true, force: true }); }
});

test('a live legacy PID is never displaced even if its TCP lock is absent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'akbel-agent-lock-'));
  try {
    await fs.writeFile(path.join(dir, 'agent.lock'), String(process.pid));
    await assert.rejects(acquireBackupProcessLock(dir, 0), /still running/);
    assert.equal(await fs.readFile(path.join(dir, 'agent.lock'), 'utf8'), String(process.pid));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
