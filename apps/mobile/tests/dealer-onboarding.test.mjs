import assert from 'node:assert/strict';
import test from 'node:test';
import {ApiClient} from '../src/api.ts';
import {catalogueDocumentLabel, registerDealer, submitWorkers, targetedCatalogues, workerProgress} from '../src/dealer-onboarding.ts';

const base = 'http://127.0.0.1:8000/api/v1';
const json = value => Response.json(value);
const workers = Array.from({length: 10}, (_, index) => ({
  name: 'Worker ' + index, mobile: '980000001' + index, trade: 'Electrician',
}));

test('registration normalizes firm and GSTIN and rejects invalid form inputs before sending', async () => {
  let calls = 0;
  const api = new ApiClient(base, async (url, init) => {
    calls++;
    assert.equal(url, base + '/auth/dealer/register/');
    assert.deepEqual(JSON.parse(init.body), {firm_name: 'Fixture Electrical', gstin: '36AABCV5678B1ZV',
      mobile_number: '+919800000071', business_type: 'ELECTRICAL'});
    return json({account: {id: 7}});
  });
  await assert.rejects(registerDealer(api, 'Fixture', 'invalid', '+919800000071', 'ELECTRICAL'), /GSTIN/);
  await assert.rejects(registerDealer(api, ' ', '36AABCV5678B1ZV', '+919800000071', 'ELECTRICAL'), /firm name/);
  await assert.rejects(registerDealer(api, 'Fixture', '36AABCV5678B1ZV', '+91123', 'ELECTRICAL'), /mobile/);
  await registerDealer(api, ' Fixture Electrical ', '36aabcv5678b1zv', '+919800000071', 'ELECTRICAL');
  assert.equal(calls, 1);
});

test('worker progress counts only valid unique entries and requires consent before the atomic request', async () => {
  let calls = 0;
  const api = new ApiClient(base, async (url, init) => {
    calls++;
    assert.equal(url, base + '/dealers/contacts/batch/');
    assert.equal(init.headers.Authorization, 'Bearer test-session');
    const {contacts} = JSON.parse(init.body);
    assert.equal(contacts.length, 10);
    assert.deepEqual(contacts[0], {name: 'Worker 0', trade: 'Electrician', mobile_e164: '+919800000010', location: '', consent: true});
    return json({count: 10});
  });
  const duplicate = [...workers.slice(0, 9), workers[0]];
  assert.equal(workerProgress(duplicate), 9);
  assert.equal(workerProgress([{...workers[0], trade: ''}]), 0);
  await assert.rejects(submitWorkers(api, 'test-session', duplicate, true), /distinct/);
  await assert.rejects(submitWorkers(api, 'test-session', workers.slice(1), true), /ten/);
  await assert.rejects(submitWorkers(api, 'test-session', workers, false), /consent/);
  await submitWorkers(api, 'test-session', workers, true);
  assert.equal(calls, 1);
});

test('targeted catalogue data and card labels are projected from the filtered API response', async () => {
  const key = '27818f24-06d1-4cb7-965a-4f011be14638';
  const row = {key, business_type: 'PLUMBING', is_active: true, title: 'Trade catalogue',
    brand_name: 'Example brand', content_type: 'application/pdf', file_size_bytes: 2_400_000,
    created_at: '2026-11-10T12:00:00Z', download_url: '/api/v1/catalogues/' + key + '/file/'};
  let result = row;
  const api = new ApiClient(base, async (url, init) => {
    assert.equal(url, base + '/catalogues/?page=2&business_type=PLUMBING');
    assert.equal(init.headers.Authorization, 'Bearer test-session');
    return json({count: 1, next: null, previous: '/prior', results: [result]});
  });
  const page = await targetedCatalogues(api, 'test-session', 'PLUMBING', 2);
  assert.equal(page.results[0].url, 'http://127.0.0.1:8000' + row.download_url);
  assert.equal(catalogueDocumentLabel(page.results[0]), 'PDF • 2.4 MB');
  result = {...row, business_type: 'HARDWARE'};
  await assert.rejects(targetedCatalogues(api, 'test-session', 'PLUMBING', 2), /catalogue document/);
  result = {...row, download_url: 'https://example.invalid' + row.download_url};
  await assert.rejects(targetedCatalogues(api, 'test-session', 'PLUMBING', 2), /configured API/);
});
