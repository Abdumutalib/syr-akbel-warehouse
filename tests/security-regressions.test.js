import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadWarehouseState, saveWarehouseState, seedWarehouseStock, createStaffAccount, createStaffAccessLink, upsertCustomer, recordApprovedSale } from '../lib/warehouse-bot.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const api = '/warehouse/api/warehouse/';
const basic = 'Basic ' + Buffer.from('security-admin:AdminPassword123!').toString('base64');

async function fixture(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'warehouse-security-'));
  const statePath = path.join(dir, 'warehouse.json');
  const state = loadWarehouseState(statePath);
  state.adminCredentials = { username: 'security-admin', password: 'AdminPassword123!' };
  seedWarehouseStock(state, 100);
  const permissions = ['seller', 'customers', 'orders', 'cash', 'transfer', 'write_cash_sale', 'write_transfer_sale'];
  const staff = createStaffAccount(state, { fullName: 'Seller A', username: 'seller-a', password: 'PasswordA123', role: 'seller', permissions });
  const otherStaff = createStaffAccount(state, { fullName: 'Seller B', username: 'seller-b', password: 'PasswordB123', role: 'seller' });
  const customer = upsertCustomer(state, { fullName: 'Customer A' }, { actor: staff });
  const other = upsertCustomer(state, { fullName: 'Customer B' }, { actor: otherStaff });
  recordApprovedSale(state, { userId: customer.id, amountKg: 2, priceType: 'cash' }, { actor: staff });
  recordApprovedSale(state, { userId: other.id, amountKg: 3, priceType: 'transfer' }, { actor: otherStaff });
  const links = Object.fromEntries(permissions.map(p => [p, createStaffAccessLink(state, staff.id, p)]));
  const pinAccount = createStaffAccount(state, { fullName: 'PIN User', username: 'pin-user', password: 'PinPassword123', role: 'seller', permissions: ['seller'], pin: '2468' });
  const pinLink = createStaffAccessLink(state, pinAccount.id, 'seller');
  saveWarehouseState(statePath, state);
  const port = await new Promise(resolve => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const child = spawn(process.execPath, ['server.mjs'], { cwd: root, env: { ...process.env, PORT: String(port), WAREHOUSE_STATE_FILE: statePath, WAREHOUSE_DB_URL: '', DATABASE_URL: '', WAREHOUSE_ADMIN_USERNAME: '', WAREHOUSE_ADMIN_PASSWORD: '', WAREHOUSE_SITE_TOKEN: '', WAREHOUSE_ALLOWED_ORIGIN: '', TELEGRAM_BOT_TOKEN: 'fake-local-test-token', TELEGRAM_WEBHOOK_SECRET: 'test-webhook-secret' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  const base = `http://127.0.0.1:${port}`;
  async function request(url, { token, cookie, admin = false, method = 'GET', body, headers = {} } = {}) {
    const response = await fetch(base + url, { method, redirect: 'manual', headers: { ...(token ? { 'X-Warehouse-Access': token } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(admin ? { Authorization: basic } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = { text }; }
    return { response, status: response.status, data };
  }
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) { try { await fetch(base + '/healthz'); ready = true; break; } catch { await new Promise(r => setTimeout(r, 50)); } }
    assert.ok(ready, stderr);
    await run({ statePath, state, staff, otherStaff, customer, other, links, pinLink, request, base });
  } finally {
    const exited = new Promise(resolve => { child.once('exit', resolve); setTimeout(resolve, 3000).unref(); });
    child.kill('SIGTERM'); await exited;
    assert.equal(path.dirname(dir), path.resolve(os.tmpdir()));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('admin cookies are random sessions, reject the old default, and expire on password change', () => fixture(async ({ request, base }) => {
  const forged = crypto.createHash('sha256').update('warehouse|warehouse-gate|v1').digest('hex');
  assert.equal((await request(api + 'staff', { cookie: 'warehouse-site=' + forged })).status, 401);
  const login = () => fetch(base + '/warehouse-login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Forwarded-Proto': 'https' }, body: new URLSearchParams({ username: 'security-admin', password: 'AdminPassword123!' }) });
  const first = await login(), second = await login();
  const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.notEqual(first.headers.get('set-cookie'), second.headers.get('set-cookie'));
  assert.match(first.headers.get('set-cookie'), /Secure/);
  assert.equal((await request(api + 'customers', { cookie })).status, 200);
  const changed = await request(api + 'admin-credentials', { cookie, method: 'POST', body: { username: 'security-admin', password: 'NewPassword456!' } });
  assert.equal(changed.status, 200);
  assert.equal((await request(api + 'staff', { cookie })).status, 401);
}));

test('staff responses expose neither other links nor permissions outside the current link', () => fixture(async ({ request, links }) => {
  const profile = await request(api + 'auth-status', { token: links.seller.token });
  assert.deepEqual(profile.data.permissions, ['seller']);
  const catalog = await request(api + 'customer-catalog', { token: links.seller.token });
  assert.equal(catalog.status, 200);
  assert.equal(catalog.data.operator.accessLinks, undefined);
  assert.equal(catalog.data.operator.accessLink, undefined);
  assert.equal(JSON.stringify(catalog.data).includes(links.cash.token), false);
  assert.equal((await request(api + 'approved?paymentType=cash', { token: links.seller.token })).status, 401);
}));

test('a sale-only link can load customers and sell, but cannot create or delete customers', () => fixture(async ({ request, links, customer }) => {
  const token = links.write_cash_sale.token;
  assert.equal((await request(api + 'customers', { token })).status, 200);
  assert.equal((await request(api + 'customers', { token, method: 'POST', body: { fullName: 'Forbidden' } })).status, 401);
  assert.equal((await request(api + 'customers/' + customer.id, { token, method: 'DELETE' })).status, 401);
  assert.equal((await request(api + 'seller-sale', { token, method: 'POST', body: { userId: customer.id, amountKg: 1, priceType: 'cash' } })).status, 201);
  assert.equal((await request(api + 'seller-sale', { token: links.seller.token, method: 'POST', body: { userId: customer.id, amountKg: 1, priceType: 'cash' } })).status, 401);
}));

test('PIN verification authenticates only the verifying browser and revocation still applies', () => fixture(async ({ request, pinLink }) => {
  const token = pinLink.token;
  assert.equal((await request(api + 'customers', { token })).status, 401);
  const verified = await request(api + 'verify-pin', { token, method: 'POST', body: { pin: '2468' } });
  assert.equal(verified.status, 200);
  const cookie = verified.response.headers.get('set-cookie').split(';')[0];
  assert.equal((await request(api + 'customers', { token, cookie })).status, 200);
  assert.equal((await request(api + 'customers', { token })).status, 401);
  assert.equal((await request(api + 'auth-status', { token })).data.isUnlocked, false);
  const staff = (await request(api + 'staff', { admin: true })).data.staff;
  const account = staff.find(a => a.username === 'pin-user');
  assert.equal((await request(api + `staff/${account.id}/access-links/${pinLink.id}`, { admin: true, method: 'DELETE' })).status, 200);
  assert.equal((await request(api + 'customers', { token, cookie })).status, 401);
}));

test('rejected cross-seller updates and invalid sales leave memory and disk unchanged', () => fixture(async ({ request, links, customer, other, statePath }) => {
  const attempted = await request(api + 'customers', { token: links.customers.token, method: 'POST', body: { userId: other.id, fullName: 'Hijacked' } });
  assert.equal(attempted.status, 403);
  assert.equal((await request(api + 'customers/' + other.id, { admin: true })).data.customer.fullName, 'Customer B');
  const invalid = await request(api + 'seller-sale', { token: links.write_cash_sale.token, method: 'POST', body: { userId: customer.id, fullName: 'Must roll back', amountKg: 1, transactionDate: 'invalid date' } });
  assert.equal(invalid.status, 400);
  assert.equal((await request(api + 'customers/' + customer.id, { admin: true })).data.customer.fullName, 'Customer A');
  await request(api + 'customers', { token: links.customers.token, method: 'POST', body: { fullName: 'Valid new customer' } });
  const saved = JSON.parse(fs.readFileSync(statePath, 'utf8'));
  assert.equal(saved.users.find(u => u.id === other.id).fullName, 'Customer B');
  assert.equal(saved.users.find(u => u.id === customer.id).fullName, 'Customer A');
}));

test('hidden balances stay out of customer lists, history, and sale responses', () => fixture(async ({ request, links, customer }) => {
  const list = await request(api + 'customers', { token: links.seller.token });
  assert.equal(list.data.customers.find(c => c.id === customer.id).currentDebt, null);
  const detail = await request(api + 'customers/' + customer.id, { token: links.customers.token });
  assert.equal(detail.data.balanceVisible, false);
  assert.equal(detail.data.summary.currentDebt, null);
  assert.deepEqual(detail.data.history, []);
  const sale = await request(api + 'seller-sale', { token: links.write_cash_sale.token, method: 'POST', body: { userId: customer.id, amountKg: 1 } });
  assert.equal(sale.data.debt, null);
  assert.equal(sale.data.customer._debtCache, undefined);
}));

test('cash reports and public analytics cannot disclose transfer or company totals', () => fixture(async ({ request, links }) => {
  assert.equal((await request(api + 'approved?paymentType=all', { token: links.cash.token })).status, 401);
  assert.equal((await request(api + 'approved?paymentType=cash', { token: links.cash.token })).status, 200);
  assert.equal((await request('/api/analytics/today')).status, 401);
  assert.equal((await request('/warehouse/api/analytics/trend')).status, 401);
  assert.equal((await request('/api/analytics/today', { admin: true })).status, 200);
}));

test('orders permission covers creation, editing and deletion, and the sale shortcut resolves', () => fixture(async ({ request, links, base }) => {
  const token = links.orders.token;
  const created = await request(api + 'orders', { token, method: 'POST', body: { customerName: 'Customer A', note: 'Order' } });
  assert.equal(created.status, 201);
  const url = api + 'orders/' + created.data.order.id;
  assert.equal((await request(url, { token: links.customers.token, method: 'PUT', body: { note: 'Forbidden' } })).status, 401);
  assert.equal((await request(url, { token, method: 'PUT', body: { note: 'Updated' } })).status, 200);
  assert.equal((await request(url, { token, method: 'DELETE' })).status, 200);
  const page = await request('/warehouse/seller/sale/cash?access=' + links.write_cash_sale.token);
  assert.equal(page.status, 200);
  assert.ok(page.response.headers.get('set-cookie'));
}));

test('legacy sales use configured state and roll back an invalid batch', () => fixture(async ({ request, customer, statePath }) => {
  const before = loadWarehouseState(statePath);
  const stock = before.warehouse.currentStockKg;
  const body = { customerId: customer.id, items: [{ productId: 'cheese', kg: 1, price: -999 }], payment: { cash: 0, transfer: 0 } };
  const sale = await request('/api/sales', { admin: true, method: 'POST', body });
  assert.equal(sale.status, 200);
  assert.equal(sale.data.transaction.totalPrice, before.warehouse.cashPricePerKg);
  assert.equal(loadWarehouseState(statePath).warehouse.currentStockKg, stock - 1);
  body.items.push({ productId: 'bad-product', kg: 1 });
  assert.equal((await request('/api/sales', { admin: true, method: 'POST', body })).status, 400);
  assert.equal(loadWarehouseState(statePath).warehouse.currentStockKg, stock - 1);
  const live = await request(api + 'customers', { admin: true });
  assert.equal(live.data.stockKg, stock - 1);
}));

test('the extended Telegram route fails closed before processing a forged update', () => fixture(async ({ request }) => {
  assert.equal((await request('/telegram/webhook-extended', { method: 'POST', body: { message: { text: '/debt' } } })).status, 401);
}));

test('explicit seller login overrides an old admin cookie and cannot use admin APIs', () => fixture(async ({ request, base, links }) => {
  const login = await fetch(base + '/warehouse-login', { method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username: 'security-admin', password: 'AdminPassword123!' }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = { 'X-Warehouse-Authorization': 'Basic ' + Buffer.from('pin-user:PinPassword123').toString('base64') };
  const seller = await request(api + 'customers', { cookie, headers });
  assert.equal(seller.status, 200);
  assert.equal(seller.data.operator.role, 'seller');
  assert.equal(seller.data.operator.username, 'pin-user');
  assert.deepEqual(seller.data.operator.permissions, ['seller']);
  for (const url of [api + 'staff', api + 'approved?paymentType=cash', '/api/analytics/today']) {
    assert.equal((await request(url, { cookie, headers })).status, 401, url);
  }
  assert.equal((await request(api + 'customers', { token: links.cash.token, headers })).data.operator.username, 'pin-user');
  assert.equal((await request(api + 'staff', { cookie, token: links.seller.token })).status, 401);
  assert.equal((await request(api + 'staff', { cookie, token: 'invalid-token' })).status, 401);
  const invalid = { Authorization: 'Basic ' + Buffer.from('pin-user:wrong-password').toString('base64') };
  assert.equal((await request(api + 'customers', { cookie, headers: invalid })).status, 401);
  assert.equal((await request(api + 'staff', { cookie, headers: invalid })).status, 401);
  assert.equal((await request(api + 'staff', { cookie })).status, 200);
}));
