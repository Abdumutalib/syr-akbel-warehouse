import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { Readable } from 'node:stream';
import { createWarehouseSessions } from '../lib/warehouse-sessions.mjs';
import { setupExtendedBot } from '../app/telegram-bot-extended.mjs';
import { normalizeWarehouseState, upsertCustomer, recordApprovedSale, getCustomerDetail } from '../lib/warehouse-bot.mjs';

test('signed sessions enforce expiry, tampering and server restart boundaries', () => {
  let now = 1000;
  const sessions = createWarehouseSessions({ ttlMs: 100, now: () => now });
  const token = sessions.issue('admin', 'admin', 'credential-version');
  assert.equal(sessions.read(token, 'admin').subject, 'admin');
  assert.equal(sessions.read(token, 'staff'), null);
  assert.equal(sessions.read(token.slice(0, 3) + 'x' + token.slice(4), 'admin'), null);
  assert.equal(createWarehouseSessions().read(token, 'admin'), null);
  now = 1100;
  assert.equal(sessions.read(token, 'admin'), null);
});

test('transaction photos reject executable schemes and HTML attribute injection', () => {
  const state = normalizeWarehouseState({});
  const customer = upsertCustomer(state, { fullName: 'Photo customer' });
  const result = recordApprovedSale(state, { userId: customer.id, amountKg: 1, photos: [
    { fileName: 'bad.jpg', mimeType: 'image/jpeg', url: 'javascript:alert(1)' },
    { fileName: 'bad2.jpg', mimeType: 'image/jpeg', url: '/warehouse/uploads/a.jpg" onerror="alert(1)' },
    { fileName: 'good.jpg', mimeType: 'image/jpeg', url: '/warehouse/uploads/abc-123.jpg' },
  ] });
  assert.equal(result.transaction.photos.length, 1);
  assert.equal(result.transaction.photos[0].fileName, 'good.jpg');
});

test('API caching separates accounts and never persists raw bearer credentials', async () => {
  const persistedKeys = []; let requests = 0;
  const window = { crypto: webcrypto, warehouseOfflineQueue: { async setCachedGet(key) { persistedKeys.push(key); }, async getCachedGet() { return null; } } };
  const context = vm.createContext({ window, TextEncoder, Headers, Response, AbortController, setTimeout, clearTimeout, console, fetch: async (_url, options) => {
    requests++;
    return new Response(JSON.stringify({ user: options.headers.get('X-Warehouse-Access') }), { status: 200 });
  } });
  vm.runInContext(fs.readFileSync(new URL('../public/warehouse-api.js', import.meta.url), 'utf8'), context);
  const api = window.warehouseApi;
  assert.equal((await api.fetch('/api/warehouse/customers', {}, '', 'account-A-secret')).user, 'account-A-secret');
  assert.equal((await api.fetch('/api/warehouse/customers', {}, '', 'account-B-secret')).user, 'account-B-secret');
  assert.equal(requests, 2);
  assert.equal(persistedKeys.length, 2);
  assert.equal(persistedKeys.some(key => key.includes('account-A-secret') || key.includes('account-B-secret')), false);
});

test('customer names, organization and phone HTML are escaped at the rendering boundary', () => {
  const window = {};
  vm.runInNewContext(fs.readFileSync(new URL('../public/warehouse-api.js', import.meta.url), 'utf8'), { window });
  const source = fs.readFileSync(new URL('../public/warehouse-customers.html', import.meta.url), 'utf8');
  const start = source.indexOf('    function renderGroup('), end = source.indexOf('    function matchesCustomerSearch', start);
  const host = { innerHTML: '', querySelectorAll: () => [] };
  const payload = '<img src=x onerror="window.audit=1">';
  const context = vm.createContext({ window, document: { getElementById: () => host }, withAccess: value => value, renderMapLinksList: () => '' });
  vm.runInContext(source.slice(start, end) + '\nrenderGroup("list", ' + JSON.stringify([{ id: 1, fullName: payload, organizationName: payload, phones: [payload] }]) + ', "");', context);
  assert.equal(host.innerHTML.includes(payload), false);
  assert.ok(host.innerHTML.includes('&lt;img'));
});

test('extended bot uses the active state summary and restricts replies to the customer private chat', async () => {
  const originalToken = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = 'fake-test-token';
  try {
    const state = normalizeWarehouseState({});
    const customer = upsertCustomer(state, { fullName: 'Test customer', telegramId: 101 });
    recordApprovedSale(state, { userId: customer.id, amountKg: 2, priceType: 'cash' });
    const debt = getCustomerDetail(state, customer.id).summary.currentDebt;
    const sent = [];
    const handler = setupExtendedBot({ loadState: () => state, authorize: () => true, sendMessage: async (chat, text) => sent.push({ chat, text }) });
    async function invoke(chatId, text) {
      const req = Readable.from([Buffer.from(JSON.stringify({ message: { from: { id: 101 }, chat: { id: chatId }, text } }))]);
      let status;
      await handler(req, { writeHead(value) { status = value; }, end() {} });
      return status;
    }
    assert.equal(await invoke(101, '/debt'), 200);
    assert.equal(sent[0].chat, 101);
    assert.ok(sent[0].text.includes(debt.toLocaleString('ru-RU')));
    assert.equal(sent[0].text.includes("Qarz yo'q"), false);
    await invoke(999, '/debt');
    assert.equal(sent.length, 1);
    const denied = setupExtendedBot({ loadState: () => state, sendMessage: async () => assert.fail('unauthorized send') });
    let status;
    await denied(Readable.from([]), { writeHead(value) { status = value; }, end() {} });
    assert.equal(status, 503);
  } finally {
    if (originalToken === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = originalToken;
  }
});
