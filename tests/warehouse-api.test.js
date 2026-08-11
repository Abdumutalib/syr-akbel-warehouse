import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiPath = path.join(__dirname, '../public/warehouse-api.js');

function loadWarehouseApiHarness({ cachedGetValue = { ok: true, items: [{ id: 1 }] } } = {}) {
  const sandbox = {
    window: {
      warehouseOfflineQueue: {
        async getCachedGet(key) {
          return cachedGetValue;
        },
        async setCachedGet() {},
        async addRequest() {
          throw new Error('should not queue');
        },
      },
    },
    fetch: async () => new Response(JSON.stringify({ error: 'server down' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    }),
    Headers,
    AbortController,
    setTimeout,
    clearTimeout,
    console,
    URL,
    Date,
    Promise,
    Math,
    JSON,
  };

  const context = vm.createContext(sandbox);
  const source = fs.readFileSync(apiPath, 'utf8');
  vm.runInContext(source, context, { filename: apiPath });
  return context.window.warehouseApi;
}

test('GET requests fall back to stale cached data when the server returns 5xx', async () => {
  const api = loadWarehouseApiHarness();
  const result = await api.fetch('/api/warehouse/customers', { method: 'GET' });
  assert.deepEqual(result, { ok: true, items: [{ id: 1 }] });
});
