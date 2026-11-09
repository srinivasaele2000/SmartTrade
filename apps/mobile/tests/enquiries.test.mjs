import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import fs from 'node:fs';

const source=fs.readFileSync(new URL('../src/enquiries.ts',import.meta.url),'utf8');
test('mobile enquiry explanation includes downstream commercial workflow',()=>{
 const screen=fs.readFileSync(new URL('../src/EnquiryWorkspace.tsx',import.meta.url),'utf8');
 assert.match(screen,/An accepted quotation can become an order/);
 assert.match(screen,/Payment collection is not supported/);
 assert.doesNotMatch(screen,/no tax, delivery, order or payment is inferred/);
});
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const module={exports:{}};vm.runInNewContext(code,{module,exports:module.exports,require:(name)=>name==='./api'?class ApiError extends Error{}:{} });
const {createEnquiry,sendQuotation,respondQuotation}=module.exports;
const enquiry={id:4,items:[{id:10},{id:11}]};
const valid={id:4,items:[],quotations:[]};

test('buyer enquiry posts multiple listing quantities at one branch',async()=>{let call;const api={post:async(path,body)=>{call={path,body};return valid}};await createEnquiry(api,'token',[{listing:1,branch:2,quantity:'2',requirement:'red'},{listing:3,branch:2,quantity:'1.5',requirement:''}],'need soon','note');assert.equal(call.path,'/enquiries');assert.deepEqual(call.body.items.map(item=>item.listing),[1,3]);});
test('buyer enquiry rejects mixed branches and invalid quantities',async()=>{const api={post:async()=>valid};await assert.rejects(()=>createEnquiry(api,'t',[{listing:1,branch:2,quantity:'1',requirement:''},{listing:2,branch:3,quantity:'1',requirement:''}],'',''));await assert.rejects(()=>createEnquiry(api,'t',[{listing:1,branch:2,quantity:'0',requirement:''}],'',''));});
test('dealer quote is complete and INR-only',async()=>{let call;const api={post:async(path,body)=>{call={path,body};return valid}};const lines=[{enquiry_item:10,quantity:'2',unit_price:'100',currency:'INR',notes:''},{enquiry_item:11,quantity:'1',unit_price:'50',currency:'INR',notes:''}];await sendQuotation(api,'t',enquiry,lines,new Date(Date.now()+10000).toISOString(),'');assert.equal(call.path,'/businesses/me/enquiries/4/quotations');await assert.rejects(()=>sendQuotation(api,'t',enquiry,[{...lines[0],currency:'USD'}],new Date().toISOString(),''));});
test('quotation rejection requires a reason and uses response endpoint',async()=>{const api={post:async(path,body)=>{assert.equal(path,'/enquiries/4/response');assert.equal(body.action,'REJECT');return valid}};await assert.rejects(()=>respondQuotation(api,'t',4,'REJECT',''));await respondQuotation(api,'t',4,'REJECT','Budget changed');});
