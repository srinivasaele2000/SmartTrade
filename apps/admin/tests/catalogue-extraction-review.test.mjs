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

function review(categories = [{id: 7, category__name: 'Switches', brand__company__legal_name: 'Example'}], requestApi) {
  const rows = [
    {id: 1, product_code: 'one', association: '7', status: 'DRAFT'},
    {id: 2, product_code: 'two', association: '7', status: 'DRAFT'},
    {id: 3, product_code: 'missing', association: '', status: 'DRAFT'},
    {id: 4, product_code: 'invalid', association: '99', status: 'DRAFT'},
    {id: 5, product_code: 'reviewed', association: '7', status: 'APPROVED'},
  ].map(row => ({...row, approved: false, image_url: null}));
  const state = [rows, categories, false, '', {}, 0, '', false, true];
  let hook = 0;
  const imports = {
    react: {
      useEffect() {},
      useRef: value => ({current: value}),
      useState(value) {
        const index = hook++;
        if (!(index in state)) state[index] = value;
        return [state[index], update => {
          state[index] = typeof update === 'function' ? update(state[index]) : update;
        }];
      },
    },
    'react/jsx-runtime': jsx,
    './api': {requestApi, ApiError: Error},
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', compiled)(name => imports[name], module, module.exports);
  const get = label => {
    hook = 0;
    const tree = module.exports.default({baseUrl: '/api/v1', token: 'test', documentKey: 'test', title: 'Example'});
    function find(node) {
      if (Array.isArray(node)) return node.map(find).find(Boolean);
      if (node?.props?.['aria-label'] === label || node?.props?.placeholder === label ||
          (label === 'append' && node?.type === 'input' && node.props.type === 'checkbox' && !node.props['aria-label'])) return node.props;
      if (node?.props?.children) return find(node.props.children);
    }
    return find(tree);
  };
  return Object.assign(get, {payload: module.exports.extractionPayload});
}

test('page range parses blank, single pages and inclusive ranges', () => {
  const {payload} = review();
  assert.deepEqual(payload('6-10', true), {start_page: 6, end_page: 10, append: true});
  assert.deepEqual(payload('6', false), {start_page: 6, end_page: 6, append: false});
  assert.deepEqual(payload('  ', true), {append: true});
  for (const range of ['10-5', 'abc', '0', '6-']) assert.throws(() => payload(range, false), /ascending range/);
});

test('extract batch posts the page range and append setting and blocks invalid input', async () => {
  const requests = [];
  const get = review(undefined, async (base, path, token, options) => {
    requests.push({path, method: options.method, body: JSON.parse(options.body)});
    return {rows: [], categories: []};
  });
  get('All pages (e.g. 6-10)').onChange({target: {value: '10-5'}});
  await get('Extract catalogue batch').onSubmit({preventDefault() {}});
  assert.equal(requests.length, 0);
  get('All pages (e.g. 6-10)').onChange({target: {value: '6-10'}});
  get('append').onChange({target: {checked: true}});
  await get('Extract catalogue batch').onSubmit({preventDefault() {}});
  assert.deepEqual(requests, [{path: '/admin/catalogues/test/extract/', method: 'POST',
    body: {start_page: 6, end_page: 10, append: true}}]);
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
