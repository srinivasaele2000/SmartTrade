import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const jsx = (type, props) => ({type, props});
const source = readFileSync(new URL('../src/DealerCatalogueBrowser.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
}}).outputText;

function fixture(platform = 'android', groups = []) {
  const states = [], refs = [], effects = [], requests = [], loaders = [], pages = [];
  let stateIndex, refIndex, historyIndex;
  let text = '';
  let hardwareBack;
  const products = [
    {id: 1, name: 'Anchor switch', brand: '7', category: '2', series: 'roma'},
    {id: 2, name: 'Other cable', brand: '8', category: '3'},
  ];
  const brands = [
    {id: 7, name: 'ANCHOR', categories: [{id: 2, name: 'Switchgear'}]},
    {id: 8, name: 'Other', categories: [{id: 3, name: 'Cables'}]},
  ];
  const categories = [{id: 2, name: 'Switchgear', active: true}, {id: 3, name: 'Cables', active: true}];
  const page = results => ({results, count: results.length, next: null, previous: null});
  const api = {
    brands: async filters => page(brands.filter(b => !filters.category || b.categories.some(c => String(c.id) === filters.category))),
    categories: async () => page(categories),
  };
  const react = {
    useCallback: callback => callback,
    useEffect: callback => effects.push(callback),
    useRef(initial) {const slot = refIndex++; return refs[slot] ??= {current: initial};},
    useState(initial) {
      const slot = stateIndex++;
      if (!(slot in states)) states[slot] = initial;
      return [states[slot], value => {states[slot] = typeof value === 'function' ? value(states[slot]) : value;}];
    },
  };
  const native = new Proxy({
    StyleSheet: {create: value => value}, Platform: {OS: platform},
    useWindowDimensions: () => ({width: 390}),
    BackHandler: {addEventListener(_event, callback) {hardwareBack = callback; return {remove() {}};}},
  }, {get: (value, name) => value[name] ?? name});
  const imports = {
    react, 'react-native': native, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'},
    'lucide-react-native': new Proxy({}, {get: () => 'Icon'}),
    './trade-theme': {trade: {}, tradeType: {}},
    './Button': {Button: props => jsx('Button', props)},
    './HistoryPager': {HistoryPager: () => null},
    './useResource': {useResource: () => ({state: {status: 'ready', data: {count: 2, sub_categories: groups}}})},
    './useDebouncedSearch': {useDebouncedSearch: () => ({
      text, query: text.trim(), change(value) {text = value;}, submit() {}, pending: false,
    })},
    './useHistoryPage': {useHistoryPage(loader) {
      const slot = historyIndex++;
      loaders[slot] = loader;
      return {state: {status: 'ready', data: pages[slot] ?? page([])}, retry() {}};
    }},
    './dealer-estimates': {async estimatePage(_api, path) {
      requests.push(path);
      const filters = new URL(path, 'http://example.test').searchParams;
      return page(products.filter(p =>
        (!filters.get('sub_category') || p.series === filters.get('sub_category')) &&
        (!filters.get('brand') || p.brand === filters.get('brand')) &&
        (!filters.get('category') || p.category === filters.get('category')) &&
        (!filters.get('search') || p.name.toLowerCase().includes(filters.get('search').toLowerCase())),
      ));
    }},
  };
  const exports = {};
  new Function('require', 'exports', compiled)(name => imports[name], exports);
  let nodes;
  function render() {
    stateIndex = refIndex = historyIndex = 0;
    effects.length = 0;
    nodes = [];
    function visit(node) {
      if (Array.isArray(node)) node.forEach(visit);
      else if (node && typeof node === 'object') {
        if (typeof node.type === 'function') visit(node.type(node.props));
        else {nodes.push(node); visit(node.props?.children);}
      }
    }
    visit(exports.default({api, token: 'fixture', renderItems: rows => rows.map(row => jsx('Product', {name: row.name}))}));
  }
  async function refresh() {
    render();
    await Promise.all(loaders.map(async (loader, slot) => {pages[slot] = await loader(1, new AbortController().signal);}));
    render();
  }
  return {
    refresh, requests, effects,
    get: label => nodes.find(node => node.props?.title === label || node.props?.accessibilityLabel === label),
    products: () => nodes.filter(node => node.type === 'Product').map(node => node.props.name),
    back: () => hardwareBack(),
  };
}

test('dealer landing loads choices without fetching the product catalogue', async () => {
  const app = fixture();
  await app.refresh();
  assert.ok(app.get('Browse ANCHOR'));
  assert.ok(app.get('Browse Switchgear'));
  assert.deepEqual(app.products(), []);
  assert.deepEqual(app.requests, []);
});

