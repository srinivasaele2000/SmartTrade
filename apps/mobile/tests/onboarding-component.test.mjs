import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import {buttonModule} from './button-adapter.mjs';
import * as india from '../src/india.ts';
import * as api from '../src/api.ts';

const requireAdmin = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = requireAdmin('react');
const {renderToStaticMarkup} = requireAdmin('react-dom/server');
const jsx = requireAdmin('react/jsx-runtime');
const compiled = ts.transpileModule(readFileSync(new URL('../src/Onboarding.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
}).outputText;
const ready = data => ({status: 'ready', data});
const emptyPage = {results: [], count: 0, next: null, previous: null};

function render(name, states, role = 'BUSINESS', editable = true) {
  const native = Object.fromEntries(['View', 'ScrollView', 'Text', 'TextInput', 'Pressable'].map(name => [
    name, props => React.createElement(name === 'Pressable' ? 'button' : name === 'TextInput' ? 'input' : 'div', {
      'aria-label': props.accessibilityLabel, disabled: props.disabled, ...(name === 'TextInput' ? {readOnly: true, value: props.value} : {}),
    }, props.children),
  ]));
  native.StyleSheet = {create: value => value};
  native.Animated = {View: native.View, Value: class {interpolate() {return '0%';}}};
  let index = 0;
  const imports = {
    react: React, 'react/jsx-runtime': jsx, 'react-native': native,
    './StickyBottomBar':{StickyBottomBar:({children})=>children}, './Button': buttonModule(React, native, jsx), './api': api, './india': india,
    './session': {useSession: () => ({account: {account_type: role}, token: 'fixture-token'})},
    './useResource': {useResource: () => ({state: states[index++]})},
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', compiled)(key => imports[key], module, module.exports);
  return renderToStaticMarkup(React.createElement(module.exports[name], {
    api: new api.ApiClient('http://example.test/api/v1'), token: 'fixture-token', editable,
  }));
}

test('personal profile is role-gated and displays the linked mobile without a mobile editor', () => {
  assert.match(render('PersonalProfile', []), /Sign in with a Personal account/);
  const html = render('PersonalProfile', [ready({mobile_e164: '+919800000071'})], 'PERSONAL');
  assert.match(html, /Account mobile: \+919800000071/);
  assert.match(html, /Save personal profile/);
  assert.doesNotMatch(html, /aria-label="Account mobile"/);
});

test('dealer declarations distinguish empty brands and suggestions from authorization', () => {
  const html = render('DealerDeclarations', [
    ready({category_options: ['Electrical', 'Other'], categories: [], brands: []}),
    ready(emptyPage), ready(emptyPage),
  ]);
  assert.match(html, /Electrical/);
  assert.match(html, /No matching catalogue brands/);
  assert.match(html, /Company authorization is managed separately/);
  assert.match(html, /No brand suggestions/);
});

test('contact progress is server-driven and saving is disabled before consent', () => {
  const html = render('DealerContacts', [ready({...emptyPage, minimum_required: 10})]);
  assert.match(html, /0 of 10 added/);
  assert.match(html, /Build your electrician &amp; contractor network/);
  assert.match(html, /I have permission from this person to share their business contact details/);
  const saveButton = [...html.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/g)].find(([button]) => button.includes('Save contact'));
  assert.ok(saveButton);
  assert.match(saveButton[0], /<button\b[^>]*disabled=""/);
  assert.match(render('DealerContacts', [{status: 'error', message: 'Network unavailable'}]), /Network unavailable/);
});

test('the completed contacts milestone replaces progress without implying automatic verification', () => {
  const below = render('DealerContacts', [ready({...emptyPage, count: 9, minimum_required: 10})]);
  assert.match(below, /9 of 10 added/);
  assert.doesNotMatch(below, /Network Milestone Completed/);
  for (const count of [10, 11]) {
    const html = render('DealerContacts', [ready({...emptyPage, count, minimum_required: 10})]);
    assert.match(html, /Network Milestone Completed/);
    assert.match(html, new RegExp(count + ' of 10 contacts added'));
    assert.match(html, /Approval still requires staff review/);
    assert.doesNotMatch(html, /Trade-worker contacts/);
  }
});
