import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as catalogue from '../src/company-catalogue.ts';
import * as api from '../src/api.ts';

// Reuse the monorepo's existing matching React/ReactDOM installations. Render
// the actual TSX component with native host adapters and isolated API fixtures;
// this is a headless render test, not an Android interaction test.
const requireAdmin = createRequire(new URL('../../admin/package.json', import.meta.url));
const React = requireAdmin('react');
const { renderToStaticMarkup } = requireAdmin('react-dom/server');
const jsx = requireAdmin('react/jsx-runtime');
const source = readFileSync(new URL('../src/CompanyCatalogue.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
let handlers={};let companyRefreshCount=0;
const readyOptions={status:'ready',data:{brands:[],associations:[],categories:[]}};
function render({tab='Brands',writable=true,options=readyOptions,products={status:'ready',data:{count:0,results:[],next:null,previous:null}}}={}){
 handlers={};companyRefreshCount=0;let call=0;const native={};for(const name of ['Text','View','ScrollView','Pressable','TextInput','ActivityIndicator'])native[name]=props=>{if(name==='Pressable')handlers[props.accessibilityLabel]=props.onPress;return React.createElement(name==='Pressable'?'button':name==='TextInput'?'input':'div',{disabled:props.disabled,'aria-label':props.accessibilityLabel,...(name==='TextInput'?{value:props.value,readOnly:true}:{})},props.children);};native.StyleSheet={create:value=>value};
 const imports={react:{...React,useState:value=>React.useState(value==='Brands'?tab:value)},'react/jsx-runtime':jsx,'react-native':native,'./api':api,'./company-catalogue':catalogue,'./useResource':{useResource:()=>({state:call++===0?options:products,retry(){}})}};const module={exports:{}};new Function('require','module','exports',compiled)(name=>{if(!(name in imports))throw new Error(name);return imports[name];},module,module.exports);
 return renderToStaticMarkup(React.createElement(module.exports.default,{api:new api.ApiClient('http://example.test/api/v1'),token:'isolated-token',writable,expired(){},refreshCompany(){companyRefreshCount++;}}));
}
test('actual catalogue component exposes brand form, empty and restricted states',()=>{
 assert.match(render(),/Create brand/);assert.match(render(),/No brands yet/);assert.match(render({writable:false}),/Read-only: a verified, active company/);assert.match(render({writable:false}),/disabled=""[^>]*>.*?Create brand/);
});
test('actual catalogue loading/error/retry and categories states are distinct',()=>{
 assert.match(render({options:{status:'loading'}}),/Loading catalogue options/);assert.match(render({options:{status:'error',message:'Offline'}}),/Retry catalogue options/);assert.match(render({tab:'Categories'}),/No active categories/);
});
test('product editor displays supported fields and does not invent image upload',()=>{
 const html=render({tab:'Products'});assert.match(html,/No products match/);assert.match(html,/Specifications \(JSON object\)/);assert.match(html,/PUBLISHED/);assert.match(html,/Product images are not supported/);
});

test('manual catalogue refresh also reloads authoritative company eligibility',()=>{
 render();handlers['Refresh catalogue']();assert.equal(companyRefreshCount,1);
});
