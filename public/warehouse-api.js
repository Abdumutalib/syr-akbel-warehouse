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
    try {
      response = await fetch(normalizedUrl, {
        ...options,
        headers: requestHeaders,
      });
    } catch (err) {
      if (options && options.method && options.method !== 'GET') {
        if (window.warehouseOfflineQueue) {
          await window.warehouseOfflineQueue.addRequest(normalizedUrl, options, authHeaderValue, accessToken);
          return { success: true, offline: true, message: 'Oflayn saqlandi' };
        }
      }
      throw err;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || 'So\'rov bajarilmadi');
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
