import test from 'node:test';import assert from 'node:assert/strict';import { readFileSync } from 'node:fs';import {createRequire} from 'node:module';import ts from 'typescript';import * as api from '../src/api.ts';
const require=createRequire(import.meta.url);const React=require('react');const {renderToStaticMarkup}=require('react-dom/server');const jsx=require('react/jsx-runtime');
const source=readFileSync(new URL('../src/CatalogueTools.tsx',import.meta.url),'utf8');const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
function render(permissions,loaded=false){const imports={react:{...React,useState:value=>React.useState(loaded&&value===true?false:value)},'react/jsx-runtime':jsx,'./api':api};const module={exports:{}};new Function('require','module','exports',compiled)(name=>imports[name],module,module.exports);return renderToStaticMarkup(React.createElement(module.exports.default,{baseUrl:'/api/v1',token:'isolated-token',permissions}));}
test('catalogue tools preserve separate staff permissions and do not invent brand moderation',()=>{const html=render([]);assert.match(html,/MODERATE_PRODUCTS permission is required/);assert.match(html,/READ_AUDIT staff permission is required/);assert.doesNotMatch(html,/Category management/);assert.doesNotMatch(html,/No brands returned/);});
test('catalogue tools distinguish loading and actual empty lists',()=>{const permissions=['MODERATE_PRODUCTS','MANAGE_TAXONOMY','READ_AUDIT'];assert.match(render(permissions),/Loading/);const html=render(permissions,true);assert.match(html,/No brands returned/);assert.match(html,/No categories returned/);assert.match(html,/No catalogue audit events match/);assert.match(html,/no independent activation\/moderation state/);});


test('staff catalogue sends the selected products and canonical association to bulk tagging', async () => {
  const source = readFileSync(new URL('../src/Catalogue.tsx', import.meta.url), 'utf8');
  const {outputText} = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  }});
  const calls = [];
  const states = [];
  let next, effect;
  const product = {id: 44, name: 'Socket', code: 'ROMA-1', catalogue_price: null, variants: []};
  const imports = {
    react: {
      useState(initial) {
        const slot = next++;
        if (!(slot in states)) states[slot] = initial;
        return [states[slot], value => {states[slot] = typeof value === 'function' ? value(states[slot]) : value;}];
      },
      useCallback: callback => callback,
      useEffect(callback) {effect = callback;},
      useRef: () => ({current: 0}),
    },
    'react/jsx-runtime': jsx,
    './api': {ensureList() {}, async requestApi(_base, path, _token, options) {
      calls.push({path, options});
      if (path.endsWith('/bulk-tag')) return {updated: 1};
      if (path.includes('/options/')) return [{id: 7, brand__name: 'Fixture', category__name: 'Switchgear'}];
      return {count: 1, results: [product]};
    }},
    './CatalogueTools': {default: () => null}, './CreateProductItem': {default: () => null},
    './ProductMedia': {}, './india': {inr: String},
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', outputText)(name => imports[name], module, module.exports);
  function render() {
    next = 0;
    const nodes = [];
    function visit(node) {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node?.props) {nodes.push(node); visit(node.props.children);}
    }
    visit(module.exports.default({baseUrl: '/api/v1', token: 'fixture', permissions: ['MODERATE_PRODUCTS']}));
    return nodes;
  }
  const idle = () => new Promise(resolve => setImmediate(resolve));
  render();
  effect();
  await idle();
  render().find(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({target: {checked: true}});
  render();
  effect();
  await idle();
  assert.match(calls.at(-1).path, /category=uncategorized/);
  render().find(node => node.props['aria-label'] === 'Select ROMA-1 for tagging').props.onChange({target: {checked: true}});
  render().find(node => node.type === 'button' && node.props.children === 'Assign Category / Brand').props.onClick();
  await idle();
  render().find(node => node.type === 'select').props.onChange({target: {value: '7'}});
  await render().find(node => node.props['aria-label'] === 'Assign Category / Brand').props.onSubmit({preventDefault() {}});
  const submit = calls.find(call => call.path.endsWith('/bulk-tag'));
  assert.deepEqual(JSON.parse(submit.options.body), {products: [44], brand_category: 7});
});
