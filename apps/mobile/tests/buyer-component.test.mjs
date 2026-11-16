import {buttonModule} from './button-adapter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as apiModule from '../src/api.ts';
import * as resourceModule from '../src/resource.ts';
import * as indiaModule from '../src/india.ts';
import * as browseModule from '../src/catalogue-browse.ts';
import * as theme from '../src/trade-theme.ts';
import * as demoRoles from '../src/demo-roles.ts';
import * as workforce from '../src/workforce-profile.ts';
import * as featureFlags from '../src/featureFlags.ts';

const requireAdmin = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = requireAdmin('react');
const { renderToStaticMarkup } = requireAdmin('react-dom/server');
const jsx = requireAdmin('react/jsx-runtime');
const source = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const identitySource = readFileSync(new URL('../src/RoleIdentity.tsx', import.meta.url), 'utf8');
const identityCompiled = ts.transpileModule(identitySource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const browseCardsSource = readFileSync(new URL('../src/CatalogueBrowseCards.tsx', import.meta.url), 'utf8');
const browseCardsCompiled = ts.transpileModule(browseCardsSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;

const product = { id: 10, name: 'Impact driver', code: 'ID-10', brand_name: 'BuildCo', company_name: 'Supplier', category_name: 'Tools', description: 'Cordless driver', specifications: { voltage: '18V' }, unit: 'piece', catalogue_price: '50.0000', currency: 'INR', variants: [{ id: 7, product: 10, sku: 'ID-RED', name: 'Red kit', attributes: { color: 'red' }, active: true }] };
const page = results => ({ count: results.length, next: null, previous: null, results });
const ready = data => ({ status: 'ready', data });

function moduleWith(states, account = null, screen = 'catalogue', scheme = 'light', flags = featureFlags) {
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
  const icons = Object.fromEntries(['Briefcase','Building2','Search','ShieldCheck','ShoppingBag','Store','Wrench'].map(name => [
    name, () => React.createElement('span', {'data-icon': name}),
  ]));
  new Function('require', 'module', 'exports', identityCompiled)(name => ({
    'react-native': native, 'react/jsx-runtime': jsx, 'lucide-react-native': icons,
  })[name], identity, identity.exports);
  const button = buttonModule(React, native, jsx);
  const catalogueMedia = {CatalogueImage: () => null, CataloguePdf: () => null};
  const cards = {exports: {}};
  new Function('require', 'module', 'exports', browseCardsCompiled)(name => ({
    'react-native': native, 'react/jsx-runtime': jsx, 'lucide-react-native': new Proxy({}, {get: () => () => null}),
    './Button': button, './CatalogueMedia': catalogueMedia, './india': indiaModule, './trade-theme': theme,
  })[name], cards, cards.exports);
  const imports = { './src/platform-alert': {showAlert() {}}, './src/StickyBottomBar':{StickyBottomBar:({children})=>children}, 'react-native-safe-area-context':{SafeAreaProvider:({children})=>children, SafeAreaView:native.SafeAreaView, useSafeAreaInsets:()=>({bottom:48})}, './src/Button':button,
    './src/RoleIdentity': identity.exports,
    './src/featureFlags': flags,
    './src/CatalogueMedia': catalogueMedia,
    './src/CatalogueBrowseCards': cards.exports,
    './src/catalogue-browse': browseModule,
    './src/trade-theme': theme,
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
    './src/DealerOnboardingScreen': { default: () => null },
    './src/NearbyDealersScreen': { default: () => null },
    './src/SupportChat': { default: () => null, useDealerSupportUnread: () => 0 },
    './src/DealerBannerCarousel': {default: () => null},
    './src/useCustomerLocation': {useCustomerLocation: () => ({})},
    './src/DealerWorkerContactsScreen': { default: () => React.createElement('div', {}, 'Worker contact form') },
    './src/DealerEstimateScreen': { default: () => null },
    './src/WorkforceProfileScreen': { default: () => null },
    './src/workforce-profile': workforce,
    './src/EnquiryWorkspace': { default: () => React.createElement('div', {}, 'Enquiry workspace fixture') },
    './src/OrderWorkspace': { default: () => React.createElement('div', {}, 'Order workspace fixture') },
    './src/OfflineDocumentsScreen': { default: () => null },
    './src/DemoRoleSwitcher': { default: () => null },
    './src/demo-roles': demoRoles,
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
    ['PERSONAL', 'CUSTOMER', 'ShoppingBag', '#174888'],
    ['BUSINESS', 'DEALER', 'Store', '#15543B'],
    ['COMPANY', 'COMPANY', 'Building2', '#552780'],
    ['SERVICE_PROVIDER', 'SERVICE PROVIDER', 'Wrench', '#7A4200'],
    ['JOB_SEEKER', 'JOB SEEKER', 'Search', '#115952'],
    ['EMPLOYER', 'EMPLOYER', 'Briefcase', '#37308B'],
    ['STAFF', 'PLATFORM ADMIN', 'ShieldCheck', '#8A241B'],
  ]) {
    const account = {...base, account_type: code, dealer_contacts_complete: true, staff_profile: code === 'STAFF' ? {state: 'ACTIVE', roles: ['PLATFORM_ADMIN']} : null};
    const html = render(account, 'account', 'light');
    assert.equal((html.match(new RegExp('Account role: ' + label, 'g')) ?? []).length, 2);
    assert.match(html, new RegExp('data-icon="' + icon + '"'));
    assert.match(html, new RegExp('data-palette="' + palette + '"'));
    assert.match(html, /My account/);
    assert.doesNotMatch(html, /PLATFORM_ADMIN|>PERSONAL<|>BUSINESS</);
  }
  assert.match(render({...base, account_type: 'STAFF'}, 'account', 'light'), /Account role: STAFF/);
  assert.match(render({...base, account_type: 'COMPANY'}, 'catalogue', 'dark'), /data-palette="#E8D3FF"/);
  assert.doesNotMatch(render(null, 'catalogue', 'light'), /Account role:/);
  assert.match(render({...base, account_type: 'PERSONAL'}, 'account', 'light'), /Offline Documents/);
});

