import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
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
      requests.push({path, search: new URLSearchParams(filters).get('search')});
      return {setNumber: value => pageChanges.push(value), data: {
        count: filters === 'page_size=1' ? 64 : 1,
        results: [{id: 1, name: 'Ziva 1 Way Switch', product_code: '68001', hsn_sac_code: '85361010',
          price_per_unit: '39', category_name: 'Modular Switchgear & Distribution'}],
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
    assert.deepEqual(requests[0], {path: '/catalogue/items/', search: query.trim().replace(/\s+/g, ' ')});
  }
  assert.equal(nodes.find(node => node.props.className === 'catalogue-items-count').props.children, 'Showing 1 of 64 items');
  const actions = nodes.find(node => node.props.className === 'catalogue-items-actions');
  assert.deepEqual(actions.props.children.map(button => button.props.children), ['Edit', 'Delete']);
  findLabel(nodes, 'Clear catalogue search').props.onClick();
  nodes = render();
  assert.equal(requests[0].search, null);
  assert.equal(findLabel(nodes, 'Search catalogue items').props.value, '');
  assert.deepEqual(pageChanges, [1, 1, 1, 1, 1, 1]);
});
