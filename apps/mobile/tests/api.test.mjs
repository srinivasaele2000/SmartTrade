import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError, mapProduct, mapListing, query } from '../src/api.ts';
import { resourceReducer, inventoryLabel, matchLabel, variantListings } from '../src/resource.ts';

// Contract fixtures are used only by isolated tests, never as application fallback data.
const product = { id: 10, name: 'Tool', code: 'T1', brand_name: 'Brand', company_name: 'Company', category_name: 'Tools', description: '', specifications: {}, unit: 'piece', catalogue_price: '10.0000', currency: 'USD', variants: [{ id: 7, product: 10, sku: 'RED', name: 'Red', attributes: {}, active: true }] };
const listing = { id: 1, business_id: 3, business_name: 'Dealer', location: 9, product: 10, product_name: 'Tool', variant: 7, selling_price: '12.5000', currency: 'INR', stock_status: 'IN_STOCK', quantity: '2.0000', branch: { id: 9, branch_name: 'Central', address: 'Street', pin_code: '12345', locality: 'CENTRAL', district: 'DISTRICT', state: 'STATE', country: 'IN', contact_phone: 'private' } };
const page = results => ({ count: results.length, next: null, previous: null, results });
const response = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });

test('maps actual product fields, decimal strings and active variants', () => {
  const mapped = mapProduct({ ...product, variants: [...product.variants, { ...product.variants[0], id: 8, active: false }] });
  assert.equal(mapped.catalogue_price, '10.0000');
  assert.equal(mapped.variants.length, 1);
  assert.equal(mapped.variants[0].sku, 'RED');
  assert.throws(() => mapProduct({ ...product, variants: null }), ApiError);
});
test('projects public branches without private contacts and preserves dealer currency', () => {
  const mapped = mapListing(listing);
  assert.equal(mapped.currency, 'INR');
  assert.equal(mapped.selling_price, '12.5000');
  assert.equal(mapped.branch.contact_phone, undefined);
  assert.equal(inventoryLabel(mapped), 'In stock · quantity 2.0000');
  assert.equal(inventoryLabel({ ...mapped, stock_status: 'OUT_OF_STOCK', quantity: '0.0000' }), 'Out of stock');
  assert.equal(inventoryLabel({ ...mapped, stock_status: 'UNKNOWN', quantity: null }), 'Availability not confirmed');
});
test('builds supported trimmed filters and positive page numbers', () => {
  const params = new URLSearchParams(query({ search: ' tool & bolts ', brand: '4', category: undefined }, 2));
  assert.equal(params.get('search'), 'tool & bolts'); assert.equal(params.get('page'), '2');
  assert.equal(params.has('category'), false); assert.throws(() => query({}, 0), ApiError);
});
test('public catalogue uses no credentials, correct route and server page metadata', async () => {
  const calls = [];
  const api = new ApiClient('http://example.test/api/v1/', async (url, init) => { calls.push({ url, init }); return response({ ...page([product]), count: 30, next: 'http://untrusted.test/next' }); });
  const result = await api.products({ category: '2', brand: '3' }, 2);
  assert.match(calls[0].url, /\/catalogue\/products\?page=2&category=2&brand=3$/);
  assert.equal(calls[0].init.headers.Authorization, undefined); assert.equal(result.count, 30);
  await api.products({}, 3); assert.match(calls[1].url, /^http:\/\/example.test\/api\/v1\//);
});
test('categories and product details use actual endpoints', async () => {
  const api = new ApiClient('http://example.test/api/v1', async url => response(String(url).includes('/categories') ? page([{ id: 2, name: 'Tools', active: true }]) : product));
  assert.equal((await api.categories(1)).results[0].name, 'Tools'); assert.equal((await api.product(10)).id, 10);
});
test('missing session prevents all dealer network requests', async () => {
  let requests = 0;
  const api = new ApiClient('http://example.test/api/v1', async () => { requests++; return response({}); });
  await assert.rejects(api.dealers(10, {}, 1, null), error => error.status === 401);
  assert.equal(requests, 0);
});
test('dealer requests carry bearer auth and only supported product/location filters', async () => {
  let captured;
  const api = new ApiClient('http://example.test/api/v1', async (url, init) => { captured = { url, init }; return response({ ...page([listing]), match_level: 'DISTRICT' }); });
  const result = await api.dealers(10, { pin_code: '12345', locality: 'Central', district: 'District', stock_status: 'IN_STOCK' }, 2, 'test-only-issued-token');
  const url = new URL(captured.url);
  assert.equal(captured.init.headers.Authorization, 'Bearer test-only-issued-token');
  assert.equal(url.searchParams.get('product'), '10'); assert.equal(url.searchParams.get('variant'), null);
  assert.equal(url.searchParams.get('pin_code'), '12345'); assert.equal(url.searchParams.get('page'), '2');
  assert.equal(result.match_level, 'DISTRICT'); assert.match(matchLabel(result.match_level), /broader fallback/);
});
test('variant filtering stays within a fetched page without changing server counts', () => {
  const mapped = mapListing(listing);
  assert.equal(variantListings([mapped], 8).length, 0);
  assert.equal(variantListings([mapped], null).length, 1);
});
test('401 and 403 fail closed; service/network/malformed responses are errors, not empty inventory', async () => {
  for (const status of [401, 403, 503]) {
    const api = new ApiClient('http://example.test/api/v1', async () => new Response('{}', { status }));
    await assert.rejects(api.dealers(10, {}, 1, 'test-only-token'), error => error.status === status);
  }
  const offline = new ApiClient('http://example.test/api/v1', async () => { throw new Error('offline'); });
  await assert.rejects(offline.products({}, 1), /Cannot reach/);
  const malformed = new ApiClient('http://example.test/api/v1', async () => response({ results: [] }));
  await assert.rejects(malformed.products({}, 1), ApiError);
});
test('loading, failure, retry and successful empty states are distinct', () => {
  let state = resourceReducer({ status: 'loading' }, { type: 'error', message: 'Offline' });
  assert.equal(state.status, 'error');
  state = resourceReducer(state, { type: 'loading' }); assert.equal(state.status, 'loading');
  state = resourceReducer(state, { type: 'ready', data: page([]) });
  assert.equal(state.status, 'ready'); assert.equal(state.data.count, 0);
});
test('configuration and brand validation fail before sending a request', async () => {
  const api = new ApiClient(''); await assert.rejects(api.products({}, 1), /EXPO_PUBLIC_API_URL/);
  await assert.rejects(new ApiClient('http://user:secret@example.test').products({}, 1), /contain no credentials/);
  await assert.rejects(new ApiClient('http://example.test').products({ brand: 'oops' }, 1), /Brand ID/);
});
test('session admission verifies the server account status', async () => {
  const api = new ApiClient('http://example.test/api/v1', async () => response({ account: { access_state: 'BLOCKED' } }));
  await assert.rejects(api.validateSession('test-only-token'), error => error.status === 403);
});
test('404 product detail is unavailable rather than empty inventory', async () => {
  const api = new ApiClient('http://example.test/api/v1', async () => new Response('{}', { status: 404 }));
  await assert.rejects(api.product(10), error => error.status === 404 && /no longer available/.test(error.message));
});
test('abort signals reach transport without becoming successful empty results', async () => {
  const controller = new AbortController();
  const api = new ApiClient('http://example.test/api/v1', async (_url, init) => {
    assert.equal(init.signal, controller.signal);
    controller.abort(); throw new Error('aborted');
  });
  await assert.rejects(api.products({}, 1, controller.signal), /aborted/);
});
test('server-side error and unreadable JSON cannot become an empty search', async () => {
  const api = new ApiClient('http://example.test/api/v1', async () => new Response('not json'));
  await assert.rejects(api.products({}, 1), /unreadable/);
});
test('API base cannot smuggle query credentials into endpoint requests', async () => {
  const api = new ApiClient('http://example.test/api/v1?key=test-only');
  await assert.rejects(api.products({}, 1), /query parameters/);
});

test('selected SKU is sent to discovery before server pagination',async()=>{
 let requested;const api=new ApiClient('http://example.test/api/v1',async url=>{requested=url;return response({...page([listing]),match_level:'UNFILTERED'});});const value=await api.dealers(10,{variant:'7'},2,'token');assert.match(requested,/variant=7/);assert.match(requested,/page=2/);assert.equal(value.results[0].variant,7);
});
