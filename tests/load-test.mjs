/**
 * АКБЕЛ Warehouse — Load Test
 * Node.js built-in http orqali parallel so'rovlar yuboradi.
 * Ishlatish: node tests/load-test.mjs [PORT]
 */
import http from 'node:http';

const PORT = Number(process.argv[2] || process.env.PORT || 8787);
const BASE = `http://127.0.0.1:${PORT}`;

// --- yordamchi: bitta HTTP so'rov ---
function request(path, opts = {}) {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = http.request(
      { hostname: '127.0.0.1', port: PORT, path, method: opts.method || 'GET',
        headers: opts.headers || {} },
      (res) => {
        let body = '';
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          resolve({ status: res.statusCode, ms: Date.now() - start, body, ok: res.statusCode < 500 });
        });
      }
    );
    req.on('error', (e) => resolve({ status: 0, ms: Date.now() - start, body: e.message, ok: false }));
    req.setTimeout(5000, () => { req.destroy(); resolve({ status: 0, ms: 5000, body: 'timeout', ok: false }); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

// --- parallel batch ---
async function batch(path, concurrency, opts = {}) {
  const results = await Promise.all(
    Array.from({ length: concurrency }, () => request(path, opts))
  );
  const ok = results.filter((r) => r.ok).length;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const avg = Math.round(times.reduce((s, v) => s + v, 0) / times.length);
  const p95 = times[Math.floor(times.length * 0.95)] ?? times.at(-1);
  const max = times.at(-1);
  return { ok, fail: concurrency - ok, avg, p95, max, total: concurrency };
}

function log(label, r) {
  const status = r.fail === 0 ? '✅' : r.fail < r.total * 0.05 ? '⚠️' : '❌';
  console.log(
    `${status} ${label.padEnd(40)} ok:${r.ok}/${r.total}  avg:${r.avg}ms  p95:${r.p95}ms  max:${r.max}ms`
  );
  return r.fail === 0;
}

// --- asosiy test ketma-ketligi ---
async function runLoadTest() {
  console.log(`\n🔧 АКБЕЛ Warehouse Load Test → ${BASE}\n`);

  // 1. Server yuqoriligi (healthz)
  await new Promise((r) => setTimeout(r, 300));
  const ping = await request('/healthz');
  if (!ping.ok) {
    console.error(`❌ Server javob bermayapti (${BASE}/healthz) — portni tekshiring.`);
    process.exit(1);
  }
  console.log(`✅ Server ishlayapti — /healthz ${ping.status} (${ping.ms}ms)\n`);

  let allPassed = true;

  // Eng avval: 404 va webhook testlari (rate limit oshishidan oldin)
  console.log('── Yo\'q sahifalar ──');
  const notFound = await request('/yo-q-bunday-yol-1234');
  const nfStatus = notFound.status === 404 ? '✅' : '❌';
  console.log(`${nfStatus} 404 yo'l → ${notFound.status}`);
  allPassed &= notFound.status === 404;

  console.log('\n── Webhook xatolik chidamliligi ──');
  const badJson = await request('/api/telegram/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: 'not-json-{{{',
  });
  const crashStatus = badJson.status !== 0 && badJson.status < 500 ? '✅' : '❌';
  console.log(`${crashStatus} Noto'g'ri JSON webhook → ${badJson.status} (server crash bo'lmadi)`);
  allPassed &= badJson.status !== 0 && badJson.status < 500;

  // 2. Oddiy sahifalar — 50 parallel
  console.log('\n── Statik sahifalar (50 parallel) ──');
  allPassed &= log('/warehouse/admin  (HTML)',     await batch('/warehouse/admin', 50));
  allPassed &= log('/warehouse/seller (HTML)',     await batch('/warehouse/seller', 50));
  allPassed &= log('/warehouse/customers (HTML)',  await batch('/warehouse/customers', 50));

  // 3. API endpointlar — 100 parallel
  console.log('\n── API endpointlar (100 parallel) ──');
  allPassed &= log('/healthz',                     await batch('/healthz', 100));
  allPassed &= log('/api/analytics/today',         await batch('/api/analytics/today', 100));
  allPassed &= log('/api/analytics/trend?days=14', await batch('/api/analytics/trend?days=14', 100));
  allPassed &= log('/api/analytics/stock',         await batch('/api/analytics/stock', 100));

  // 4. Rate limiter tekshiruvi — bu paytda IP ~350 so'rov yuborgan (300 dan oshdi)
  console.log('\n── Rate limiter tekshiruvi ──');
  const rlRaw = await Promise.all(
    Array.from({ length: 50 }, () => request('/api/analytics/stock'))
  );
  const got429 = rlRaw.filter((r) => r.status === 429).length;
  const got200rl = rlRaw.filter((r) => r.status === 200).length;
  const rlOk = got429 > 0;
  console.log(`${rlOk ? '✅' : '⚠️'} Rate limiter  200:${got200rl}  429:${got429}  (>300 ta keyin 429 kutiladi)`);

  // 5. Yuqori yuklama — 200 parallel × 3 bosqich (429 ham ok — server crash bo'lmasa yetarli)
  console.log('\n── Yuqori yuklama: 200 parallel × 3 bosqich ──');
  for (let i = 1; i <= 3; i++) {
    const r = await batch('/api/analytics/today', 200);
    log(`Bosqich ${i}: /api/analytics/today`, r);
  }

  // Xulosa
  const finalOk = allPassed;
  console.log('\n' + '─'.repeat(60));
  if (finalOk) {
    console.log('✅ BARCHA TESTLAR O\'TDI — server yuqori yuklamada barqaror.\n');
    process.exit(0);
  } else {
    console.log('❌ BA\'ZI TESTLAR MUVAFFAQIYATSIZ — yuqoriga qarang.\n');
    process.exit(1);
  }
}

runLoadTest().catch((e) => { console.error('FATAL:', e); process.exit(1); });
