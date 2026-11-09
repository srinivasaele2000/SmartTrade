import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api.ts';
import { blankProfile, validateProfile, saveProfile, loadCompany, statusLabel, confirmReply, emailStatus, submissionGuidance } from '../src/company.ts';

const policy = { configured: true, required_types: ['REGISTRATION'], max_bytes: 2048, allowed_mime_types: ['application/pdf'] };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status });

test('profile validation follows required name/email and declared lengths', () => {
  const form = blankProfile(); assert.equal(validateProfile(form).length, 2);
  form.legal_name = 'Company'; form.company_email = 'company@example.test';
  assert.deepEqual(validateProfile(form), []);
  form.website = 'invalid'; assert.match(validateProfile(form).join(), /http/);
  form.legal_name = 'x'.repeat(201); assert.match(validateProfile(form).join(), /too long/);
});
test('create and patch use only supported profile fields and authenticated existing routes', async () => {
  const calls = [];
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => { calls.push([url, init]); return json({ company: { id: 1 } }); });
  const form = { ...blankProfile(), legal_name: ' Company ', company_email: 'test@example.test', verification_state: 'VERIFIED' };
  await saveProfile(api, 'isolated-token', form, true);
  await saveProfile(api, 'isolated-token', form, false);
  assert.ok(calls[0][0].endsWith('/companies/register')); assert.equal(calls[0][1].method, 'POST');
  assert.ok(calls[1][0].endsWith('/companies/me')); assert.equal(calls[1][1].method, 'PATCH');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer isolated-token');
  assert.equal(JSON.parse(calls[0][1].body).verification_state, undefined);
});
test('missing company is distinct from denied access or a malformed status contract', async () => {
  const api = new ApiClient('http://example.test/api/v1', async () => json({ code: 'COMPANY_NOT_REGISTERED', message: 'Register first' }, 404));
  assert.equal(await loadCompany(api, 'token'), null);
  api.transport = async () => json({ message: 'Forbidden' }, 403);
  await assert.rejects(loadCompany(api, 'token'), error => error.status === 403);
  api.transport = async () => json({ company: {} });
  await assert.rejects(loadCompany(api, 'token'), /incomplete/);
});
test('suspension and verification are independent displayed states', () => {
  assert.equal(statusLabel({ activity_state: 'SUSPENDED', verification_state: 'VERIFIED' }), 'Suspended');
  assert.equal(statusLabel({ activity_state: 'ACTIVE', verification_state: 'VERIFIED' }), 'Approved / verified');
  assert.equal(statusLabel({ activity_state: 'ACTIVE', verification_state: 'REJECTED' }), 'Rejected');
  assert.equal(statusLabel({ activity_state: 'ACTIVE', verification_state: 'PENDING' }), 'Pending verification');
});
test('submission and email failure responses preserve actionable server errors', async () => {
  const api = new ApiClient('http://example.test/api/v1', async () => json({ code: 'EMAIL_PROVIDER_UNAVAILABLE', message: 'Company email verification is not configured.' }, 503));
  await assert.rejects(api.post('/companies/me/email-verification/request', {}, 'token'), error => error.code === 'EMAIL_PROVIDER_UNAVAILABLE' && error.status === 503);
  api.transport = async () => json({ code: 'VERIFICATION_ALREADY_PENDING', message: 'Already pending' }, 409);
  await assert.rejects(api.post('/companies/me/verification-submissions', {}, 'token'), error => error.status === 409);
});

test('malformed action success cannot be displayed as confirmed submission', () => {
  assert.throws(() => confirmReply({}, { case_id: 'number', status: 'string' }), /Refresh/);
  assert.doesNotThrow(() => confirmReply({ case_id: 1, status: 'PENDING' }, { case_id: 'number', status: 'string' }));
});


test('email labels never confuse local evidence with real ownership', () => {
  const context = { company: { email_verified_at: null }, verification: { email_ready: false } };
  assert.equal(emailStatus(context), 'Not verified');
  context.verification.email_ready = true;
  assert.equal(emailStatus(context), 'Locally simulated; ownership unverified');
  context.company.email_verified_at = '2026-11-01T00:00:00Z';
  assert.equal(emailStatus(context), 'Verified by provider');
});

test('company context preserves backend simulation, edit and submission capabilities', async () => {
  const verification = { email_verification_mode: 'development_email', email_ready: true, can_verify_email: true, can_submit: false, documents: [], document_policy: policy };
  const api = new ApiClient('http://example.test/api/v1', async () => json({ company: { id: 9 }, verification }));
  const context = await loadCompany(api, 'isolated-token');
  assert.equal(context.verification.email_ready, true);
  assert.equal(context.verification.can_submit, false);
  assert.equal(context.verification.email_verification_mode, 'development_email');
});

test('application guidance distinguishes pending, approved, rejected and suspended states',()=>{
 const context={company:{activity_state:'ACTIVE',verification_state:'PENDING'},verification:{application:null}};
 assert.match(submissionGuidance(context),/all configured required documents/);
 context.verification.application={status:'PENDING'};assert.match(submissionGuidance(context),/already submitted/);
 context.verification.application.status='APPROVED';assert.match(submissionGuidance(context),/No further submission/);
 context.company.verification_state='REJECTED';assert.match(submissionGuidance(context),/resubmission is not automatically/);
 context.company.activity_state='SUSPENDED';assert.match(submissionGuidance(context),/suspended/);
});
