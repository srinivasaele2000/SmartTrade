import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import {ApiClient} from '../src/api.ts';
import {estimatePage, estimateTotals} from '../src/dealer-estimates.ts';
import * as pricing from '../src/dealer-estimates.ts';
import {istDateTime} from '../src/india.ts';
import {HistoryPage} from '../src/history-page.ts';

test('dealer estimate preview matches the backend discount, GST and rounding', () => {
  const lines = [{unit_price: '100.0000', quantity: '2.000'}];
  assert.deepEqual(estimateTotals(lines, '5', 'CGST_SGST', '18'), {
    lines: ['200.00'], subtotal: '200.00', discount: '10.00', taxable: '190.00',
    cgst: '17.10', sgst: '17.10', igst: '0.00', total: '224.20',
  });
  assert.equal(estimateTotals(lines, '5', 'IGST', '18').igst, '34.20');
  assert.deepEqual(estimateTotals([{unit_price: '0.05', quantity: '1'}], '0', 'CGST_SGST', '20'), {
    lines: ['0.05'], subtotal: '0.05', discount: '0.00', taxable: '0.05',
    cgst: '0.01', sgst: '0.00', igst: '0.00', total: '0.06',
  });
});

test('customer PDF uses net rates for both item discount modes and omits internal prices', () => {
  const source = readFileSync(new URL('../src/customer-estimate-pdf.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(name => ({
    './dealer-estimates': pricing, './india': {istDateTime},
    './TradeDocument': {amountInWords: () => 'Rupees Two Hundred Twelve and Forty Paise Only'},
  })[name], exports);
  for (const discount_mode of ['PERCENT', 'AMOUNT']) {
    const line = {product_name: 'Switch <Series>', unit_price: '100.0000', quantity: '2.000',
      discount_mode, discount_value: '10'};
    assert.equal(pricing.estimateNetRate(line), '90.00');
    const totals = estimateTotals([line], '0', 'CGST_SGST', '18');
    assert.equal(totals.taxable, '180.00');
    assert.equal(totals.cgst, '16.20');
    assert.equal(totals.sgst, '16.20');
    assert.equal(totals.total, '212.40');
    assert.equal(estimateTotals([line], '0', 'IGST', '18').igst, '32.40');
    const html = exports.customerPdfHtml({
      customer_name: 'Buyer & Co', discount_percentage: '0', gst_rate_percentage: '18', gst_type: 'CGST_SGST',
      items: [{...line, net_unit_rate: '90.0000'}],
      totals: {taxable_amount: totals.taxable, cgst_amount: totals.cgst, sgst_amount: totals.sgst, total_amount: totals.total},
    }, 'EST-1', 'ESTIMATE / QUOTATION');
    assert.match(html, /<td>2\.000<\/td><td>90\.00<\/td><td>18%<\/td><td>180\.00<\/td>/);
    assert.match(html, /Switch &lt;Series&gt;/);
    assert.match(html, /Buyer &amp; Co/);
    assert.doesNotMatch(html, /discount|disc|100\.00/i);
  }
});

test('dealer search debounces typing, requests page one, and clears immediately', async ({mock}) => {
  mock.timers.enable({apis: ['setTimeout']});
  const state = [];
  let index = 0;
  let previousDependencies = [];
  let cleanup;
  const react = {
    useState(initial) {
      const slot = index++;
      state[slot] ??= initial;
      return [state[slot], value => {state[slot] = value;}];
    },
    useEffect(effect, dependencies) {
      if (dependencies.every((value, slot) => value === previousDependencies[slot])) return;
      cleanup?.();
      previousDependencies = dependencies;
      cleanup = effect();
    },
  };
  const source = readFileSync(new URL('../src/useDebouncedSearch.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}}).outputText;
  const exports = {};
  new Function('require', 'exports', compiled)(() => react, exports);
  const render = () => {index = 0; return exports.useDebouncedSearch();};
  const requests = [];
  const api = new ApiClient('http://localhost:8000/api/v1', async url => {
    const parameters = new URL(url).searchParams;
    requests.push([parameters.get('search'), parameters.get('page')]);
    return Response.json({results: [], count: 0, next: 'next', previous: null});
  });
  const load = query => (page, signal) => estimatePage(api,
    '/catalogue/items/?search=' + encodeURIComponent(query), page, 'dealer-token', signal);
  let search = render();
  const catalogue = new HistoryPage(load(search.query));
  await catalogue.start(load(search.query));
  await catalogue.next();
  search.change('680');
  search = render();
  mock.timers.tick(200);
  assert.equal(render().query, '');
  search.change(' 68001 ');
  assert.equal(render().pending, true);
  mock.timers.tick(274);
  assert.equal(render().query, '');
  mock.timers.tick(1);
  search = render();
  assert.equal(search.pending, false);
  await catalogue.start(load(search.query), true);
  search.change('');
  search = render();
  assert.equal(search.pending, false);
  await catalogue.start(load(search.query), true);
  assert.deepEqual(requests, [['', '1'], ['', '2'], ['68001', '1'], ['', '1']]);
});
