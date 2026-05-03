const ipRequestMap = new Map(); // ip -> { count, firstRequestTime, blockedUntil, failedAttempts }

const RATE_LIMIT = {
  WINDOW_MS: 60 * 1000,               // 1 daqiqa
  MAX_REQUESTS: 300,                   // daqiqada 300 ta so'rov
  BRUTE_FORCE_ATTEMPTS: 10,            // 10 marta xato login
  BRUTE_FORCE_BLOCK_MS: 15 * 60 * 1000, // 15 daqiqa blok
};

export function rateLimiter(req, res) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0].trim() || req.socket.remoteAddress;
  const now = Date.now();
  const record = ipRequestMap.get(ip);

  if (record?.blockedUntil && now < record.blockedUntil) {
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Too many failed attempts. Try again later.');
    return true;
  }

  if (!record) {
    ipRequestMap.set(ip, { count: 1, firstRequestTime: now, failedAttempts: 0, blockedUntil: null });
    return false;
  }

  if (now - record.firstRequestTime > RATE_LIMIT.WINDOW_MS) {
    ipRequestMap.set(ip, { count: 1, firstRequestTime: now, failedAttempts: record.failedAttempts, blockedUntil: null });
    return false;
  }

  record.count++;
  if (record.count > RATE_LIMIT.MAX_REQUESTS) {
    res.writeHead(429, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Rate limit exceeded');
    return true;
  }
  return false;
}

export function recordFailedAuth(ip) {
  const record = ipRequestMap.get(ip);
  if (!record) {
    ipRequestMap.set(ip, { count: 0, firstRequestTime: Date.now(), failedAttempts: 1, blockedUntil: null });
    return;
  }
  record.failedAttempts = (record.failedAttempts || 0) + 1;
  if (record.failedAttempts >= RATE_LIMIT.BRUTE_FORCE_ATTEMPTS) {
    record.blockedUntil = Date.now() + RATE_LIMIT.BRUTE_FORCE_BLOCK_MS;
    console.warn(`[SECURITY] IP ${ip} bloklandi (${RATE_LIMIT.BRUTE_FORCE_ATTEMPTS} marta xato login).`);
  }
}

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS faqat HTTPS da ishlaydi, HTTP da e'tiborga olinmaydi
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
