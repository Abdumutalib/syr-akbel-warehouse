import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import http from 'node:http';
import { createLocalBackupSetup } from '../lib/local-backup-setup.mjs';

async function fixture(run, options = {}) {
  const port = await new Promise(resolve => { const probe = net.createServer(); probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)); }); });
  const calls = [];
  const ui = createLocalBackupSetup({ port, configure: async value => { calls.push(value); }, ...options });
  await new Promise(resolve => ui.server.listen(port, '127.0.0.1', resolve));
  const origin = new URL(ui.url).origin;
  const post = (body, headers = {}) => fetch(ui.url, { method: 'POST', redirect: 'manual', headers: { Origin: origin, 'Content-Type': 'application/x-www-form-urlencoded', ...headers }, body });
  try { await run({ ui, origin, calls, post }); }
  finally { ui.server.closeAllConnections(); await new Promise(resolve => ui.server.close(resolve)); }
}

test('local setup requires the random URL, exact loopback Host, and same-origin form submission', () => fixture(async ({ ui, origin, calls, post }) => {
  assert.equal((await fetch(origin + '/')).status, 404);
  const hostStatus = await new Promise((resolve, reject) => {
    const request = http.get(ui.url, { headers: { Host: 'attacker.test' } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await post('username=admin&password=private', { Origin: 'https://attacker.test' })).status, 403);
  assert.equal((await post('{}', { 'Content-Type': 'application/json' })).status, 403);
  assert.equal((await post('username=admin&password=')).status, 400);
  assert.equal(calls.length, 0);
  const form = await fetch(ui.url);
  assert.match(form.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(form.headers.get('cache-control'), 'no-store');
}));

test('local setup submits credentials once without reflecting them, and reports verified copy status', () => fixture(async ({ ui, calls, post }) => {
  const response = await post('username=owner&password=private-password');
  assert.equal(response.status, 303);
  assert.deepEqual(calls, [{ username: 'owner', password: 'private-password' }]);
  const status = await fetch(ui.url + '/status');
  const html = await status.text();
  assert.ok(html.includes('Нусха сақланди'));
  assert.equal(html.includes('private-password'), false);
  assert.equal((await post('username=owner&password=private-password')).status, 409);
}, { getStatus: async () => ({ ok: true, capturedAt: '2026-10-17T00:00:00Z', photos: 2 }) }));

test('setup errors and oversized input expose no credentials and do not consume the setup opportunity', () => fixture(async ({ ui, post }) => {
  assert.equal((await post('username=admin&password=' + 'x'.repeat(9000))).status, 413);
  const response = await post('username=admin&password=private');
  assert.equal(response.status, 400);
  const html = await response.text();
  assert.equal(html.includes('private'), false);
  assert.equal(html.includes('secret-in-error'), false);
  assert.ok((await (await fetch(ui.url)).text()).includes('<form'));
}, { configure: async () => { throw new Error('secret-in-error'); } }));
