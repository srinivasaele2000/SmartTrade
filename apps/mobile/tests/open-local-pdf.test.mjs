import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/open-local-pdf.ts', import.meta.url), 'utf8');
const {outputText} = ts.transpileModule(source, {compilerOptions: {module: ts.ModuleKind.CommonJS}});

test('Android opens the private PDF content URI with read permission', async () => {
  const privateUri = 'file:///private/invoice.pdf';
  const contentUri = 'content://test.fileprovider/invoice.pdf';
  const calls = [];
  const imports = {
    'react-native': {Platform: {OS: 'android'}},
    'expo-file-system/legacy': {getContentUriAsync: async (uri) => {
      assert.equal(uri, privateUri);
      return contentUri;
    }},
    'expo-intent-launcher': {startActivityAsync: async (...args) => { calls.push(args); }},
    'expo-sharing': {isAvailableAsync: () => assert.fail('Android must use the viewer')},
  };
  const exports = {};
  new Function('require', 'exports', outputText)(name => imports[name], exports);
  await exports.openLocalPdf(privateUri);
  assert.deepEqual(calls, [['android.intent.action.VIEW', {data: contentUri, type: 'application/pdf', flags: 1}]]);
});
