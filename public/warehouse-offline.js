const DB_NAME = 'akbel-offline-db';
const STORE_NAME = 'sync-queue';

function openOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function serializeBody(body) {
  if (body instanceof FormData) {
    const entries = [];
    for (const [key, value] of body.entries()) {
      entries.push({ key, value });
    }
    return { type: 'FormData', entries };
  } else if (typeof body === 'string') {
    return { type: 'string', value: body };
  } else if (body) {
    return { type: 'json', value: JSON.stringify(body) };
  }
  return null;
}

function deserializeBody(data) {
  if (!data) return null;
  if (data.type === 'FormData') {
    const fd = new FormData();
    for (const entry of data.entries) {
      fd.append(entry.key, entry.value);
    }
    return fd;
  } else if (data.type === 'string') {
    return data.value;
  } else if (data.type === 'json') {
    return data.value;
  }
  return data.value;
}

window.warehouseOfflineQueue = {
  async addRequest(url, options, authValue, accessToken) {
    const db = await openOfflineDb();
    const headersObj = {};
    if (options.headers) {
      const h = options.headers instanceof Headers ? options.headers : new Headers(options.headers);
      h.forEach((value, key) => {
        headersObj[key] = value;
      });
    }
    if (authValue && !headersObj['authorization'] && !headersObj['Authorization']) {
      headersObj['Authorization'] = authValue;
    }
    if (accessToken && !headersObj['x-warehouse-access']) {
      headersObj['x-warehouse-access'] = accessToken;
    }

    const serializedBody = await serializeBody(options.body);

    const record = {
      url,
      method: options.method || 'GET',
      headers: headersObj,
      bodyData: serializedBody,
      timestamp: Date.now()
    };

    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.add(record);
      req.onsuccess = () => {
        window.dispatchEvent(new CustomEvent('warehouse-offline-saved'));
        resolve(req.result);
      };
      req.onerror = () => reject(req.error);
    });
  },

  async getPendingRequests() {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },

  async removeRequest(id) {
    const db = await openOfflineDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  
  async syncPendingRequests() {
    if (!navigator.onLine) return;
    
    const pending = await this.getPendingRequests();
    if (pending.length === 0) return;

    window.dispatchEvent(new CustomEvent('warehouse-sync-start', { detail: { count: pending.length } }));

    let successCount = 0;
    for (const req of pending) {
      try {
        const body = deserializeBody(req.bodyData);
        const fetchOptions = {
          method: req.method,
          headers: req.headers,
          body: body
        };
        const response = await fetch(req.url, fetchOptions);
        if (response.ok || response.status === 400 || response.status === 403 || response.status === 404) {
          // If successful or client error (won't fix by retrying), remove it.
          await this.removeRequest(req.id);
          successCount++;
        } else if (response.status === 401) {
          // Auth error, stop sync to avoid spamming errors, wait for login
          break;
        }
      } catch (err) {
        console.error('Oflayn sinxronizatsiya xatosi:', err);
        break; // Network error again, stop sync
      }
    }
    
    window.dispatchEvent(new CustomEvent('warehouse-sync-end', { detail: { successCount, totalCount: pending.length } }));
  }
};

window.addEventListener('online', () => {
  window.warehouseOfflineQueue.syncPendingRequests();
});

document.addEventListener('DOMContentLoaded', () => {
  const container = document.createElement('div');
  container.id = 'offline-indicator';
  container.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#9f1239;color:#fff;text-align:center;padding:8px;font-size:14px;z-index:9999;display:none;box-shadow:0 4px 6px rgba(0,0,0,0.1);font-family:sans-serif;';
  document.body.prepend(container);

  function updateIndicator() {
    if (!navigator.onLine) {
      container.style.display = 'block';
      container.style.background = '#9f1239';
      window.warehouseOfflineQueue.getPendingRequests().then(pending => {
        if (pending.length > 0) {
          container.textContent = `Siz oflaynsiz. Tarmoq yo'q. (Kutilayotgan so'rovlar: ${pending.length} ta)`;
        } else {
          container.textContent = `Siz oflaynsiz. Tarmoq yo'q.`;
        }
      });
    } else {
      window.warehouseOfflineQueue.getPendingRequests().then(pending => {
        if (pending.length > 0) {
          container.style.display = 'block';
          container.style.background = '#9a6700';
          container.textContent = `Sinxronizatsiya qilinmoqda... (${pending.length} ta kutilmoqda)`;
          window.warehouseOfflineQueue.syncPendingRequests();
        } else {
          container.style.display = 'none';
        }
      });
    }
  }

  window.addEventListener('online', updateIndicator);
  window.addEventListener('offline', updateIndicator);
  window.addEventListener('warehouse-sync-end', updateIndicator);
  window.addEventListener('warehouse-offline-saved', updateIndicator);
  
  updateIndicator();
  setInterval(() => {
    if (navigator.onLine) {
      window.warehouseOfflineQueue.syncPendingRequests();
    }
  }, 30000);
});
