import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as api from '../src/api.ts';
import * as dealer from '../src/dealer.ts';
import * as india from '../src/india.ts';
import * as resource from '../src/resource.ts';

function load(file, imports) {
  const code = ts.transpileModule(readFileSync(new URL('../src/' + file, import.meta.url), 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX},
  }).outputText;
  const module = {exports: {}};
  new Function('require', 'module', 'exports', code)(name => {
    assert.ok(name in imports, name);
    return imports[name];
  }, module, module.exports);
  return module.exports;
}

// Run the actual component and resource effects with persistent hook slots per
// mounted element. Removing a child drops its state, just as a React unmount does.
function workspace() {
  const instances = new Map(), effects = [], pending = [];
  let slots, index, token = 'initial', nodes;
  const account = {id: 7, account_type: 'BUSINESS'};
  const revalidateSession = () => {};
  const jsx = (type, props, key) => ({type, props, key});
  function memo(value, deps) {
    const i = index++;
    const previous = slots[i];
    if (previous && deps && deps.length === previous.deps?.length && deps.every((item, n) => Object.is(item, previous.deps[n]))) {
      return previous;
    }
    return slots[i] = {value, deps, changed: true, cleanup: previous?.cleanup};
  }
  const React = {
    useState(initial) {
      const i = index++;
      const owner = slots;
      if (!(i in owner)) owner[i] = typeof initial === 'function' ? initial() : initial;
      return [owner[i], next => {owner[i] = typeof next === 'function' ? next(owner[i]) : next;}];
    },
    useRef(value) {return React.useState(() => ({current: value}))[0];},
    useReducer(reducer, initial) {
      const [value, set] = React.useState(initial);
      return [value, action => set(previous => reducer(previous, action))];
    },
    useCallback(fn, deps) {return memo(fn, deps).value;},
    useEffect(effect, deps) {
      const entry = memo(effect, deps);
      if (!entry.changed) return;
      entry.changed = false;
      effects.push(() => {entry.cleanup?.(); entry.cleanup = effect();});
    },
  };
  const native = {StyleSheet: {create: styles => styles}};
  for (const name of ['View','Text','ScrollView','ActivityIndicator','TextInput']) native[name] = name;
  const imports = {
    react: React, 'react/jsx-runtime': {jsx, jsxs: jsx, Fragment: 'fragment'}, 'react-native': native,
    './Button': {Button: props => jsx('button', props)},
    './api': api, './india': india, './dealer': dealer, './resource': resource,
    './session': {useSession: () => ({account, token, revalidateSession})},
    './LocalFileVault': {default: () => null},
  };
  imports['./useResource'] = load('useResource.ts', imports);
  imports['./Onboarding'] = load('Onboarding.tsx', imports);
  const Component = load('DealerWorkspace.tsx', imports).default;
  const brand = {id: 1, name: 'Fixture brand', company_name: 'Fixture company'};
  const profile = legal_name => ({
    id: 1, legal_name, owner_name: 'Server owner', registration_number: '', gstin: '', pan: '', verification_state: 'VERIFIED',
    workspace: {can_edit: true, can_manage_listings: true, can_publish_branches: true, authorizations: []},
  });
  const choices = {category_options: ['Electrical', 'Other'], categories: [], brands: []};
  const client = {
    get(path, signal, auth) {
      if (auth === 'rotated' && (path === '/businesses/me' || path.endsWith('/declarations'))) {
        return new Promise((resolve, reject) => pending.push({path, resolve, reject, signal}));
      }
      if (path === '/businesses/me') return Promise.resolve(profile('Original business name'));
      if (path.endsWith('/declarations')) return Promise.resolve(choices);
      return Promise.resolve({count: 0, next: null, previous: null, results: path.includes('declaration-brands') ? [brand] : []});
    },
  };
  function render() {
    const mounted = new Set();
    nodes = [];
    function walk(node, path) {
      if (Array.isArray(node)) return node.forEach((child, i) => walk(child, path + '.' + i));
      if (!node || typeof node !== 'object') return;
      if (typeof node.type === 'function') {
        const key = path + ':' + node.type.name + ':' + (node.key ?? '');
        mounted.add(key);
        if (!instances.has(key)) instances.set(key, []);
        slots = instances.get(key);
        index = 0;
        return walk(node.type(node.props), key);
      }
      nodes.push(node);
      walk(node.props.children, path + '.child');
    }
    walk(jsx(Component, {api: client}), 'root');
    for (const [key, hooks] of instances) {
      if (!mounted.has(key)) {
        hooks.forEach(hook => hook?.cleanup?.());
        instances.delete(key);
      }
    }
    effects.splice(0).forEach(effect => effect());
  }
  async function settle() {
    for (let i = 0; i < 4; i++) {
      render();
      await new Promise(resolve => setImmediate(resolve));
    }
  }
  return {
    settle, pending, choices, profile,
    rotate() {token = 'rotated';},
    button(title) {return nodes.find(node => node.type === 'button' && node.props.title === title)?.props;},
    input(label) {return nodes.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === label)?.props;},
  };
}

test('Dealer workspace preserves category, brand and suggestion drafts through token refetch and recovery', async () => {
  const h = workspace();
  await h.settle();
  h.button('Declarations').onPress();
  await h.settle();
  h.button('Electrical').onPress();
  h.button('Fixture brand · Fixture company').onPress();
  h.input('Suggested brand name').onChangeText('Unsaved brand');
  h.input('Context (optional)').onChangeText('Unsaved context');
  const expectDraft = () => {
    assert.equal(h.button('Electrical')?.selected, true);
    assert.equal(h.button('Fixture brand · Fixture company')?.selected, true);
    assert.equal(h.input('Suggested brand name')?.value, 'Unsaved brand');
    assert.equal(h.input('Context (optional)')?.value, 'Unsaved context');
  };
  await h.settle();
  expectDraft();

  h.rotate();
  await h.settle();
  assert.equal(h.pending.length, 2, 'Profile and declarations should refetch with the rotated token');
  expectDraft();
  h.pending[0].reject(Error('Offline'));
  h.pending[1].resolve({...h.choices, categories: ['Other']});
  await h.settle();
  expectDraft();
  assert.equal(h.button('Save declarations').disabled, true);

  h.button('Retry dealer workspace').onPress();
  await h.settle();
  h.pending[2].resolve(h.profile('Refetched dealer'));
  await h.settle();
  expectDraft();
  assert.equal(h.button('Save declarations').disabled, false);
});

test('Dealer profile refetch preserves edited identity fields and updates a clean field group', async () => {
  const h = workspace();
  await h.settle();
  h.button('Profile').onPress();
  await h.settle();
  assert.equal(h.input('Business legal name').value, 'Original business name');
  h.input('Business legal name').onChangeText('Unsaved legal name');
  h.rotate();
  await h.settle();
  assert.equal(h.input('Business legal name').value, 'Unsaved legal name');
  h.pending.forEach(request => request.resolve({...h.profile('Server legal name'), owner_name: 'Updated server owner'}));
  await h.settle();
  assert.equal(h.input('Business legal name').value, 'Unsaved legal name');
  assert.equal(h.input('Owner or authorized person').value, 'Updated server owner');
});
