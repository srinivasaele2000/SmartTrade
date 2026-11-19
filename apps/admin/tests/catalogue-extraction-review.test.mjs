import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const jsx = require('react/jsx-runtime');
const source = readFileSync(new URL('../src/CatalogueExtractionReview.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
}}).outputText;

class TestApiError extends Error {
  constructor(status, message, fieldErrors) {super(message); Object.assign(this, {status, fieldErrors});}
}

function review(categories = [{id: 7, category__name: 'Switches', brand__company__legal_name: 'Example'}], requestApi, suppliedRows, onCommit, options = {}) {
  const rows = (suppliedRows ?? [
    {id: 1, product_code: 'one', association: '7', status: 'DRAFT'},
    {id: 2, product_code: 'two', association: '7', status: 'DRAFT'},
    {id: 3, product_code: 'missing', association: '', status: 'DRAFT'},
    {id: 4, product_code: 'invalid', association: '99', status: 'DRAFT'},
    {id: 5, product_code: 'reviewed', association: '7', status: 'APPROVED'},
  ]).map(row => ({...row, approved: false, image_url: null}));
  const state = [rows, categories, false, '', {}, 0, '', false, true];
  if (options.summary) state[16] = options.summary;
  if (options.existingCodes) state[17] = options.existingCodes;
  const effects = [];
  let hook = 0;
  let refHook = 0;
  const refs = [];
  const imports = {
    react: {
      useEffect(effect) {effects.push(effect);},
      useRef(value) { return refs[refHook++] ?? (refs[refHook - 1] = {current: value}); },
      useState(value) {
        const index = hook++;
        if (!(index in state)) state[index] = value;
        return [state[index], update => {
          state[index] = typeof update === 'function' ? update(state[index]) : update;
        }];
      },
    },
    'react/jsx-runtime': jsx,
    './api': {requestApi, ApiError: TestApiError},
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', compiled)(name => imports[name], module, module.exports);
  const get = label => {
    effects.length = 0;
    hook = 0;
    refHook = 0;
    const tree = module.exports.default({baseUrl: '/api/v1', token: 'test', documentKey: 'test', title: 'Example', onCommit});
    if (options.dialog) refs[0].current = options.dialog;
    function find(node) {
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      if (node?.props?.['aria-label'] === label || node?.props?.placeholder === label || node?.props?.children === label ||
          (node?.type === 'button' && node.props.children === label) ||
          (label === 'append' && node?.type === 'input' && node.props.type === 'checkbox' && !node.props['aria-label'])) return node.props;
      if (node?.props?.children) return find(node.props.children);
    }
    return find(tree);
  };
  return Object.assign(get, {runLastEffect: () => effects.at(-1)(), payload: module.exports.extractionPayload});
}

test('page range parses blank, single pages and inclusive ranges', () => {
  const {payload} = review();
  assert.deepEqual(payload('6-10', true), {start_page: 6, end_page: 10, append: true});
  assert.deepEqual(payload('6', false), {start_page: 6, end_page: 6, append: false});
  assert.deepEqual(payload('  ', true), {append: true});
  for (const range of ['10-5', 'abc', '0', '6-']) assert.throws(() => payload(range, false), /ascending range/);
});

test('extract batch validates the range then posts sequential three-page chunks', async () => {
  const requests = [];
  const get = review(undefined, async (base, path, token, options) => {
    requests.push({path, method: options.method, body: JSON.parse(options.body)});
    const {start_page, end_page, append} = requests.at(-1).body;
    return {rows: [], categories: [], batch: {start_page, end_page, processed_through: end_page, added: 0, replaced: !append}};
  });
  get('All pages (e.g. 6-10)').onChange({target: {value: '10-5'}});
  await get('Extract catalogue batch').onSubmit({preventDefault() {}});
  assert.equal(requests.length, 0);
  get('All pages (e.g. 6-10)').onChange({target: {value: '6-10'}});
  await get('Extract catalogue batch').onSubmit({preventDefault() {}});
  assert.deepEqual(requests, [
    {path: '/admin/catalogues/test/extract/', method: 'POST', body: {start_page: 6, end_page: 8, range_end: 10, append: false}},
    {path: '/admin/catalogues/test/extract/', method: 'POST', body: {start_page: 9, end_page: 10, range_end: 10, append: true}},
  ]);
});

test('completed rows render before the next chunk finishes and cancel keeps the remaining range', async () => {
  let finishSecond;
  let startedSecond;
  const secondStarted = new Promise(resolve => {startedSecond = resolve;});
  const requests = [];
  const get = review(undefined, async (_base, _path, _token, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const row = {id: 10, product_code: 'new-sku', status: 'DRAFT', category: '', image_url: null};
    if (requests.length === 2) {
      startedSecond();
      await new Promise(resolve => {finishSecond = resolve;});
    }
    return {rows: [row], categories: [], batch: {
      processed_through: body.end_page, added: 1, replaced: requests.length === 1,
    }};
  });
  get('All pages (e.g. 6-10)').onChange({target: {value: '50-70'}});
  const running = get('Extract catalogue batch').onSubmit({preventDefault() {}});
  await secondStarted;
  assert.ok(get('Approve new-sku'));
  get('Cancel after current chunk').onClick();
  finishSecond();
  await running;
  assert.equal(requests.length, 2);
  assert.equal(get('All pages (e.g. 6-10)').value, '56-70');
  assert.equal(get('append').checked, true);
});

test('a blank first chunk defers replacement and partial chunks retry only unprocessed pages', async () => {
  const requests = [];
  const get = review(undefined, async (_base, _path, _token, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    const second = requests.length === 2;
    return {rows: [], categories: [], batch: {
      processed_through: second ? body.start_page : body.end_page, added: second ? 1 : 0, replaced: second,
    }};
  });
  get('All pages (e.g. 6-10)').onChange({target: {value: '50-56'}});
  await get('Extract catalogue batch').onSubmit({preventDefault() {}});
  assert.deepEqual(requests.map(({start_page, end_page, append, replace_on_items}) =>
    [start_page, end_page, append, replace_on_items]), [
    [50, 52, false, undefined], [53, 55, true, true], [54, 55, true, undefined], [56, 56, true, undefined],
  ]);
});

test('header selects all eligible drafts and clears all selections on the next toggle', () => {
  const get = review();
  const master = 'Select all eligible rows';
  get(master).onChange();
  assert.equal(get(master).checked, true);
  assert.equal(get('Approve one').checked, true);
  assert.equal(get('Approve two').checked, true);
  for (const label of ['Approve missing', 'Approve invalid']) {
    assert.equal(get(label).checked, false);
    assert.equal(get(label).disabled, true);
  }
  get(master).onChange();
  assert.equal(get(master).checked, false);
  assert.equal(get('Approve one').checked, false);
  assert.equal(get('Approve two').checked, false);
});

test('partial approval sets native indeterminate state and an indeterminate toggle selects all', () => {
  const get = review();
  const master = 'Select all eligible rows';
  get('Approve one').onChange({target: {checked: true}});
  const input = {};
  get(master).ref(input);
  assert.equal(input.indeterminate, true);
  assert.equal(get(master).checked, false);
  get(master).onChange();
  get(master).ref(input);
  assert.equal(input.indeterminate, false);
  assert.equal(get(master).checked, true);
});

test('header is disabled when no category association is eligible', () => {
  const get = review([]);
  assert.equal(get('Select all eligible rows').disabled, true);
});

test('publishing 331 approvals submits once and keeps progress and errors beside the action', async () => {
  const rows = Array.from({length: 331}, (_, index) => ({
    id: index + 1, page: 1, status: 'DRAFT', association: '7', name: 'Switch ' + index,
    product_code: 'SW-' + index, hsn_sac_code: index ? '8536' : '', price_per_unit: '29.50',
  }));
  const requests = [];
  const published = [];
  let finish;
  const get = review(undefined, (_base, path, _token, options) => {
    requests.push({path, options});
    return new Promise((resolve, reject) => {finish = {resolve, reject};});
  }, rows, (...args) => published.push(args));
  get('Select all eligible rows').onChange();
  assert.equal(get('Commit & Publish (331)').disabled, false);
  const form = get('Publish catalogue items');
  assert.equal(form.noValidate, true);
  const event = {preventDefault() {}};
  const inFlight = form.onSubmit(event);
  await form.onSubmit(event);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].path, '/admin/catalogues/test/drafts/commit/');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(JSON.parse(requests[0].options.body).rows.length, 331);
  assert.equal(get('Committing & Publishing…').disabled, true);
  for (const label of ['Publish status at top', 'Publish status by actions']) {
    assert.match(get(label).children, /Publishing 331/);
  }

  finish.reject(new Error('Page 1, SW-0: Enter a valid HSN.'));
  await inFlight;
  for (const label of ['Publish status at top', 'Publish status by actions']) {
    assert.equal(get(label).role, 'alert');
    assert.match(get(label).children, /SW-0.*valid HSN/);
  }
  assert.equal(get('Commit & Publish (331)').disabled, false);
  get('HSN for row 1').onChange({target: {value: '8536'}});
  const retry = get('Publish catalogue items').onSubmit(event);
  assert.equal(JSON.parse(requests[1].options.body).rows[0].hsn_sac_code, '8536');
  finish.resolve({items: Array.from({length: 331}, () => ({})), discarded: 0});
  await retry;
  assert.deepEqual(published, [[331, 0]]);
  assert.match(get('Publish status by actions').children, /331 catalogue items published/);
  assert.equal(get('Commit & Publish (331)'), undefined);
});


