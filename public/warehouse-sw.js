const CACHE_NAME = 'akbel-cache-v10000';
const MAX_CACHE_ITEMS = 50;

self.addEventListener('install', event => {
  self.skipWaiting();
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

  // Network First, fallback to cache (faqat statik fayllar uchun)
  event.respondWith(
    fetch(req).then(res => {
      // Tarmoq ishladi, javobni keshga saqlaymiz
      const resClone = res.clone();
      caches.open(CACHE_NAME).then(cache => {
        if (req.url.startsWith('http')) {
          cache.put(req, resClone).then(() => {
            trimCache(CACHE_NAME, MAX_CACHE_ITEMS);
          });
        }
      });
      return res;
    }).catch(async err => {
      // Tarmoq uzildi, keshdan qidiramiz
      const cachedRes = await caches.match(req);
      if (cachedRes) {
        return cachedRes;
      }
      throw err;
    })
  );
});