test('Dealer commercial rows and direct routes are hidden by default while Buyer access remains', () => {
  const states = [ready(page([])), ready(page([])), ready(page([]))];
  const buyer = {id: 1, account_type: 'PERSONAL', access_state: 'ACTIVE'};
  const dealer = {...buyer, account_type: 'BUSINESS', dealer_contacts_complete: true};
  const render = (account, route, flags) =>
    renderToStaticMarkup(React.createElement(moduleWith(states, account, route, 'light', flags).default));

  const dealerAccount = render(dealer, 'account');
  assert.doesNotMatch(dealerAccount, /Incoming enquiries|Incoming orders/);
  assert.match(dealerAccount, /Catalogue items &amp; estimates/);
  assert.match(dealerAccount, /My bills \/ invoices/);
  assert.match(render(buyer, 'account'), /Enquiries and quotations/);
  assert.match(render(buyer, 'account'), /Orders and invoices/);

  const enabled = {SHOW_DEALER_INCOMING_COMMERCIAL_MODULES: true};
  const enabledAccount = render(dealer, 'account', enabled);
  assert.match(enabledAccount, /Incoming enquiries/);
  assert.match(enabledAccount, /Incoming orders/);
  for (const [route, workspace] of [['enquiries', /Enquiry workspace fixture/], ['orders', /Order workspace fixture/]]) {
    assert.doesNotMatch(render(dealer, route), workspace);
    assert.match(render(buyer, route), workspace);
    assert.match(render(dealer, route, enabled), workspace);
  }
});

test('incomplete or unknown dealer onboarding status replaces every requested route with Step 2', () => {
  for (const status of [false, undefined]) {
    for (const route of ['catalogue', 'auth', 'account', 'orders', 'dealer-workspace']) {
      const account = {id: 1, account_type: 'BUSINESS', access_state: 'ACTIVE', dealer_contacts_complete: status};
      const html = renderToStaticMarkup(React.createElement(moduleWith([], account, route).default));
      assert.match(html, /Add 10 unique worker contacts/);
      assert.match(html, /Worker contact form/);
      assert.match(html, /Sign Out/);
      assert.doesNotMatch(html, /My account|Browse|>Back</);
    }
  }
});

test('public registration picker renders six distinct cards and excludes staff', () => {
  const src = readFileSync(new URL('../src/RoleSelectScreen.tsx', import.meta.url), 'utf8');
  const output = ts.transpileModule(src, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  const host = props => React.createElement('div', {'aria-label': props.accessibilityLabel}, props.children);
  const imports = {
    'react/jsx-runtime': jsx,
    'react-native': {Pressable: host, ScrollView: host, View: host, Text: host, StyleSheet: {create: value => value}},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 48})},
    './Button': {Button: props => React.createElement('button', {}, props.title)},
    './RoleIdentity': {RoleBadge: () => null},
    './trade-theme': theme,
  };
  const exports = {};
  new Function('require', 'exports', output)(name => imports[name], exports);
  const html = renderToStaticMarkup(React.createElement(exports.default, {choose() {}, cancel() {}}));
  const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map(match => match[1]);
  assert.deepEqual(labels, ['Personal Customer', 'Dealer / Shop', 'Company / Manufacturer', 'Service Provider', 'Job Seeker', 'Employer']);
});

test('buyer catalogue renders real category and brand selectors plus product metadata', () => {
  const components = moduleWith([
    ready(page([{...product, catalogue_pdf_url: '/media/catalogue/test'}])),
    ready(page([{ id: 2, name: 'Tools', active: true }])),
    ready(page([{ id: 4, name: 'BuildCo', company_name: 'Supplier', categories: [{ id: 2, name: 'Tools' }] }])),
  ]);
  const html = renderToStaticMarkup(React.createElement(components.CatalogueScreen, { open() {} }));
  assert.match(html, /Search products, codes or SKUs/);
  assert.match(html, /BuildCo · Supplier/);
  assert.match(html, /Impact driver/);
  assert.match(html, /ID-10/);
  assert.match(html, /Shop by category/);
  assert.match(html, /With Catalogue/);
  assert.match(html, /Authorized Only/);
  assert.match(html, /PDF available/);
  assert.match(html, /View details for Impact driver/);
  assert.match(html, /GST not specified/);
  assert.doesNotMatch(html, /In stock at a dealer|Authorized dealer<|incl\. GST/);
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
