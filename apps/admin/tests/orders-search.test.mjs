import * as copy from '../src/businessCopy.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

const jsx = createRequire(import.meta.url)('react/jsx-runtime');
const source = readFileSync(new URL('../src/Orders.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
}).outputText;

test('order filters compose across pages and changing the query resets pagination', async () => {
  const state = [];
  const calls = [];
  let index, effect;
  const imports = {
    react: {
      useState(initial) {
        const slot = index++;
        if (!(slot in state)) state[slot] = initial;
        return [state[slot], value => {state[slot] = value;}];
      },
      useRef(initial) {
        const slot = index++;
        return state[slot] ??= {current: initial};
      },
      useEffect(callback) {effect = callback;},
      useCallback: callback => callback,
    },
    'react/jsx-runtime': jsx,
    './api': {
      ensureList() {},
      async requestApi(_base, path) {
        calls.push(Object.fromEntries(new URL(path, 'http://example.test').searchParams));
        return {count: 22, previous: null, next: '?page=2', results: []};
      },
    },
    './india': {inr: String, istDateTime: String},
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', compiled)(name => name === './businessCopy' ? copy : imports[name], module, module.exports);
  function render() {
    index = 0;
    const elements = [];
    function visit(node) {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node?.props) {elements.push(node); visit(node.props.children);}
    }
    visit(module.exports.default({baseUrl: '/api/v1', token: 'fixture', permissions: ['READ_REPORTS']}));
    return elements;
  }
  const idle = () => new Promise(resolve => setImmediate(resolve));
  const controls = render();
  controls.find(node => node.type === 'input').props.onChange({target: {value: '  invoice west  '}});
  const selects = controls.filter(node => node.type === 'select');
  selects[0].props.onChange({target: {value: 'CONFIRMED'}});
  selects[1].props.onChange({target: {value: 'TAX_INVOICE'}});
  render();
  let cleanup = effect();
  await idle();
  assert.deepEqual(calls.at(-1), {page: '1', q: 'invoice west', state: 'CONFIRMED', invoice_kind: 'TAX_INVOICE'});
  render().find(node => node.type === 'button' && node.props.children === 'Next').props.onClick();
  cleanup();
  render();
  cleanup = effect();
  await idle();
  assert.deepEqual(calls.at(-1), {page: '2', q: 'invoice west', state: 'CONFIRMED', invoice_kind: 'TAX_INVOICE'});
  render().find(node => node.type === 'input').props.onChange({target: {value: ''}});
  cleanup();
  render();
  effect();
  assert.deepEqual(calls.at(-1), {page: '1', state: 'CONFIRMED', invoice_kind: 'TAX_INVOICE'});
});
