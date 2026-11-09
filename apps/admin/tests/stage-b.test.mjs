import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import ts from 'typescript';
import * as api from '../src/api.ts';
import * as india from '../src/india.ts';
const require=createRequire(import.meta.url), React=require('react'), jsx=require('react/jsx-runtime');
const {renderToStaticMarkup}=require('react-dom/server');
function render(file,permissions){
 const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const module={exports:{}};const imports={react:React,'react/jsx-runtime':jsx,'./api':api,'./india':india};
 new Function('require','module','exports',compiled)(name=>imports[name],module,module.exports);
 return renderToStaticMarkup(React.createElement(module.exports.default,{baseUrl:'/api/v1',token:'test',permissions}));
}
test('audit hub enforces permission and exposes available sources without claiming exhaustive coverage',()=>{
 assert.match(render('AuditHistory.tsx',[]),/READ_AUDIT permission is required/);
 const html=render('AuditHistory.tsx',['READ_AUDIT']);
 for(const label of ['Catalogue','Dealer authorization','Dealer listings','Loading audit history','not an exhaustive platform log']) assert.ok(html.includes(label));
 assert.doesNotMatch(html,/not implemented/);
});
test('enquiry explanation scopes read-only restriction to admin and describes downstream orders',()=>{
 const html=render('Enquiries.tsx',['READ_REPORTS']);
 assert.match(html,/This admin page is read-only/);
 assert.match(html,/Accepted quotations can become orders and invoices/);
 assert.doesNotMatch(html,/This workflow does not create orders/);
});
