import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from '../../mobile/node_modules/typescript/lib/typescript.js';
import * as api from '../src/api.ts';
import * as india from '../src/india.ts';

const requireAdmin = createRequire(import.meta.url);
const React = requireAdmin('react');
const {renderToStaticMarkup} = requireAdmin('react-dom/server');
const compiled = ts.transpileModule(readFileSync(new URL('../src/DealerOnboarding.tsx', import.meta.url), 'utf8'), {
  compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
}).outputText;

function render(canReviewContacts) {
  const fixture = {
    profile: {legal_name: 'Fixture dealer', registered_address: 'Registered address fixture'},
    declarations: {categories: ['Electrical'], brands: []},
    suggestions: [{id: 1, name: 'Review fixture', status: 'PENDING'}],
    duplicates: [], reviews: [],
  };
  let stateIndex = 0;
  const imports = {
    react: {...React, useState: value => React.useState(stateIndex++ === 0 ? fixture : value)},
    'react/jsx-runtime': requireAdmin('react/jsx-runtime'), './api': api, './india': india,
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', compiled)(key => imports[key], module, module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default, {id: 9, canReviewContacts, baseUrl: '/api/v1', token: 'fixture'}));
}

test('staff review renders private contact access only with the dedicated permission', () => {
  const without = render(false);
  assert.match(without, /Registered address fixture/);
  assert.match(without, /Map to existing brand/);
  assert.doesNotMatch(without, /Load private contacts/);
  assert.match(render(true), /Load private contacts/);
});