test('brand drill-down filters items and hardware back restores the landing cards', async () => {
  const app = fixture();
  await app.refresh();
  app.get('Browse ANCHOR').props.onPress();
  await app.refresh();
  assert.deepEqual(app.products(), ['Anchor switch']);
  assert.match(app.requests.at(-1), /brand=7/);
  assert.ok(app.get('Switchgear'));
  assert.equal(app.get('Cables'), undefined);
  app.effects[0]();
  assert.equal(app.back(), true);
  await app.refresh();
  assert.ok(app.get('Browse ANCHOR'));
  assert.deepEqual(app.products(), []);
});

test('category drill-down scopes brands and the back button resets filters', async () => {
  const app = fixture();
  await app.refresh();
  app.get('Browse Cables').props.onPress();
  await app.refresh();
  assert.deepEqual(app.products(), ['Other cable']);
  assert.ok(app.get('Other'));
  assert.equal(app.get('ANCHOR'), undefined);
  app.get('Back to Brands & Categories').props.onPress();
  await app.refresh();
  assert.ok(app.get('Browse Switchgear'));
});

test('typing on landing searches all catalogue items without a card selection', async () => {
  const app = fixture();
  await app.refresh();
  app.get('Search catalogue items').props.onChangeText('cable');
  await app.refresh();
  assert.deepEqual(app.products(), ['Other cable']);
  const params = new URL(app.requests.at(-1), 'http://example.test').searchParams;
  assert.equal(params.get('search'), 'cable');
  assert.equal(params.get('brand'), '');
  assert.equal(params.get('category'), '');
});


test('browser Back returns from the product view without leaving the dealer home', async () => {
  const original = globalThis.window;
  let listener;
  const entries = [null];
  const history = {
    get state() {return entries.at(-1);},
    pushState(value) {entries.push(value);},
    back() {entries.pop();},
  };
  globalThis.window = {
    history,
    addEventListener(name, callback) {assert.equal(name, 'popstate'); listener = callback;},
    removeEventListener() {},
  };
  try {
    const app = fixture('web', [{id: 'roma', count: 1}, {id: 'penta', count: 1}]);
    await app.refresh();
    app.get('Browse ANCHOR').props.onPress();
    await app.refresh();
    const cleanup = app.effects[0]();
    assert.match(history.state.dealerCatalogue, /^smarttrade-catalogue-/);
    app.get('Browse ROMA').props.onPress();
    await app.refresh();
    app.effects[1]();
    assert.equal(history.state.catalogueDepth, 2);
    history.back();
    listener();
    await app.refresh();
    assert.ok(app.get('Browse ROMA'));
    assert.equal(history.state.catalogueDepth, 1);
    history.back();
    listener();
    cleanup();
    await app.refresh();
    assert.ok(app.get('Browse ANCHOR'));
    assert.deepEqual(app.products(), []);
  } finally {
    if (original === undefined) delete globalThis.window;
    else globalThis.window = original;
  }
});


test('brand search composes with the category and Browse All Items is an explicit choice', async () => {
  const app = fixture();
  await app.refresh();
  app.get('Browse All Items').props.onPress();
  await app.refresh();
  assert.deepEqual(app.products(), ['Anchor switch', 'Other cable']);
  app.get('Back to Brands & Categories').props.onPress();
  await app.refresh();
  app.get('Browse ANCHOR').props.onPress();
  await app.refresh();
  app.get('Switchgear').props.onPress();
  app.get('Search catalogue items').props.onChangeText('switch');
  await app.refresh();
  const params = new URL(app.requests.at(-1), 'http://example.test').searchParams;
  assert.deepEqual(Object.fromEntries(params), {search: 'switch', brand: '7', category: '2'});
  assert.deepEqual(app.products(), ['Anchor switch']);
  app.get('Back to Brands & Categories').props.onPress();
  await app.refresh();
  assert.ok(app.get('Browse ANCHOR'));
  assert.equal(app.get('Search catalogue items').props.value, '');
});


test('brand opens multiple sub-categories before fetching items and Back steps through each level', async () => {
  const app = fixture('android', [{id: 'roma', count: 1}, {id: 'penta', count: 1}]);
  await app.refresh();
  app.get('Browse ANCHOR').props.onPress();
  await app.refresh();
  assert.ok(app.get('View All ANCHOR Items (2)'));
  assert.deepEqual(app.requests, []);
  app.get('Browse ROMA').props.onPress();
  await app.refresh();
  assert.match(app.requests.at(-1), /brand=7.*sub_category=roma/);
  assert.deepEqual(app.products(), ['Anchor switch']);
  app.effects[0]();
  assert.equal(app.back(), true);
  await app.refresh();
  assert.ok(app.get('Browse ROMA'));
  app.get('Back to Brands & Categories').props.onPress();
  await app.refresh();
  assert.ok(app.get('Browse ANCHOR'));
});

test('a single sub-category opens the complete parent product grid directly', async () => {
  const app = fixture('android', [{id: 'roma', count: 1}]);
  await app.refresh();
  app.get('Browse Switchgear').props.onPress();
  await app.refresh();
  assert.deepEqual(app.products(), ['Anchor switch']);
  assert.equal(app.get('Browse ROMA'), undefined);
});
