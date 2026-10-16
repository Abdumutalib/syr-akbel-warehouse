import crypto from 'node:crypto';

// Process-local signing key: a restart requires a fresh login, never a shared static cookie.
export function createWarehouseSessions({ ttlMs = 8 * 60 * 60 * 1000, now = Date.now } = {}) {
  const secret = crypto.randomBytes(32);
  const sign = (value) => crypto.createHmac('sha256', secret).update(value).digest();
  return {
    issue(kind, subject, version) {
      const body = Buffer.from(JSON.stringify({ kind, subject, version, expires: now() + ttlMs, nonce: crypto.randomBytes(16).toString('hex') })).toString('base64url');
      return `${body}.${sign(body).toString('base64url')}`;
    },
    read(value, kind) {
      try {
        const [body, signature, extra] = String(value || '').split('.');
        if (!body || !signature || extra || body.length > 4096) return null;
        const actual = Buffer.from(signature, 'base64url');
        const expected = sign(body);
        if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
        const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        return payload.kind === kind && Number.isFinite(payload.expires) && payload.expires > now() ? payload : null;
      } catch { return null; }
    },
  };
}
