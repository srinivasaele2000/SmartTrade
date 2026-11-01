import test from 'node:test';import assert from 'node:assert/strict';
import { ApiClient } from '../src/api.ts';
import { emptyProduct, productPayload, variantPayload, catalogueOptions, cataloguePage, catalogueWrite } from '../src/company-catalogue.ts';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
test('product payload includes only writable canonical fields and validates price/JSON',()=>{
 const form={...emptyProduct(),name:' Product ',code:'CODE',unit:'piece',specifications:'{"size":"large"}'};
 assert.equal(productPayload(form,8).brand_category,8);assert.equal(productPayload(form).name,'Product');assert.equal(productPayload(form).catalogue_price,null);
 assert.equal('brand_category' in productPayload(form),false);
 for(const change of [{name:''},{specifications:'[]'},{specifications:'invalid'},{catalogue_price:'1',currency:''},{catalogue_price:'-1',currency:'USD'},{catalogue_price:'1.12345',currency:'USD'},{catalogue_price:'1',currency:'usd'}])assert.throws(()=>productPayload({...form,...change}));
 assert.equal(productPayload({...form,catalogue_price:'12.5000',currency:'USD'}).catalogue_price,'12.5000');
});
test('variant validation preserves per-product identity and explicit active state',()=>{
 const value=variantPayload({name:' Large ',sku:'SKU-1',attributes:'{"size":"large"}',active:false});assert.deepEqual(value,{name:'Large',sku:'SKU-1',attributes:{size:'large'},active:false});assert.equal('product' in value,false);
 assert.throws(()=>variantPayload({name:'A',sku:'',attributes:'{}',active:true}));assert.throws(()=>variantPayload({name:'A',sku:'S',attributes:'[]',active:true}));
});
test('options paginate using local numeric paths without following arbitrary next URLs',async()=>{
 const calls=[];const api=new ApiClient('http://example.test/api/v1',async(url,init)=>{calls.push([url,init]);const second=url.includes('page=2');return json({count:2,next:second?null:'https://untrusted.test',previous:null,results:[{id:second?2:1}]});});
 const value=await catalogueOptions(api,'isolated-token');assert.equal(value.brands.length,2);assert.equal(calls.length,6);assert.ok(calls.every(([url,init])=>url.startsWith('http://example.test/api/v1/')&&init.headers.Authorization==='Bearer isolated-token'));assert.ok(calls.some(([url])=>url.endsWith('page=2')));
});
test('catalogue writes use actual POST/PATCH paths and reject incomplete or failed saves',async()=>{
 const calls=[];const api=new ApiClient('http://example.test/api/v1',async(url,init)=>{calls.push([url,init]);return json({id:4,name:'Brand'});});
 await catalogueWrite(api,'isolated-token','/companies/me/catalogue/brands',{name:'Brand'});await catalogueWrite(api,'isolated-token','/companies/me/catalogue/brands/4',{name:'Edited'},true);
 assert.equal(calls[0][1].method,'POST');assert.equal(calls[1][1].method,'PATCH');assert.equal(JSON.parse(calls[1][1].body).company,undefined);
 api.transport=async()=>json({});await assert.rejects(catalogueWrite(api,'t','/companies/me/catalogue/brands',{}),/could not be confirmed/);
 api.transport=async()=>json({message:'Company suspended'},403);await assert.rejects(catalogueWrite(api,'t','/companies/me/catalogue/brands',{}),error=>error.status===403);
});
test('pagination rejects invalid or malformed data and propagates abort signals',async()=>{
 const controller=new AbortController();let signal;const api=new ApiClient('http://example.test/api/v1',async(url,init)=>{signal=init.signal;return json({count:0,results:[],next:null,previous:null});});
 assert.equal((await cataloguePage(api,'t','/companies/me/catalogue/products?search=test',2,controller.signal)).count,0);assert.equal(signal,controller.signal);
 await assert.rejects(cataloguePage(api,'t','/companies/me/catalogue/products',0));api.transport=async()=>json({results:[]});await assert.rejects(cataloguePage(api,'t','/companies/me/catalogue/products'),/incomplete/);
});
