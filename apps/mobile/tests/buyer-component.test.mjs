import {buttonModule} from './button-adapter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as apiModule from '../src/api.ts';
import * as resourceModule from '../src/resource.ts';
import * as indiaModule from '../src/india.ts';

const requireAdmin = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = requireAdmin('react');
const { renderToStaticMarkup } = requireAdmin('react-dom/server');
const jsx = requireAdmin('react/jsx-runtime');
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const identitySource = readFileSync(new URL('../src/RoleIdentity.tsx', import.meta.url), 'utf8');
const identityCompiled = ts.transpileModule(identitySource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;

const product = { id: 10, name: 'Impact driver', code: 'ID-10', brand_name: 'BuildCo', company_name: 'Supplier', category_name: 'Tools', description: 'Cordless driver', specifications: { voltage: '18V' }, unit: 'piece', catalogue_price: '50.0000', currency: 'INR', variants: [{ id: 7, product: 10, sku: 'ID-RED', name: 'Red kit', attributes: { color: 'red' }, active: true }] };
const page = results => ({ count: results.length, next: null, previous: null, results });
const ready = data => ({ status: 'ready', data });

function moduleWith(states, account = null, screen = 'catalogue', scheme = 'light') {
  let calls = 0;
  const native = {};
  for (const name of ['Text', 'View', 'ScrollView', 'Pressable', 'TextInput', 'ActivityIndicator', 'SafeAreaView', 'KeyboardAvoidingView']) {
    native[name] = props => React.createElement(name === 'Pressable' ? 'button' : name === 'TextInput' ? 'input' : 'div', { disabled: props.disabled, 'aria-label': props.accessibilityLabel, 'data-palette': props.accessibilityLabel?.startsWith('Account role:') ? props.style.at(-1).color : undefined, value: name === 'TextInput' ? props.value : undefined, readOnly: name === 'TextInput' ? true : undefined }, props.children);
  }
  native.StyleSheet = { create: value => value };
  native.Platform = { OS: 'android' };
  native.StatusBar = () => null;
  native.BackHandler = { addEventListener: () => ({ remove() {} }) };
  native.useColorScheme = () => scheme;
  const identity = {exports: {}};
  const icons = Object.fromEntries(['Building2','ShieldCheck','ShoppingBag','Store'].map(name => [
    name, () => React.createElement('span', {'data-icon': name}),
  ]));
  new Function('require', 'module', 'exports', identityCompiled)(name => ({
    'react-native': native, 'react/jsx-runtime': jsx, 'lucide-react-native': icons,
  })[name], identity, identity.exports);
  const imports = { './src/Button':buttonModule(React,native,jsx),
    './src/RoleIdentity': identity.exports,
    './src/Onboarding': {PersonalProfile: () => null},
    react: {...React, useState: value => React.useState(value?.name === 'catalogue' ? {name: screen} : value)},
    'react/jsx-runtime': jsx,
    'react-native': native,
    './src/api': apiModule,
    './src/resource': resourceModule,
    './src/india': indiaModule,
    './src/useResource': { useResource: () => ({ state: states[calls++], retry() {} }) },
    './src/session': { SessionProvider: props => props.children, useSession: () => ({ token: account ? 'isolated-token' : null, clearSession() {}, account, message: '' }) },
    './src/AuthScreen': { default: () => null },
    './src/CompanyScreen': { default: () => null },
    './src/DealerWorkspace': { default: () => null },
    './src/EnquiryWorkspace': { default: () => null },
    './src/OrderWorkspace': { default: () => null },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => { if (!(name in imports)) throw new Error(`Unexpected dependency ${name}`); return imports[name]; }, module, module.exports);
  return module.exports;
}

test('authenticated header and account dashboard identify each role and signed-out state', () => {
  const base = {id: 1, access_state: 'ACTIVE', mobile_verified: false};
  const states = [ready(page([])), ready(page([])), ready(page([]))];
  const render = (account, screen, scheme) => renderToStaticMarkup(React.createElement(moduleWith(states, account, screen, scheme).default));
  for (const [code, label, icon, palette] of [
    ['PERSONAL', 'BUYER', 'ShoppingBag', '#174888'],
    ['BUSINESS', 'DEALER', 'Store', '#15543B'],
    ['COMPANY', 'COMPANY', 'Building2', '#552780'],
    ['STAFF', 'PLATFORM ADMIN', 'ShieldCheck', '#843D0B'],
  ]) {
    const account = {...base, account_type: code, staff_profile: code === 'STAFF' ? {state: 'ACTIVE', roles: ['PLATFORM_ADMIN']} : null};
    const html = render(account, 'account', 'light');
    assert.equal((html.match(new RegExp('Account role: ' + label, 'g')) ?? []).length, 2);
    assert.match(html, new RegExp('data-icon="' + icon + '"'));
    assert.match(html, new RegExp('data-palette="' + palette + '"'));
    assert.match(html, /SmartTrade/);
    assert.doesNotMatch(html, /PLATFORM_ADMIN|>PERSONAL<|>BUSINESS</);
  }
  assert.match(render({...base, account_type: 'STAFF'}, 'account', 'light'), /Account role: STAFF/);
  assert.match(render({...base, account_type: 'COMPANY'}, 'catalogue', 'dark'), /data-palette="#E8D3FF"/);
  assert.doesNotMatch(render(null, 'catalogue', 'light'), /Account role:/);
});

test('buyer catalogue renders real category and brand selectors plus product metadata', () => {
  const components = moduleWith([
    ready(page([product])),
    ready(page([{ id: 2, name: 'Tools', active: true }])),
    ready(page([{ id: 4, name: 'BuildCo', company_name: 'Supplier', categories: [{ id: 2, name: 'Tools' }] }])),
  ]);
  const html = renderToStaticMarkup(React.createElement(components.CatalogueScreen, { open() {} }));
  assert.match(html, /Search products, codes or SKUs/);
  assert.match(html, /BuildCo · Supplier/);
  assert.match(html, /Impact driver/);
  assert.match(html, /ID-10/);
});

test('product detail renders specifications and variant SKU selection', () => {
  const components = moduleWith([ready(product)]);
  const html = renderToStaticMarkup(React.createElement(components.ProductScreen, { id: 10, findDealers() {} }));
  assert.match(html, /voltage: 18V/);
  assert.match(html, /Red kit · SKU ID-RED/);
  assert.match(html, /Find dealer branches for this product/);
});

test('dealer comparison distinguishes an eligible empty search from unavailable inventory', () => {
  const components = moduleWith([ready({ ...page([]), match_level: 'NO_LOCATION_MATCH' })]);
  const html = renderToStaticMarkup(React.createElement(components.DealerResults, { product, variant: 7, token: 'isolated-issued-token', invalidate() {} }));
  assert.match(html, /No location matches/);
  assert.match(html, /No eligible listings match these filters/);
  assert.match(html, /does not confirm that the product is out of stock everywhere/);
});
