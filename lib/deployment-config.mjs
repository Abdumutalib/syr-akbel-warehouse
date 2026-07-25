function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

export function resolveAllowedOrigins(rawValue = '') {
  const values = String(rawValue || '')
    .split(',')
    .map((item) => normalizeOrigin(item))
    .filter(Boolean);

  if (values.length > 0) {
    return values;
  }

  return ['http://127.0.0.1:8787', 'http://localhost:8787'];
}

export function getAllowedOriginHeaderValue(requestOrigin, configuredOrigin) {
  const hasConfiguredOrigins = String(configuredOrigin || '').trim().length > 0;
  const configuredOrigins = resolveAllowedOrigins(configuredOrigin);
  const request = normalizeOrigin(requestOrigin);

  // If no explicit allowlist is configured, echo the request origin for broad compatibility.
  if (!hasConfiguredOrigins) {
    return request || null;
  }

  if (!request) {
    return configuredOrigins[0] || null;
  }

  if (configuredOrigins.includes(request)) {
    return request;
  }

  const requestHost = request.replace(/^https?:\/\//, '');
  const configuredHosts = configuredOrigins.map((origin) => origin.replace(/^https?:\/\//, ''));
  if (configuredHosts.includes(requestHost)) {
    return request;
  }

  return null;
}
