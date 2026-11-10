import assert from 'node:assert/strict';
import test from 'node:test';
import {loadBrowseAvailability, matchesBrowseFilter} from '../src/catalogue-browse.ts';

test('catalogue quick filters use PDF metadata and confirmed dealer results', () => {
  const product = {catalogue_pdf_url: '/media/catalogue/fixture'};
  assert.equal(matchesBrowseFilter(product, 'pdf'), true);
  assert.equal(matchesBrowseFilter({}, 'pdf'), false);
  assert.equal(matchesBrowseFilter(product, 'stock'), false);
  assert.equal(matchesBrowseFilter(product, 'stock', {authorized: true, inStock: null}), false);
  assert.equal(matchesBrowseFilter(product, 'stock', {authorized: true, inStock: true}), true);
  assert.equal(matchesBrowseFilter(product, 'authorized', {authorized: true, inStock: false}), true);
});

test('availability checks later stock pages and preserves unknowns on request failure', async () => {
  const calls = [];
  const api = {dealers: async (id, filters, page, token) => {
    calls.push([id, filters.stock_status, page, token]);
    if (id === 3 || (id === 4 && filters.stock_status)) throw new Error('Network unavailable');
    if (filters.stock_status) return {count: 1, results: [], next: null};
    if (id === 2) return {count: 0, results: [], next: null};
    return {count: 2, results: [{stock_status: 'UNKNOWN'}], next: '/next'};
  }};
  const results = await loadBrowseAvailability(api, [1, 2, 3, 4], 'signed-in', new AbortController().signal);
  assert.deepEqual(results.get(1), {authorized: true, inStock: true});
  assert.deepEqual(results.get(2), {authorized: false, inStock: false});
  assert.equal(results.has(3), false);
  assert.deepEqual(results.get(4), {authorized: true, inStock: null});
  assert.ok(calls.some(call => call.join(',') === '1,IN_STOCK,1,signed-in'));
});
