import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import * as india from '../src/india.ts';
import * as theme from '../src/trade-theme.ts';
import * as estimates from '../src/dealer-estimates.ts';

const jsx = (type, props) => ({type, props});
const native = new Proxy({StyleSheet: {create: styles => styles}}, {get: (value, name) => value[name] ?? name});
const base = {
  'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'}, 'react-native': native,
  './india': india, './trade-theme': theme, './Button': {Button: props => jsx('Button', props)},
};
function load(file, imports) {
  const source = readFileSync(new URL('../src/' + file + '.tsx', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, {compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  }}).outputText;
  const exports = {};
  new Function('require', 'exports', code)(name => imports[name] ?? {}, exports);
  return exports;
}
function flatten(tree) {
  if (Array.isArray(tree)) return tree.flatMap(flatten);
  if (!tree && tree !== 0) return [];
  if (typeof tree !== 'object') return [{type: 'text', props: {value: String(tree)}}];
  if (typeof tree.type === 'function') return flatten(tree.type(tree.props));
  return [tree, ...flatten(tree.props.children)];
}
const text = nodes => nodes.filter(node => node.type === 'text').map(node => node.props.value).join(' ').replace(/\s+/g, ' ');
const documents = load('TradeDocument', base);
const product = {product: 42, product_name: 'ZIVA 6A Switch', product_code: '68001',
  hsn_sac_code: '8536', unit_price: '100.0000', quantity: '2'};

test('estimate builder renders a tax grid and recalculates when draft quantity changes', () => {
  const state = ['Estimate', false, [product]];
  let index = 0;
  const react = {useCallback: callback => callback, useState(initial) {
    const slot = index++;
    if (!(slot in state)) state[slot] = initial;
    return [state[slot], value => {state[slot] = typeof value === 'function' ? value(state[slot]) : value;}];
  }};
  const {default: Screen} = load('DealerEstimateScreen', {
    ...base, react, './TradeDocument': documents, './dealer-estimates': estimates,
    './DealerWorkerContactsScreen': {onboardingStyles: {}},
    './GeneralItems': {default: () => null},
    'react-native-safe-area-context': {useSafeAreaInsets: () => ({bottom: 0})},
    './useDebouncedSearch': {useDebouncedSearch: () => ({text: '', query: ''})},
    './useHistoryPage': {useHistoryPage: () => ({state: {status: 'ready', data: {results: []}}})},
    './HistoryPager': {HistoryPager: () => null}, './StickyBottomBar': {StickyBottomBar: ({children}) => children},
  });
  const render = () => {index = 0; return flatten(Screen({api: {}, token: '', accountId: 1}));};
  let view = render();
  assert.match(text(view), /# Item Description & Code Qty Rate \(₹\) GST % Amount \(₹\)/);
  assert.match(text(view), /Total Qty \/ Item Subtotal 2 ₹200\.00/);
  view.find(node => node.props.accessibilityLabel === 'GST rate percentage').props.onChangeText('18');
  view = render();
  view.find(node => node.props.accessibilityLabel === 'Increase quantity for ZIVA 6A Switch').props.onPress();
  const updated = text(render());
  assert.match(updated, /Total Qty \/ Item Subtotal 3 ₹300\.00/);
  assert.match(updated, /CGST ₹27\.00 SGST ₹27\.00 Grand Total \(₹\) ₹354\.00/);
  assert.equal(documents.amountInWords('1234567.25'), 'Rupees Twelve Lakh Thirty Four Thousand Five Hundred Sixty Seven and Twenty Five Paise Only');
});

test('issued tax invoice renders the saved invoice metadata, HSN and tax amounts', () => {
  const {OrderInvoiceDocument} = load('OrderWorkspace', {...base, './TradeDocument': documents});
  const order = {buyer_id: 4, order_number: 'ORDER-1', items: [{id: 5, product_name: 'ZIVA Switch',
    product_code: '68001', quantity: '2', unit_price: '100', line_total: '200'}],
  invoice: {kind: 'TAX_INVOICE', invoice_number: 'INV-2026-8', issued_at: '2026-11-12T10:00:00Z',
    buyer_gstin: '29ABCDE1234F1Z5', supplier_name: 'Fixture Dealer', place_of_supply: 'Karnataka',
    subtotal: '200.00', discount_total: '0.00', taxable_total: '200.00', cgst_total: '18.00',
    sgst_total: '18.00', igst_total: '0.00', grand_total: '236.00',
    items: [{order_item: 5, hsn: '8536', tax_rate: '18', tax_mode: 'CGST_SGST'}]}};
  const result = text(flatten(OrderInvoiceDocument({order})));
  assert.match(result, /TAX INVOICE INV-2026-8.*Issued.*Bill To \/ Party Buyer #4 GSTIN 29ABCDE1234F1Z5/);
  assert.match(result, /Place of supply Karnataka.*Supplier Fixture Dealer/);
  assert.match(result, /Code: 68001 \| HSN: 8536 2 ₹100\.00 18% ₹200\.00/);
  assert.match(result, /CGST ₹18\.00 SGST ₹18\.00 Grand Total \(₹\) ₹236\.00/);
});