test('review shows pending and published counts, skips catalogue codes and selects one of each duplicate', () => {
  const rows = ['SAME', 'SAME', 'LIVE'].map((product_code, i) => ({
    id: i + 1, product_code, status: 'DRAFT', association: '7',
  }));
  const get = review(undefined, undefined, rows, undefined, {
    summary: {pending: 3, published_from_document: 2, published_for_brand: 17}, existingCodes: ['LIVE'],
  });
  const cards = get('Catalogue publish summary').children;
  assert.deepEqual(cards.map(card => card.props.children[1].props.children), [3, 2, 17]);
  assert.ok(get('Duplicate code in batch'));
  assert.ok(get('Already in catalogue'));
  assert.equal(get('Approve LIVE').disabled, true);
  get('Select all eligible rows').onChange();
  assert.equal(get('Approve SAME').checked, true);
  assert.equal(get('Commit & Publish (1)').disabled, false);
  // The second occurrence can be selected manually, then reduced to one in a click.
  const second = get('Draft 2').children[0].props.children.props;
  assert.equal(second.checked, false);
  second.onChange({target: {checked: true}});
  assert.equal(get('Commit & Publish (2)').disabled, true);
  get('Uncheck duplicates (1)').onClick();
  assert.equal(get('Commit & Publish (1)').disabled, false);
});

