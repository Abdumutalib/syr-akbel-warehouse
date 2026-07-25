const CACHE_NAME = 'akbel-cache-v10001';
const MAX_CACHE_ITEMS = 120;
const CORE_ASSETS = [
  '/warehouse/admin',
  '/warehouse/customers',
  '/warehouse/orders',
  '/warehouse/ledger',
  '/warehouse/seller',
  '/warehouse/seller/sale/cash',
  '/warehouse/seller/sale/transfer',
  '/warehouse/assets/warehouse-api.js',
  '/warehouse/assets/warehouse-auth-pin.js',
  '/warehouse/assets/warehouse-offline.js',
  '/warehouse-top-nav.js',
  '/favicon.svg',
  '/icon-192.png',
];
const OFFLINE_HTML = `<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Oflayn</title><body style="font-family:sans-serif;background:#f6efe6;color:#1d1a16;display:grid;place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center"><div><h1 style="margin:0 0 12px">Siz oflaynsiz</h1><p style="margin:0;max-width:28rem;line-height:1.5">Oxirgi yuklangan sahifalar va keshlangan ma'lumotlar mavjud bo'lsa ishlaydi. Tarmoq qaytgach so'rovlar avtomatik yuboriladi.</p></div></body></html>`;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE_ASSETS.map((url) => new Request(url, { cache: 'reload' })));
    await cache.put('/__offline__', new Response(OFFLINE_HTML, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.map(key => {
        if (key !== CACHE_NAME) {
          return caches.delete(key);
        }
      })
    ))
  );
  self.clients.claim();
});

async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      await cache.delete(keys[0]);
      await trimCache(cacheName, maxItems);
    }
  } catch (e) {
    // xato bo'lsa indamaymiz
  }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  
  if (req.method !== 'GET') {
    return;
  }

  const url = new URL(req.url);

  // API so'rovlarini keshlamaslik — doimo serverdan yangi ma'lumot olish
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/warehouse/api/')) {
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedRes = await cache.match(req, { ignoreSearch: true });
    const networkFetch = fetch(req).then(async (res) => {
      if (res && res.ok && req.url.startsWith('http')) {
        await cache.put(req, res.clone());
        trimCache(CACHE_NAME, MAX_CACHE_ITEMS);
      }
      return res;
    });

    if (cachedRes) {
      event.waitUntil(networkFetch.catch(() => null));
      return cachedRes;
    }

    try {
      return await networkFetch;
    } catch (err) {
      if (req.mode === 'navigate') {
        const offlineRes = await cache.match('/__offline__');
        if (offlineRes) {
          return offlineRes;
        }
      }
      throw err;
    }
  })());
});
