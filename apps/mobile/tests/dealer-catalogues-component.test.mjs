import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as onboarding from '../src/dealer-onboarding.ts';
import * as india from '../src/india.ts';

const requireAdmin = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = requireAdmin('react');
const {renderToStaticMarkup} = requireAdmin('react-dom/server');
const jsx = requireAdmin('react/jsx-runtime');
const source = readFileSync(new URL('../src/DealerCataloguesScreen.tsx', import.meta.url), 'utf8');
const code = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
}}).outputText;

function render(state) {
  const host = props => React.createElement('div', {'aria-label': props.accessibilityLabel}, props.children);
  const imports = {
    react: React, 'react/jsx-runtime': jsx,
    'react-native': {ActivityIndicator: host, Text: host, View: host, ScrollView: host, StyleSheet: {create: value => value}},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 24})},
    'expo-image': {Image: host}, 'lucide-react-native': {FileText: host, ImageIcon: host},
    './Button': {Button: props => React.createElement('button', {disabled: props.disabled}, props.title)},
    './DealerWorkerContactsScreen': {onboardingStyles: {}}, './dealer-onboarding': onboarding,
    './india': india, './local-files': {}, './open-local-pdf': {},
    './useHistoryPage': {useHistoryPage: () => ({state, page: 1})},
  };
  const exports = {};
  new Function('require', 'exports', code)(name => imports[name], exports);
  return renderToStaticMarkup(React.createElement(exports.default, {type: 'PLUMBING'}));
}

test('targeted catalogue renders loading, retry, empty and real document metadata distinctly', () => {
  const page = {next: null, previous: null, count: 0, results: []};
  assert.match(render({status: 'loading'}), /Loading brand catalogues/);
  assert.match(render({status: 'error', message: 'Unavailable'}), /Unavailable.*Retry/);
  assert.match(render({status: 'ready', data: page}), /Plumbing catalogues.*No catalogues yet/);
  const item = {key: 'fixture-key', brand_name: 'Fixture brand', title: 'Trade list', content_type: 'application/pdf',
    file_size_bytes: 2_400_000, created_at: '2026-11-10T12:00:00Z'};
  const html = render({status: 'ready', data: {...page, count: 1, results: [item]}});
  assert.match(html, /Fixture brand.*Trade list.*PDF • 2.4 MB.*10-11-2026 17:30 IST.*View Catalogue/);
  assert.doesNotMatch(html, /No catalogues yet/);
});