test('structured API errors highlight and scroll to the exact draft IDs', async () => {
  const calls = [];
  const dialog = {querySelector(selector) {
    calls.push(selector);
    return {scrollIntoView: () => calls.push('scroll'), focus: () => calls.push('focus')};
  }};
  const rows = [3829, 3911].map(id => ({id, association: '7', status: 'DRAFT', product_code: String(id)}));
  const get = review(undefined, async () => {
    throw new TestApiError(400, 'Invalid batch', {row_errors: {
      3829: {product_code: 'Already in catalogue.'}, 3911: {hsn_sac_code: ['Enter a valid HSN.']},
    }});
  }, rows, undefined, {dialog});
  get('Select all eligible rows').onChange();
  await get('Publish catalogue items').onSubmit({preventDefault() {}});
  assert.match(get('Error for draft 3829').children, /Already in catalogue/);
  assert.match(get('Error for draft 3911').children, /valid HSN/);
  assert.equal(get('Draft 3829').className, 'catalogue-review-row-error');
  get.runLastEffect();
  assert.deepEqual(calls, ['[data-draft-id="3829"]', 'scroll', 'focus']);
});

test('extraction diagnostics show each page and edited hierarchy and packing are sent on publish', async () => {
  const row = {id: 8, product_code: 'SW-8', association: '7', status: 'DRAFT',
    name: 'Switch 2M', sub_category: 'ROMA', pack_size: {standard: '12', box_quantity: '96'}};
  let payload;
  const get = review(undefined, async (_base, path, _token, options) => {
    if (path.endsWith('extract/')) return {rows: [], categories: [], diagnostics: {
      status: 'no_items', pages_scanned: 1, matrix_items: 2,
      pages: [{page: 3, items: 2, thumbnails: 1, matrix_items: 2, ocr: 'tesseract'}],
    }};
    payload = JSON.parse(options.body);
    return {items: [{}], discarded: 0};
  }, [row], () => {});
  get('Sub-category for draft 8').onChange({target: {value: 'Bell Push'}});
  get('Standard pack for draft 8').onChange({target: {value: '6'}});
  get('Box quantity for draft 8').onChange({target: {value: ''}});
  get('Select all eligible rows').onChange();
  await get('Publish catalogue items').onSubmit({preventDefault() {}});
  assert.equal(payload.rows[0].sub_category, 'Bell Push');
  assert.deepEqual(payload.rows[0].pack_size, {standard: '6', box_quantity: ''});
  await get('Extract catalogue batch').onSubmit({preventDefault() {}});
  assert.ok(get('Page diagnostics'));
  assert.ok(get('Matrix items'));
});
