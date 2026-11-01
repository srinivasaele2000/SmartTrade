import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as company from '../src/company.ts';
import * as api from '../src/api.ts';

// Reuse the monorepo's existing matching React/ReactDOM installations. Render
// the actual TSX component with native host adapters and isolated API fixtures;
// this is a headless render test, not an Android interaction test.
const requireAdmin = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = requireAdmin('react');
const { renderToStaticMarkup } = requireAdmin('react-dom/server');
const jsx = requireAdmin('react/jsx-runtime');
const source = readFileSync(new URL('../src/CompanyScreen.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const base = { company: { ...company.blankProfile(), id: 1, legal_name: 'Controlled fixture', company_email: 'company@example.test', verification_state: 'PENDING', activity_state: 'ACTIVE', email_verified_at: null, can_publish_catalogue: false }, verification: { document_policy: { configured: true, required_types: ['REGISTRATION'], allowed_mime_types: ['application/pdf'], max_bytes: 1024 }, documents: [], application: null, missing_document_types: ['REGISTRATION'], email_provider_configured: true, email_verification_mode: 'development_email', email_ready: false, can_verify_email: true, can_edit: true, can_upload: true, can_submit: false, can_request_review: false, review_requests: [] } };
function render({ role = 'COMPANY', tab = 'Dashboard', state = {status:'ready',data:base}, refSlot } = {}) {
 const native = {};
 for (const name of ['Text', 'View', 'ScrollView', 'Pressable', 'TextInput', 'ActivityIndicator']) native[name] = props => React.createElement(name === 'Pressable' ? 'button' : name === 'TextInput' ? 'input' : 'div', { disabled: props.disabled, 'aria-label': props.accessibilityLabel, ...(name === 'TextInput' ? { value: props.value, readOnly: !props.editable } : {}) }, props.children);
 native.StyleSheet = { create: value => value };
 const imports = { './CompanyAuthorizations': {default:()=>React.createElement('div',null,'Company dealer authorization workspace')}, './CompanyCatalogue': {default:()=>React.createElement('div',null,'Company catalogue workspace')}, react: {...React,useRef:value=>refSlot??React.useRef(value),useState:value=>React.useState(value==='Dashboard'?tab:value)}, 'react/jsx-runtime':jsx, 'react-native':native, './company':company, './api':api, 'expo-document-picker':{getDocumentAsync(){throw new Error('Native picker not invoked in render test');}}, './session':{useSession:()=>({account:{account_type:role},token:'isolated-test-token',clearSession(){}})}, './useResource':{useResource:()=>({state,retry(){}})} };
 const module={exports:{}};
 new Function('require','module','exports',compiled)(name=>{if(!(name in imports))throw new Error(name);return imports[name];},module,module.exports);
 return renderToStaticMarkup(React.createElement(module.exports.default,{api:new api.ApiClient('http://example.test/api/v1')}));
}
test('company component enforces role and has loading, failure and registration states',()=>{
 assert.match(render({role:'PERSONAL'}),/active COMPANY account/);
 assert.match(render({state:{status:'loading'}}),/Loading company status/);
 assert.match(render({state:{status:'error',message:'Connection failed'}}),/Retry company request/);
 assert.match(render({state:{status:'ready',data:null}}),/Complete company registration/);
});
test('email simulation is visibly labelled and does not claim ownership verification',()=>{
 const html=render({tab:'Email'});assert.match(html,/LOCAL SIMULATION/);assert.match(html,/Start local email simulation/);assert.match(html,/does not verify real email ownership/);
});
test('documents and application respect server policy and submission capabilities',()=>{
 assert.match(render({tab:'Documents'}),/Maximum file size: 1024/);
 assert.match(render({tab:'Application'}),/disabled=""[^>]*>.*?Submit verification application/);
 const restricted=structuredClone(base);restricted.company.activity_state='SUSPENDED';restricted.verification.can_request_review=true;
 assert.match(render({tab:'Application',state:{status:'ready',data:restricted}}),/Restricted review request/);
 assert.match(render({state:{status:'ready',data:restricted}}),/Your account is not automatically blocked/);
});

test('token-refresh loading retains catalogue workspace; failed refresh does not reuse permission context',()=>{
 const refSlot={current:null};
 assert.match(render({tab:'Catalogue',refSlot}),/Company catalogue workspace/);
 assert.match(render({tab:'Catalogue',state:{status:'loading'},refSlot}),/Company catalogue workspace/);
 assert.doesNotMatch(render({tab:'Catalogue',state:{status:'error',message:'Permission denied'},refSlot}),/Company catalogue workspace/);
});

test('dealer authorization workspace also survives token-refresh loading',()=>{
 const refSlot={current:null};assert.match(render({tab:'Dealers',refSlot}),/Company dealer authorization workspace/);assert.match(render({tab:'Dealers',refSlot,state:{status:'loading'}}),/Company dealer authorization workspace/);assert.doesNotMatch(render({tab:'Dealers',refSlot,state:{status:'error',message:'Denied'}}),/Company dealer authorization workspace/);
});
