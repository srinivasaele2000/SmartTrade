import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import {resolveApiFileUrl} from '../src/api-file-url.ts';
import * as model from '../src/local-file-model.ts';

const base='http://127.0.0.1:8000/api/v1';
test('backend root-relative invoice path resolves once and stays under the API',()=>{
 for(const api of [base,base+'/'])assert.equal(resolveApiFileUrl(api,'/api/v1/orders/9/invoice/download'),base+'/orders/9/invoice/download');
 assert.equal(resolveApiFileUrl('https://example.test/api/v1','https://example.test/api/v1/orders/9/invoice/download'),'https://example.test/api/v1/orders/9/invoice/download');
});
test('invoice resolver refuses foreign origins, credentials, traversal and non-API paths',()=>{
 for(const reference of ['https://evil.test/api/v1/orders/9','//evil.test/api/v1/orders/9','http://127.0.0.1:8001/api/v1/orders/9','/api/v1/../../private','/elsewhere','/api/v1/orders%2f..%2f..','/api/v1/orders#token','http://user:secret@127.0.0.1:8000/api/v1/orders/9'])assert.throws(()=>resolveApiFileUrl(base,reference));
 for(const invalid of ['','not a url','ftp://example.test/api/v1','https://user:secret@example.test/api/v1','https://example.test/api/v1?token=x'])assert.throws(()=>resolveApiFileUrl(invalid,'/api/v1/orders/9'));
});

function vault({status=200,networkError=false,empty=false,metadataError=false}={}){
 const files=new Map(),calls=[];
 const native={documentDirectory:'file:///private/',cacheDirectory:'file:///cache/',
  makeDirectoryAsync:async()=>{},getFreeDiskStorageAsync:async()=>100_000_000,
  getInfoAsync:async uri=>({exists:files.has(uri),size:files.get(uri)?.length??0}),
  readAsStringAsync:async uri=>files.get(uri),
  writeAsStringAsync:async(uri,value)=>{if(metadataError&&uri.endsWith('metadata.json.new'))throw Error('Storage write failed');files.set(uri,value)},
  copyAsync:async({from,to})=>files.set(to,files.get(from)),
  moveAsync:async({from,to})=>{files.set(to,files.get(from));files.delete(from)},
  deleteAsync:async uri=>files.delete(uri),
  downloadAsync:async(url,uri,options)=>{calls.push({url,options});files.set(uri,empty?'':'%PDF controlled bytes');if(networkError)throw Error('Network failed');return{status}},
 };
 const source=fs.readFileSync(new URL('../src/local-files.ts',import.meta.url),'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const imports={'expo-file-system/legacy':native,'expo-file-system':{File:class{}},'./local-file-model':model,'./api-file-url':{resolveApiFileUrl}};
 const module={exports:{}};new Function('require','module','exports',compiled)(name=>imports[name],module,module.exports);
 const download=(api=base,path='/api/v1/orders/9/invoice/download')=>module.exports.downloadApiFile(api,path,{Authorization:'Bearer isolated-test-token'},'invoice.pdf','invoice','invoice-9','application/pdf');
 return {files,calls,download,storage:module.exports};
}
test('actual URL-to-vault integration saves metadata only after a successful private download and reuses the copy',async()=>{
 const {download,files,calls}=vault();const first=await download(),again=await download();
 assert.equal(calls.length,1);assert.equal(calls[0].url,base+'/orders/9/invoice/download');assert.equal(calls[0].options.headers.Authorization,'Bearer isolated-test-token');
 assert.equal(first.uri,again.uri);assert.ok(first.uri.startsWith('file:///private/smarttrade-private/content/'));
 assert.equal(JSON.parse(files.get('file:///private/smarttrade-private/metadata.json')).length,1);
});
test('failed, empty or interrupted downloads and metadata write failures never create a successful vault record',async()=>{
 for(const options of [{status:403},{status:500},{empty:true},{networkError:true},{metadataError:true}]){
  const {download,files}=vault(options);await assert.rejects(download);
  assert.equal(files.has('file:///private/smarttrade-private/metadata.json'),false);
  assert.equal([...files.keys()].filter(x=>x.includes('/content/')).length,0);
 }
});
test('cross-origin invoice reference is rejected before the authenticated file transport runs',async()=>{
 const {download,calls}=vault();assert.throws(()=>download(base,'https://foreign.test/api/v1/orders/9/invoice/download'));assert.equal(calls.length,0);
});

test('offline document index hides legacy and other-account invoices, includes catalogues, and updates after removal', async () => {
 const {download, storage, files}=vault();
 const legacy=await download();
 const firstScope=model.invoiceFileScope(7,9);
 assert.deepEqual(await storage.offlineDocuments(7), []);
 await storage.moveLocalFileScope('invoice','invoice-9',firstScope);
 const catalogue=await storage.downloadLocalFile(base+'/catalogue/fixture',{},'fixture.pdf','catalogue_pdf','product-1','application/pdf','Lighting');
 const mine=await storage.offlineDocuments(7);
 assert.deepEqual(new Set(mine.map(file=>file.id)),new Set([legacy.id,catalogue.id]));
 assert.deepEqual((await storage.offlineDocuments(70)).map(file=>file.id),[catalogue.id]);
 assert.equal(model.offlineDocumentTitle(catalogue),'Catalogue · Lighting');
 const invoice=mine.find(file=>file.category==='invoice');
 assert.equal(invoice.size,files.get(invoice.uri).length);
 await storage.deleteLocalFile(invoice);
 assert.equal(files.has(legacy.uri),false);
 assert.deepEqual((await storage.offlineDocuments(7)).map(file=>file.id),[catalogue.id]);
});
