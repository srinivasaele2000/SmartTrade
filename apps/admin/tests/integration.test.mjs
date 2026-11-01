import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { pages, pageFromHash } from '../src/navigation.ts';
import { ApiError, apiResponse, ensureList, onSessionExpired, requestApi } from '../src/api.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

test('all six sidebar links resolve to distinct page identities', () => {
  assert.deepEqual(pages.map(item => item.id), ['overview', 'verification', 'review-requests', 'catalogue', 'dealers', 'audit']);
  for (const page of pages) assert.equal(pageFromHash(`#${page.id}`), page.id);
  assert.equal(pageFromHash(''), 'overview');
  assert.equal(pageFromHash('#missing'), 'overview');
});
test('JSON requests retain exact base/path, method and bearer header', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/v1/staff/catalogue/products/7/moderation');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers.Authorization, 'Bearer isolated-test-token');
    assert.deepEqual(JSON.parse(init.body), { action: 'HIDE', reason: 'Review' });
    return json({ moderation_state: 'HIDDEN' });
  };
  const result = await requestApi('/api/v1', '/staff/catalogue/products/7/moderation', 'isolated-test-token', { method: 'POST', body: JSON.stringify({ action: 'HIDE', reason: 'Review' }) });
  assert.equal(result.moderation_state, 'HIDDEN');
});
test('field validation explains invalid E.164 input instead of hiding field errors', async () => {
  globalThis.fetch = async () => json({ message: 'Request validation failed.', field_errors: { mobile_e164: ['Use a complete E.164 mobile number.'] } }, 400);
  await assert.rejects(requestApi('/api/v1', '/auth/otp/request'), error => error.status === 400 && /mobile_e164.*E.164/.test(error.message));
});
test('missing real provider remains an explicit 503 failure', async () => {
  globalThis.fetch = async () => json({ code: 'AUTH_PROVIDER_UNAVAILABLE', message: 'Phone verification is not configured for this environment.' }, 503);
  await assert.rejects(requestApi('/api/v1', '/auth/otp/request'), /not configured/);
});
test('401 on any authenticated endpoint invalidates only the corresponding session', async () => {
  const expired = [];
  const unsubscribe = onSessionExpired(token => expired.push(token));
  try {
    globalThis.fetch = async () => json({ message: 'Invalid token.' }, 401);
    for (const path of ['/staff/companies/verification-queue', '/staff/companies/review-requests', '/staff/catalogue/products', '/staff/dealers/businesses']) {
      await assert.rejects(requestApi('/api/v1', path, 'isolated-test-token'), ApiError);
    }
    assert.deepEqual(expired, Array(4).fill('isolated-test-token'));
    await assert.rejects(requestApi('/api/v1', '/auth/login'), ApiError);
    assert.equal(expired.length, 4);
  } finally { unsubscribe(); }
});
test('permission denied is a 403 failure and does not log out another valid workflow', async () => {
  let expired = false;
  const unsubscribe = onSessionExpired(() => { expired = true; });
  try {
    globalThis.fetch = async () => json({ detail: 'Missing required permission.' }, 403);
    await assert.rejects(requestApi('/api/v1', '/staff/dealers/businesses', 'isolated-test-token'), error => error.status === 403);
    assert.equal(expired, false);
  } finally { unsubscribe(); }
});
test('failed or HTML responses cannot be reported as successful actions', async () => {
  globalThis.fetch = async () => new Response('<html>Proxy error</html>', { status: 502 });
  await assert.rejects(requestApi('/api/v1', '/staff/dealers/locations/1/moderation'), error => error.status === 502);
  globalThis.fetch = async () => new Response('<html>Wrong server</html>');
  await assert.rejects(requestApi('/api/v1', '/staff/catalogue/categories'), /could not be confirmed/);
});
test('empty, invalid and paginated lists remain distinguishable', () => {
  assert.doesNotThrow(() => ensureList({ results: [] }));
  assert.doesNotThrow(() => ensureList({ results: [], count: 0 }, true));
  assert.throws(() => ensureList({}, true));
  assert.throws(() => ensureList({ results: [], count: '0' }, true));
});
test('network failure is an error rather than empty data', async () => {
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(requestApi('/api/v1', '/health'), /Cannot reach/);
});
test('authorized downloads return the actual file response and logout handles 204', async () => {
  globalThis.fetch = async () => new Response('document', { headers: { 'Content-Type': 'application/pdf' } });
  const response = await apiResponse('/api/v1', '/staff/companies/1/documents/2', 'isolated-test-token');
  assert.equal(await response.text(), 'document');
  globalThis.fetch = async () => new Response(null, { status: 204 });
  assert.equal(await requestApi('/api/v1', '/auth/logout', 'isolated-test-token', { method: 'POST' }), undefined);
});
