import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function checkFile(file) {
  const full = path.join(root, file);
  const exists = fs.existsSync(full);
  console.log(`${exists ? '✓' : '✗'} ${file}`);
  return exists;
}

async function fetchUrl(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: controller.signal,
    });
    const body = await res.text();
    return {
      status: res.status,
      body,
      server: res.headers.get('server') || '',
      cfRay: res.headers.get('cf-ray') || '',
    };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(value, fallback) {
  const raw = String(value || fallback || '').trim();
  return raw.replace(/\/$/, '');
}

async function main() {
  console.log('Deployment verification');
  console.log('======================');
  const essentialFiles = ['package.json', 'server.mjs', 'public/warehouse-admin.html', 'public/warehouse-seller.html', 'public/warehouse-sale.html', 'data/warehouse.json'];
  const missing = essentialFiles.filter((file) => !checkFile(file));

  const localPort = Number(process.env.PORT) || 8787;
  const localBaseUrl = normalizeBaseUrl(process.env.VERIFY_LOCAL_BASE_URL, `http://127.0.0.1:${localPort}`);
  const prodBaseUrl = normalizeBaseUrl(process.env.VERIFY_PROD_BASE_URL, 'https://akbelim.com');

  console.log('');
  console.log(`Checking local HTTP endpoint (${localBaseUrl})...`);
  try {
    const response = await fetchUrl(`${localBaseUrl}/healthz`);
    console.log(`HTTP ${response.status}`);
    console.log(response.body.slice(0, 300));
  } catch (error) {
    console.log(`HTTP check failed: ${error.message}`);
  }

  console.log('');
  console.log(`Checking production HTTP endpoints (${prodBaseUrl})...`);
  const prodChecks = ['/healthz', '/warehouse/admin'];
  for (const route of prodChecks) {
    try {
      const response = await fetchUrl(`${prodBaseUrl}${route}`);
      const details = response.cfRay ? ` cf-ray=${response.cfRay}` : '';
      console.log(`${route} -> HTTP ${response.status} server=${response.server || 'unknown'}${details}`);
      if (response.status === 523) {
        console.log('  ! Cloudflare 523: origin server unavailable or unreachable from Cloudflare edge.');
      }
    } catch (error) {
      console.log(`${route} -> failed: ${error.message}`);
    }
  }

  console.log('');
  console.log('Recommended next steps:');
  console.log('- Ensure .env contains real WAREHOUSE_ADMIN_USERNAME and WAREHOUSE_ADMIN_PASSWORD');
  console.log('- On hosting, set health check path to /healthz and keep start command as npm start');
  console.log('- Verify hosting instance is healthy and listening on PORT from environment');
  console.log('- If production returns 523 with server=cloudflare, fix Cloudflare -> origin connectivity/SSL');
  if (missing.length) {
    console.log(`- Missing files: ${missing.join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
