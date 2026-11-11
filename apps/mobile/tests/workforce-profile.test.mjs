import assert from 'node:assert/strict';
import test from 'node:test';
import {account, registerRole, registrationRoles} from '../src/auth.ts';
import {profileInput, saveWorkforceProfile} from '../src/workforce-profile.ts';

test('registration sends canonical PRD roles and never permits public staff signup', async () => {
  const calls = [];
  const api = {post: async (path, body) => calls.push([path, body])};
  for (const type of Object.keys(registrationRoles)) await registerRole(api, '+919800000001', type);
  await assert.rejects(registerRole(api, '+919800000001', 'STAFF'), /account type/);
  assert.deepEqual(calls.map(([path, body]) => [path, body.role]), [
    ...Object.values(registrationRoles).map(role => ['/auth/register', role]),
  ]);
});

test('private profile updates send only backend-supported fields and validate Indian PIN and numeric experience', async () => {
  const draft = {full_name: ' Fixture seeker ', skills: 'Wiring', experience: '0', preferred_location: 'Pune', pin_code: '411001', role: 'STAFF'};
  assert.throws(() => profileInput('JOB_SEEKER', {...draft, pin_code: '123'}), /PIN code/);
  assert.throws(() => profileInput('JOB_SEEKER', {...draft, experience: 'a year'}), /whole number/);
  await saveWorkforceProfile({get: async (path, _signal, token, init) => {
    assert.equal(path, '/auth/job-seeker-profile');
    assert.equal(token, 'test-access');
    assert.equal(init.method, 'PATCH');
    assert.deepEqual(JSON.parse(init.body), {...Object.fromEntries(Object.entries(draft).filter(([key]) => key !== 'role')), full_name: 'Fixture seeker'});
  }}, 'JOB_SEEKER', 'test-access', draft);
});

test('session revalidation accepts the new roles and continues rejecting blocked identities', async () => {
  for (const type of ['SERVICE_PROVIDER', 'JOB_SEEKER', 'EMPLOYER']) {
    const profile = {id: 1, account_type: type, access_state: 'ACTIVE'};
    const api = {get: async () => ({account: profile})};
    assert.equal((await account(api, 'test-access')).account_type, type);
    profile.access_state = 'BLOCKED';
    await assert.rejects(account(api, 'test-access'), /cannot start a session/);
  }
});
