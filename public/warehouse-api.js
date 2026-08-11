/**
 * Warehouse API and utilities
 */

const GET_CACHE_TTL_MS = 60 * 1000;
const getRequestMemoryCache = new Map();
const inFlightGetRequests = new Map();

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char] || char));
}

window.escapeHtml = escapeHtml;

function cloneJsonValue(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function getMemoryCachedResponse(cacheKey) {
  const entry = getRequestMemoryCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (Date.now() - entry.updatedAt > GET_CACHE_TTL_MS) {
    getRequestMemoryCache.delete(cacheKey);
    return null;
  }
  return cloneJsonValue(entry.data);
}

function setMemoryCachedResponse(cacheKey, data) {
  getRequestMemoryCache.set(cacheKey, {
    updatedAt: Date.now(),
    data: cloneJsonValue(data),
  });
}

async function getStaleCachedResponse(cacheKey) {
  const memoryCached = getMemoryCachedResponse(cacheKey);
  if (memoryCached) {
    return memoryCached;
  }
  try {
    if (window.warehouseOfflineQueue?.getCachedGet) {
      const offlineCached = await window.warehouseOfflineQueue.getCachedGet(cacheKey, 24 * 60 * 60 * 1000);
      if (offlineCached) {
        setMemoryCachedResponse(cacheKey, offlineCached);
        return cloneJsonValue(offlineCached);
      }
    }
  } catch {
    // Ignore offline-cache issues and fall back to network handling.
  }
  return null;
}

window.warehouseApi = {
  /**
   * Centralized apiFetch logic
   */
  async fetch(url, options = {}, authHeaderValue = '', accessToken = '') {
    const normalizedUrl = typeof url === 'string' && url.startsWith('/api/warehouse')
      ? `/warehouse/api${url.slice('/api'.length)}`
      : url;
    const requestMethod = String(options.method || 'GET').toUpperCase();
    const cacheKey = requestMethod === 'GET' ? normalizedUrl : '';

    if (cacheKey) {
      const cached = getMemoryCachedResponse(cacheKey);
      if (cached) {
        return cached;
      }
      const pending = inFlightGetRequests.get(cacheKey);
      if (pending) {
        return pending.then((data) => cloneJsonValue(data));
      }
    }

    const requestHeaders = new Headers(options.headers || {});

    if (authHeaderValue && !requestHeaders.has('Authorization')) {
      requestHeaders.set('Authorization', authHeaderValue);
    }
    if (authHeaderValue && !requestHeaders.has('X-Warehouse-Authorization')) {
      requestHeaders.set('X-Warehouse-Authorization', authHeaderValue);
    }
    if (!authHeaderValue && requestHeaders.has('Authorization') && !requestHeaders.has('X-Warehouse-Authorization')) {
      requestHeaders.set('X-Warehouse-Authorization', requestHeaders.get('Authorization') || '');
    }
    if (accessToken && !requestHeaders.has('X-Warehouse-Access')) {
      requestHeaders.set('X-Warehouse-Access', accessToken);
    }
    if (options.method && options.method !== 'GET' && !requestHeaders.has('Idempotency-Key')) {
      const key = options.idempotencyKey || `ik-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      requestHeaders.set('Idempotency-Key', key);
      options.idempotencyKey = key; // Keep it for retries if needed
    }

    if (options.body && typeof options.body === 'string' && !requestHeaders.has('Content-Type')) {
      requestHeaders.set('Content-Type', 'application/json');
    }

    let response;
    let retries = 0;
    const maxRetries = 2;

    async function performFetch() {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout

        const res = await fetch(normalizedUrl, {
          ...options,
          headers: requestHeaders,
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        return res;
      } catch (err) {
        if (err.name === 'AbortError') throw new Error('So\'rov vaqti tugadi (Timeout)');
        throw err;
      }
    }

    const requestRunner = async () => {
      while (retries <= maxRetries) {
        try {
          response = await performFetch();

          if (requestMethod === 'GET' && response.status >= 500 && response.status <= 599) {
            if (retries < maxRetries) {
              retries += 1;
              await new Promise((resolve) => setTimeout(resolve, 1000 * retries));
              continue;
            }
            const cached = await getStaleCachedResponse(cacheKey);
            if (cached) {
              setMemoryCachedResponse(cacheKey, cached);
              return cloneJsonValue(cached);
            }
          }

          if (requestMethod === 'GET' && !response.ok && response.status >= 500 && response.status <= 599) {
            const cached = await getStaleCachedResponse(cacheKey);
            if (cached) {
              setMemoryCachedResponse(cacheKey, cached);
              return cloneJsonValue(cached);
            }
          }
          break;
        } catch (err) {
          if (requestMethod === 'GET') {
            const cached = await getStaleCachedResponse(cacheKey);
            if (cached) {
              setMemoryCachedResponse(cacheKey, cached);
              return cloneJsonValue(cached);
            }
          }
          if (options && options.method && options.method !== 'GET') {
            if (window.warehouseOfflineQueue) {
              await window.warehouseOfflineQueue.addRequest(normalizedUrl, options, authHeaderValue, accessToken);
              return { success: true, offline: true, message: 'Oflayn saqlandi' };
            }
          }
          throw err;
        }
      }

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        if (requestMethod === 'GET' && response.status >= 500 && response.status <= 599) {
          const cached = await getStaleCachedResponse(cacheKey);
          if (cached) {
            setMemoryCachedResponse(cacheKey, cached);
            return cloneJsonValue(cached);
          }
        }
        throw new Error(data.error || `So'rov bajarilmadi (${response.status})`);
      }

      if (cacheKey) {
        setMemoryCachedResponse(cacheKey, data);
        if (window.warehouseOfflineQueue?.setCachedGet) {
          window.warehouseOfflineQueue.setCachedGet(cacheKey, data).catch(() => {});
        }
      }

      return data;
    };

    const execution = requestRunner();
    if (cacheKey) {
      inFlightGetRequests.set(cacheKey, execution);
    }
    try {
      return await execution;
    } finally {
      if (cacheKey) {
        inFlightGetRequests.delete(cacheKey);
      }
    }
  },

  /**
   * Number formatting utility (ru-RU style)
   */
  numberFormat(value) {
    return new Intl.NumberFormat('ru-RU').format(Number(value || 0));
  },

  escapeHtml,
};
