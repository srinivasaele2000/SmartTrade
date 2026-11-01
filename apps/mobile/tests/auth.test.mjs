import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api.ts';
import { mobileValid, register, requestOtp, login, account, tokens } from '../src/auth.ts';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const issued = { access: 'isolated-access', refresh: 'isolated-refresh', expires_in: 300 };

test('registration accepts only marketplace account types and canonical mobile format', async () => {
  const calls = [];
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => { calls.push([url, JSON.parse(init.body)]); return json({ account: {} }, 201); });
  assert.equal(mobileValid('invalid'), false);
  for (const type of ['PERSONAL', 'BUSINESS', 'COMPANY']) await register(api, '+12025550101', type);
  assert.deepEqual(calls.map(call => call[1].account_type), ['PERSONAL', 'BUSINESS', 'COMPANY']);
  assert.ok(calls.every(call => call[0].endsWith('/auth/register')));
  await assert.rejects(register(api, '+12025550101', 'STAFF'), /Choose/);
  await assert.rejects(register(api, 'invalid', 'PERSONAL'), /E.164/);
  assert.equal(calls.length, 3);
});
test('OTP acknowledgement distinguishes no-SMS development from configured provider', async () => {
  const api = new ApiClient('http://example.test/api/v1', async () => json({ status: 'accepted', authentication_mode: 'development_otp' }, 202));
  assert.match(await requestOtp(api, '+12025550101'), /no SMS.*unverified/);
  api.transport = async () => json({ status: 'accepted' }, 202);
  assert.match(await requestOtp(api, '+12025550101'), /provider/);
});
test('login sends a nonempty code only to the existing login endpoint', async () => {
  let calls = 0;
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => {
    calls++; assert.ok(url.endsWith('/auth/login')); assert.equal(init.method, 'POST');
    assert.equal(JSON.parse(init.body).code, 'arbitrary');
    return json(issued);
  });
  assert.deepEqual(await login(api, '+12025550101', 'arbitrary'), issued);
  await assert.rejects(login(api, '+12025550101', '   '), /non-empty/);
  assert.equal(calls, 1);
});
test('field errors, blocked accounts and provider failures are surfaced', async () => {
  for (const status of [400, 401, 403, 503]) {
    const api = new ApiClient('http://example.test/api/v1', async () => json({ message: 'Request refused', field_errors: { account_type: ['Not allowed'] } }, status));
    await assert.rejects(login(api, '+12025550101', 'code'), error => error.status === status && /Request refused.*Not allowed/.test(error.message));
  }
});
test('session validates actual active profile, never inferred permissions', async () => {
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => {
    assert.ok(url.endsWith('/auth/me')); assert.equal(init.headers.Authorization, 'Bearer isolated-access');
    return json({ account: { id: 1, account_type: 'PERSONAL', access_state: 'ACTIVE', mobile_verified: false } });
  });
  assert.equal((await account(api, issued.access)).mobile_verified, false);
  api.transport = async () => json({ account: { account_type: 'PERSONAL', access_state: 'BLOCKED' } });
  await assert.rejects(account(api, issued.access), /cannot start/);
  assert.throws(() => tokens({ access: '', refresh: '', expires_in: 0 }), /Invalid/);
});
test('refresh and logout use protected endpoint conventions without token persistence', async () => {
  const calls = [];
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => { calls.push([url, init]); return url.endsWith('/logout') ? new Response(null, { status: 204 }) : json({ access: 'new-access' }); });
  assert.equal((await api.post('/auth/refresh', { refresh: issued.refresh })).access, 'new-access');
  assert.equal(await api.post('/auth/logout', {}, issued.access), undefined);
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(calls[1][1].headers.Authorization, 'Bearer isolated-access');
});
