import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as catalogue from '../src/company-catalogue.ts';
import * as authorizations from '../src/company-authorizations.ts';
import * as api from '../src/api.ts';

// Reuse the monorepo's existing matching React/ReactDOM installations. Render
// the actual TSX component with native host adapters and isolated API fixtures;
// this is a headless render test, not an Android interaction test.
const requireAdmin = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = requireAdmin('react');
const { renderToStaticMarkup } = requireAdmin('react-dom/server');
const jsx = requireAdmin('react/jsx-runtime');
const source = readFileSync(new URL('../src/CompanyAuthorizations.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
function render({tab='Dealers',writable=true,state={status:'ready',data:{count:0,results:[],next:null,previous:null}},brands={status:'ready',data:{brands:[]}}}={}){let call=0;const native={};for(const name of ['Text','View','ScrollView','Pressable','TextInput','ActivityIndicator'])native[name]=props=>React.createElement(name==='Pressable'?'button':name==='TextInput'?'input':'div',{disabled:props.disabled,'aria-label':props.accessibilityLabel,...(name==='TextInput'?{value:props.value,readOnly:true}:{})},props.children);native.StyleSheet={create:value=>value};const imports={react:{...React,useState:value=>React.useState(value==='Dealers'?tab:value)},'react/jsx-runtime':jsx,'react-native':native,'./api':api,'./company-catalogue':catalogue,'./company-authorizations':authorizations,'./useResource':{useResource:()=>({state:call++===0?brands:state,retry(){}})}};const module={exports:{}};new Function('require','module','exports',compiled)(name=>{if(!(name in imports))throw new Error(name);return imports[name];},module,module.exports);return renderToStaticMarkup(React.createElement(module.exports.default,{api:new api.ApiClient('http://example.test/api/v1'),token:'isolated-token',writable,expired(){},refreshCompany(){}}));}
test('company authorization component distinguishes loading, errors, empty and restricted access',()=>{assert.match(render(),/No eligible dealers/);assert.match(render({state:{status:'loading'}}),/Loading authorization records/);assert.match(render({state:{status:'error',message:'Offline'}}),/Retry authorization records/);assert.match(render({writable:false}),/Read-only/);});
test('authorization records show actual company, dealer, revoked state and eligibility',()=>{const grant={id:1,brand:2,brand_name:'Fixture Brand',company_name:'Fixture Company',business_name:'Fixture Dealer',business:3,active:false,eligible:false,company_verification_state:'VERIFIED',company_activity_state:'ACTIVE',business_verification_state:'VERIFIED',reason:'Test revocation',updated_at:'2026-11-01'};const html=render({tab:'Authorizations',state:{status:'ready',data:{count:1,results:[grant],next:null,previous:null}}});assert.match(html,/Revoked/);assert.match(html,/Fixture Company/);assert.match(html,/Fixture Dealer/);assert.match(html,/Reauthorize Fixture Brand/);assert.match(html,/Test revocation/);});
