import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAllowedOrigins, getAllowedOriginHeaderValue } from '../lib/deployment-config.mjs';

test('resolveAllowedOrigins parses comma separated values and keeps localhost defaults', () => {
  const origins = resolveAllowedOrigins('https://example.com, http://localhost:8787');
  assert.deepEqual(origins, ['https://example.com', 'http://localhost:8787']);
});

test('getAllowedOriginHeaderValue echoes a configured origin and falls back to localhost', () => {
  assert.equal(getAllowedOriginHeaderValue('https://example.com', 'https://example.com'), 'https://example.com');
  assert.equal(getAllowedOriginHeaderValue('https://example.com', ''), 'https://example.com');
  assert.equal(getAllowedOriginHeaderValue('https://example.com', 'https://other.com'), null);
});
