import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as dealer from '../src/dealer.ts';
import * as api from '../src/api.ts';

// Reuse the monorepo's existing matching React/ReactDOM installations. Render
// the actual TSX component with native host adapters and isolated API fixtures;
// this is a headless render test, not an Android interaction test.
const requireAdmin = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = requireAdmin('react');
const { renderToStaticMarkup } = requireAdmin('react-dom/server');
const jsx = requireAdmin('react/jsx-runtime');
const source = readFileSync(new URL('../src/DealerWorkspace.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const base = { id: 1, legal_name: 'Fixture dealer', registration_number: '', verification_state: 'PENDING', workspace: { branch_count: 0, published_listing_count: 0, discoverable_listing_count: 0, can_edit: true, can_publish_branches: false, can_manage_listings: false, authorizations: [] } };

function render({ role = 'BUSINESS', tab = 'Dashboard', profile = { status: 'ready', data: base }, branches = { status: 'ready', data: { count: 0, results: [], next: null, previous: null } }, inventoryRows = [] } = {}) {
  let calls = 0;
  const states = [profile, branches, { status: 'ready', data: { count: inventoryRows.length, results: inventoryRows, next: null, previous: null } }, { status: 'ready', data: null }];
  const native = {};
  for (const name of ['Text', 'View', 'ScrollView', 'Pressable', 'TextInput', 'ActivityIndicator']) {
    native[name] = props => React.createElement(name === 'Pressable' ? 'button' : name === 'TextInput' ? 'input' : 'div', { disabled: props.disabled, 'aria-label': props.accessibilityLabel, ...(name === 'TextInput' ? { value: props.value, readOnly: true } : {}) }, props.children);
  }
  native.StyleSheet = { create: value => value };
  const imports = {
    react: { ...React, useState: value => React.useState(value === 'Dashboard' ? tab : value) },
    'react/jsx-runtime': jsx, 'react-native': native, './dealer': dealer, './api': api,
    './session': { useSession: () => ({ account: { account_type: role, access_state: 'ACTIVE' }, token: 'isolated-test-token', clearSession() {} }) },
    './useResource': { useResource: () => ({ state: states[calls++ % 4], retry() {} }) },
  };
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(name => { if (!(name in imports)) throw new Error(`Unexpected component dependency ${name}`); return imports[name]; }, module, module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default, { api: new api.ApiClient('http://example.test/api/v1') }));
}
test('actual component gates non-business identities and displays real aggregate dashboard fields', () => {
  assert.match(render({ role: 'PERSONAL' }), /active BUSINESS account/);
  assert.match(render(), /Branches: 0/);
  assert.match(render(), /Currently discoverable listings: 0/);
});
test('actual component has separate loading, failed and empty branch states', () => {
  assert.match(render({ profile: { status: 'loading' } }), /Loading dealer workspace/);
  assert.match(render({ profile: { status: 'error', message: 'Unavailable' } }), /Unavailable/);
  assert.match(render({ tab: 'Branches' }), /No dealer branches yet/);
  assert.match(render({ tab: 'Branches', branches: { status: 'error', message: 'Branches unavailable' } }), /Retry branches/);
});
test('actual authorization and listing screens explain restrictions and do not offer self-grants', () => {
  const authorization = render({ tab: 'Authorization' });
  assert.match(authorization, /Dealers cannot authorize themselves/);
  assert.match(authorization, /No brand authorizations/);
  const listings = render({ tab: 'Listings' });
  assert.match(listings, /verified business is required/);
  assert.match(listings, /disabled=""[^>]*>.*?Create product listing/);
});

test('existing dealer authorization component displays revoked status and company without self-grant controls',()=>{
 const data=structuredClone(base);data.workspace.authorizations=[{id:1,brand:2,brand_name:'Fixture Brand',company:3,company_name:'Fixture Company',active:false,eligible:false,company_verification_state:'VERIFIED',company_activity_state:'ACTIVE',updated_at:'2026-11-01'}];const html=render({tab:'Authorization',profile:{status:'ready',data}});assert.match(html,/Fixture Brand/);assert.match(html,/Fixture Company/);assert.match(html,/Revoked/);assert.match(html,/Not eligible/);assert.match(html,/Dealers cannot authorize themselves/);assert.doesNotMatch(html,/Confirm grant/);
});

test('inventory component displays canonical SKU, discovery status and eligible reactivation control',()=>{
 const data=structuredClone(base);data.workspace.can_manage_listings=true;data.workspace.authorizations=[{eligible:true,brand:2,company:3}];const row={id:9,product_name:'Fixture product',branch_name:'Central',brand_name:'Brand',company_name:'Company',brand_id:2,company_id:3,variant:7,variant_sku:'SKU-RED',selling_price:'12.50',currency:'USD',stock_status:'UNKNOWN',quantity:null,state:'WITHDRAWN',eligible:false};const html=render({tab:'Listings',profile:{status:'ready',data},inventoryRows:[row]});assert.match(html,/SKU-RED/);assert.match(html,/Not currently eligible/);assert.match(html,/Reactivate listing 9/);assert.match(html,/Search dealer listings/);
});
