import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';

const jsx = createRequire(import.meta.url)('react/jsx-runtime');
const compiled = ts.transpileModule(readFileSync(new URL('../src/CatalogueVault.tsx', import.meta.url), 'utf8'),
  {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;

function fixture(requestApi = async () => {}) {
  const state = [];
  const calls = [];
  let hook = 0;
  const imports = {
    react: {
      useEffect() {}, useRef: () => ({current: null}),
      useState(initial) {
        const index = hook++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => {state[index] = value;}];
      },
    },
    'react/jsx-runtime': jsx,
    './api': {requestApi(...args) {calls.push(args); return requestApi(...args);},
      apiResponse: async () => ({blob: async () => new Blob(['%PDF'], {type: 'application/pdf'})})},
    './BusinessType': {catalogueBusinessTypes: {OTHER: 'Other'}, SUB_BUSINESS_TAXONOMY: {}},
    './india': {indianNumber: String, istDateTime: String},
    './CatalogueExtractionReview': {},
    './useAdminPage': {useAdminPage: () => ({
      data: {results: [{key: 'pdf-id', title: 'Electrical price list', filename: 'prices.pdf',
        business_type: 'OTHER', content_type: 'application/pdf', is_active: true}]},
      number: 1, reload() {calls.push('reload');},
    })},
  };
  const module = {exports: {}};
  new Function('require', 'module', 'exports', compiled)(name => imports[name], module, module.exports);
  function render() {
    hook = 0;
    const all = [];
    function visit(node) {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node?.props) {all.push(node); visit(node.props.children);}
    }
    visit(module.exports.default({baseUrl: '/api/v1', token: 'fixture', allowed: true}));
    return (type, label) => all.find(node => node.type === type && node.props.children === label)?.props;
  }
  return {render, calls, validate: module.exports.validateVaultFileSize};
}

test('Vault accepts 100 MB PDFs and keeps the 2 MB image limit', () => {
  const {validate} = fixture();
  const size = 100 * 1024 * 1024;
  validate({name: 'price.pdf', type: 'application/pdf', size});
  validate({name: 'price.PDF', type: '', size});
  assert.throws(() => validate({name: 'price.pdf', type: 'application/pdf', size: size + 1}), /100 MB/);
  assert.throws(() => validate({name: 'photo.png', type: 'image/png', size: 2 * 1024 * 1024 + 1}), /2 MB/);
});

test('permanent deletion requires confirmation and is distinct from archival', async () => {
  const {render, calls} = fixture();
  assert.equal(render()('button', 'Archive').className, 'btn-warning');
  const deleteButton = render()('button', 'Delete');
  assert.equal(deleteButton.className, 'btn-danger');
  deleteButton.onClick();
  assert.deepEqual(calls, []);
  assert.equal(render()('button', 'Cancel').className, 'btn-ghost');
  render()('button', 'Cancel').onClick();
  assert.equal(render()('button', 'Delete permanently'), undefined);
  deleteButton.onClick();
  render()('button', 'Delete permanently').onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [['/api/v1', '/admin/catalogues/pdf-id/delete/', 'fixture', {method: 'DELETE'}], 'reload']);
  assert.equal(render()('button', 'Delete permanently'), undefined);
});

test('preview links have visible action classes and a separate close control', async () => {
  const {render} = fixture();
  render()('button', 'Preview / download').onClick();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(render()('a', 'Download file').className, 'action-link-btn');
  assert.equal(render()('a', 'Open PDF in a new tab').className, 'action-link-btn');
  assert.equal(render()('button', 'Close preview').className, 'btn-ghost');
  URL.revokeObjectURL(render()('a', 'Download file').href);
});
