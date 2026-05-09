const CACHE_NAME = 'akbel-cache-v2';

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

self.addEventListener('fetch', event => {
  const req = event.request;
  
  if (req.method !== 'GET') {
    return;
  }

  // Network First, fallback to cache
  event.respondWith(
    fetch(req).then(res => {
      // Tarmoq ishladi, javobni keshga saqlaymiz
      const resClone = res.clone();
      caches.open(CACHE_NAME).then(cache => {
        if (req.url.startsWith('http')) {
          cache.put(req, resClone);
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
