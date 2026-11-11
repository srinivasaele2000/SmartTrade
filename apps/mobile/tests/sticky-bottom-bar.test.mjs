import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/StickyBottomBar.tsx', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}});

test('sticky actions clear the system navigation inset and keep padding when there is no inset', () => {
  let bottom = 48;
  const imports = {
    'react/jsx-runtime': {jsx: (_element, props) => props},
    'react-native': {View: 'View', StyleSheet: {create: value => value}},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom})},
  };
  const exports = {};
  new Function('require', 'exports', outputText)(name => imports[name], exports);
  const render = () => exports.StickyBottomBar({children: 'Save'});
  assert.equal(render().style[1].paddingBottom, 56);
  bottom = 0;
  assert.equal(render().style[1].paddingBottom, 16);
  assert.equal(render().children, 'Save');
  assert.equal(exports.StickyBottomBar({children: 'Submit', clearance: 22}).style[1].paddingBottom, 22);
  bottom = 48;
  assert.equal(exports.StickyBottomBar({children: 'Submit', clearance: 22}).style[1].paddingBottom, 70);
});
