import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient } from '../src/api.ts';
import { blankBranch, blankInventory, validateBranch, validateInventory, canChooseProduct, business, ownedPage, saveBranch, saveBusiness, saveListing, withdrawListing, reactivateListing } from '../src/dealer.ts';
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const branch = { ...blankBranch(), branch_name: 'Branch', address: 'Street', pin_code: '12345', locality: 'Area', district: 'District', state: 'State', country: 'in' };
const inventory = { ...blankInventory(), selling_price: '12.5000', currency: 'INR', stock_status: 'IN_STOCK', quantity: '2' };

test('branch form validates required location and private contact fields without guessing country', () => {
  assert.ok(validateBranch(blankBranch()).length);
  assert.deepEqual(validateBranch(branch), []);
  assert.ok(validateBranch({ ...branch, country: 'IND' }).length);
  assert.ok(validateBranch({ ...branch, contact_phone: 'invalid' }).length);
  assert.ok(validateBranch({ ...branch, contact_email: 'invalid' }).length);
});
test('branch create and edit send owner-write fields only and preserve deactivation history', async () => {
  const calls = [];
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => { calls.push([url, init]); return json({ id: 4 }); });
  await saveBranch(api, 'test-token', { ...branch, admin_hidden: false, business: 999 });
  await saveBranch(api, 'test-token', { ...branch, active: false }, 4);
  assert.equal(calls[0][1].method, 'POST'); assert.ok(calls[0][0].endsWith('/locations'));
  assert.equal(calls[1][1].method, 'PATCH'); assert.ok(calls[1][0].endsWith('/locations/4'));
  const body = JSON.parse(calls[0][1].body); assert.equal(body.business, undefined); assert.equal(body.admin_hidden, undefined); assert.equal(body.country, 'IN');
  assert.equal(JSON.parse(calls[1][1].body).active, false);
});
test('business form never submits verification or authorization fields', async () => {
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => { assert.deepEqual(JSON.parse(init.body), { legal_name: 'Dealer', registration_number: 'REG' }); return json({ id: 1 }); });
  await saveBusiness(api, 'token', 'Dealer', 'REG');
  await assert.rejects(saveBusiness(api, 'token', 'x'.repeat(201), ''), /Business name/);
});
test('inventory enforces explicit currency, decimal precision and stock quantity agreement', () => {
  assert.deepEqual(validateInventory(inventory), []);
  for (const change of [{ selling_price: '-1' }, { selling_price: '1.23456' }, { selling_price: '1e2' }, { currency: '' }, { currency: 'usd' }, { stock_status: 'UNKNOWN', quantity: '1' }, { stock_status: 'OUT_OF_STOCK', quantity: '1' }, { quantity: '0' }]) assert.ok(validateInventory({ ...inventory, ...change }).length);
  assert.deepEqual(validateInventory({ ...inventory, quantity: '' }), []);
});
test('authorization matching uses canonical company and brand IDs, never names', () => {
  const product = { brand_id: 2, company_id: 3 };
  assert.equal(canChooseProduct(product, [{ eligible: true, brand: 2, company: 3 }]), true);
  assert.equal(canChooseProduct(product, [{ eligible: false, brand: 2, company: 3 }]), false);
  assert.equal(canChooseProduct(product, [{ eligible: true, brand: 2, company: 4 }]), false);
  assert.equal(canChooseProduct({ brand_name: 'Same name' }, [{ eligible: true, brand: 2, company: 3 }]), false);
});
test('listing creation references canonical branch/product/variant; edits cannot move identity', async () => {
  const calls = [];
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => { calls.push([url, init]); return json({ id: 7, state: JSON.parse(init.body).state }); });
  await saveListing(api, 'token', inventory, { location: 1, product: 2, variant: 3 });
  await saveListing(api, 'token', { ...inventory, selling_price: '20' }, { location: 999, product: 999, variant: null }, 7);
  assert.equal(JSON.parse(calls[0][1].body).variant, 3);
  const update = JSON.parse(calls[1][1].body); assert.equal(update.location, undefined); assert.equal(update.product, undefined); assert.equal(update.variant, undefined);
  await withdrawListing(api, 'token', 7);
  assert.deepEqual(JSON.parse(calls[2][1].body), { state: 'WITHDRAWN' });
});
test('owner lists paginate locally and never follow arbitrary next URLs', async () => {
  const api = new ApiClient('http://example.test/api/v1', async url => { assert.equal(url, 'http://example.test/api/v1/businesses/me/locations?page=2'); return json({ count: 30, next: 'https://untrusted.test/next', previous: 'previous', results: [] }); });
  assert.equal((await ownedPage(api, 'token', 'locations', 2)).count, 30);
  await assert.rejects(ownedPage(api, 'token', 'locations', 0), /Invalid page/);
});
test('real permission errors and malformed success never become successful saves', async () => {
  const api = new ApiClient('http://example.test/api/v1', async () => json({ message: 'Explicit company authorization required' }, 403));
  await assert.rejects(saveListing(api, 'token', inventory, { location: 1, product: 2, variant: null }), error => error.status === 403 && /authorization/.test(error.message));
  api.transport = async () => json({});
  await assert.rejects(saveBranch(api, 'token', branch), /confirmed/);
  await assert.rejects(business(api, 'token'), /incomplete/);
});

test('reactivation and withdrawal use state-only writes and require confirmed server states',async()=>{
 const calls=[];const api=new ApiClient('http://example.test/api/v1',async(url,init)=>{calls.push([url,init]);return json({id:7,state:JSON.parse(init.body).state});});
 await reactivateListing(api,'token',7);assert.deepEqual(JSON.parse(calls[0][1].body),{state:'PUBLISHED'});assert.ok(calls[0][0].endsWith('/listings/7'));
 api.transport=async()=>json({id:7,state:'WITHDRAWN'});await assert.rejects(reactivateListing(api,'token',7),/could not be confirmed/);
 api.transport=async()=>json({id:7,state:'PUBLISHED'});await assert.rejects(withdrawListing(api,'token',7),/could not be confirmed/);
 api.transport=async()=>json({message:'Explicit company authorization required'},403);await assert.rejects(reactivateListing(api,'token',7),error=>error.status===403);
});
test('owner inventory search and state filters are encoded into local pagination paths',async()=>{
 const api=new ApiClient('http://example.test/api/v1',async url=>{assert.equal(url,'http://example.test/api/v1/businesses/me/listings?page=2&search=SKU+%26+branch&state=WITHDRAWN');return json({count:0,results:[],next:null,previous:null});});await ownedPage(api,'token','listings',2,undefined,{search:'SKU & branch',state:'WITHDRAWN'});
});
