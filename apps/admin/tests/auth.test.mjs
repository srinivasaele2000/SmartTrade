import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { developmentAvailable, developmentOtpAvailable, otpAcknowledgementMessage, loadStaffSession } from '../src/auth.ts';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('development OTP discovery is local-only and responses clearly label simulation', async () => {
  globalThis.fetch = async () => { throw new Error('Must not request'); };
  assert.equal(await developmentOtpAvailable('/api/v1', false, 'localhost'), false);
  assert.equal(await developmentOtpAvailable('/api/v1', true, 'foreign.example'), false);
  globalThis.fetch = async url => {
    assert.equal(url, '/api/v1/auth/otp/request');
    return json({ enabled: true });
  };
  assert.equal(await developmentOtpAvailable('/api/v1', true, '127.0.0.1'), true);
  assert.match(otpAcknowledgementMessage({ status: 'accepted', authentication_mode: 'development_otp' }), /no SMS.*non-empty.*unverified/);
  assert.match(otpAcknowledgementMessage({ status: 'accepted' }), /configured provider/);
  globalThis.fetch = async () => json({}, 404);
  assert.equal(await developmentOtpAvailable('/api/v1', true, 'localhost'), false);
});

test('production and non-local browser never probe development authentication', async () => {
  globalThis.fetch = async () => { throw new Error('Must not request'); };
  assert.equal(await developmentAvailable('/api/v1', false, 'localhost'), false);
  assert.equal(await developmentAvailable('/api/v1', true, 'public.example'), false);
});

test('development option requires explicit server capability', async () => {
  globalThis.fetch = async url => { assert.equal(url, '/api/v1/auth/dev-login'); return json({ enabled: true }); };
  assert.equal(await developmentAvailable('/api/v1', true, '127.0.0.1'), true);
  for (const status of [403, 404, 503]) {
    globalThis.fetch = async () => json({}, status);
    assert.equal(await developmentAvailable('/api/v1', true, 'localhost'), false);
  }
});

test('session loads real staff profile without inventing privileges', async () => {
  const account = { id: 1, account_type: 'STAFF', staff_profile: { state: 'ACTIVE', roles: [], permissions: [] } };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, '/api/v1/auth/me');
    assert.equal(init.headers.Authorization, 'Bearer isolated-access');
    return json({ account });
  };
  const session = await loadStaffSession('/api/v1', { access: 'isolated-access', refresh: 'isolated-refresh', expires_in: 300 });
  assert.deepEqual(session.account, account);
  assert.equal(session.refreshDelay, 270000);
});

test('invalid tokens, inactive staff and nonstaff never establish a session', async () => {
  await assert.rejects(loadStaffSession('/api/v1', { access: '', refresh: '', expires_in: 0 }), /Invalid/);
  for (const account of [{ account_type: 'COMPANY' }, { account_type: 'STAFF', staff_profile: { state: 'DISABLED' } }]) {
    globalThis.fetch = async () => json({ account });
    await assert.rejects(loadStaffSession('/api/v1', { access: 'isolated-access', refresh: 'isolated-refresh', expires_in: 300 }), /active staff/);
  }
});
