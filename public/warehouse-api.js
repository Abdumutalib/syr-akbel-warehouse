/**
 * Warehouse API and utilities
 */

window.warehouseApi = {
  /**
   * Centralized apiFetch logic
   */
  async fetch(url, options = {}, authHeaderValue = '', accessToken = '') {
    const normalizedUrl = typeof url === 'string' && url.startsWith('/api/warehouse')
      ? `/warehouse/api${url.slice('/api'.length)}`
      : url;

    const requestHeaders = new Headers(options.headers || {});

    if (authHeaderValue && !requestHeaders.has('Authorization')) {
      requestHeaders.set('Authorization', authHeaderValue);
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

    while (retries <= maxRetries) {
      try {
        response = await performFetch();
        
        // Retry on 5xx errors if we have an idempotency key
        if (response.status >= 500 && response.status <= 599 && requestHeaders.has('Idempotency-Key') && retries < maxRetries) {
          retries++;
          await new Promise(r => setTimeout(r, 1000 * retries)); // Exponential-ish backoff
          continue;
        }
        break;
      } catch (err) {
        if (options && options.method && options.method !== 'GET') {
          if (window.warehouseOfflineQueue) {
            await window.warehouseOfflineQueue.addRequest(normalizedUrl, options, authHeaderValue, accessToken);
            return { success: true, offline: true, message: 'Oflayn saqlandi' };
          }
        }
        throw err;
      }
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || `So'rov bajarilmadi (${response.status})`);
    }

    return data;
  },

  /**
   * Number formatting utility (ru-RU style)
   */
  numberFormat(value) {
    return new Intl.NumberFormat('ru-RU').format(Number(value || 0));
  }
};
