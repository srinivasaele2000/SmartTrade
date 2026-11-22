import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {pages} from '../src/navigation.ts';
import {inr} from '../src/india.ts';

const require = createRequire(import.meta.url);
const jsx = require('react/jsx-runtime');
const source = readFileSync(new URL('../src/CreateProductItem.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
}}).outputText;

test('catalogue search queries the server for each field and clearing resets pagination', () => {
  const state = [];
  const requests = [];
  const pageChanges = [];
  let hook = 0;
  let number = 1;
  const imports = {
    react: {
      useState(initial) {
        const index = hook++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => {state[index] = value;}];
      },
      useRef: () => ({current: null}),
      useEffect() {},
    },
    'react/jsx-runtime': jsx,
    './api': {},
    './india': {inr},
    './useAdminPage': {useAdminPage(base, token, path, filters) {
      const params = new URLSearchParams(filters);
      const search = params.get('search');
      requests.push({path, search, ordering: params.get('ordering'), pageSize: params.get('page_size')});
      const result = {name: 'Ziva 1 Way Switch', product_code: '68001', hsn_sac_code: '85361010',
        price_per_unit: '39', category_name: 'Modular Switchgear & Distribution'};
      const count = search ? 1 : 64;
      const size = Number(params.get('page_size'));
      const offset = (number - 1) * size;
      return {number, setNumber: value => {number = value; pageChanges.push(value);}, data: {
        count, previous: number > 1 ? 'previous' : null, next: offset + size < count ? 'next' : null,
        results: Array.from({length: Math.min(size, count - offset)}, (_, index) => ({
          ...result, id: count - offset - index, name: `${result.name} ${count - offset - index}`,
        })),
      }};
    }},
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', compiled)(name => imports[name], module, module.exports);
  function render() {
    hook = 0;
    requests.length = 0;
    const nodes = [];
    function collect(node) {
      if (Array.isArray(node)) node.forEach(collect);
      else if (node?.props) {
        nodes.push(node);
        collect(node.props.children);
      }
    }
    collect(module.exports.default({baseUrl: '/api/v1', token: 'test'}));
    return nodes;
  }
  const findLabel = (nodes, label) => nodes.find(node => node.props['aria-label'] === label);
  let nodes = render();
  for (const query of [' ziva  1 way ', '68001', '85361010', 'Modular Switchgear', 'Anchor']) {
    findLabel(nodes, 'Search catalogue items').props.onChange({target: {value: query}});
    nodes = render();
    assert.deepEqual(requests[0], {path: '/catalogue/items/', search: query.trim().replace(/\s+/g, ' '), ordering: 'newest', pageSize: '50'});
  }
  assert.equal(nodes.find(node => node.props.className === 'catalogue-items-count').props.children, 'Showing 1 of 64 items');
  const actions = nodes.find(node => node.props.className === 'catalogue-items-actions');
  assert.deepEqual(actions.props.children.map(button => button.props.children), ['Edit', 'Delete']);
  findLabel(nodes, 'Clear catalogue search').props.onClick();
  nodes = render();
  assert.equal(requests[0].search, null);
  assert.equal(findLabel(nodes, 'Search catalogue items').props.value, '');
  assert.deepEqual(pageChanges, [1, 1, 1, 1, 1, 1]);

  assert.equal(nodes.find(node => node.props.className === 'catalogue-items-range').props.children, 'Showing 1–50 of 64 items');
  assert.equal(nodes.find(node => node.props.scope === 'row').props.children.props.title, 'Ziva 1 Way Switch 64');
  nodes.find(node => node.type === 'button' && node.props.children === 'Next').props.onClick();
  nodes = render();
  assert.equal(findLabel(nodes, 'Page 2').props['aria-current'], 'page');
  assert.equal(nodes.find(node => node.props.className === 'catalogue-items-range').props.children, 'Showing 51–64 of 64 items');
  assert.equal(nodes.find(node => node.type === 'button' && node.props.children === 'Next').props.disabled, true);
  findLabel(nodes, 'Search catalogue items').props.onChange({target: {value: 'Anchor'}});
  assert.equal(number, 1);
});

test('catalogue navigation and page header use the Catalogue items label', () => {
  const page = pages.find(entry => entry.id === 'catalogue');
  assert.equal(page.label, 'Catalogue items');
  assert.equal(page.title, 'Catalogue items');
  assert.equal(pages.find(entry => entry.id === 'catalogues').label, 'Catalogue vault');
  assert.equal(pages.find(entry => entry.id === 'banners').label, 'Promotional banners');
});
