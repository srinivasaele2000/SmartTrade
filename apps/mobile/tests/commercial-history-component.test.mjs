import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as apiModule from '../src/api.ts';
import * as india from '../src/india.ts';
import {HistoryPage} from '../src/history-page.ts';

function compile(name,imports){
 const source=fs.readFileSync(new URL('../src/'+name+'.tsx',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',code)(key=>{if(!(key in imports))throw Error(key);return imports[key]},module,module.exports);return module.exports;
}
function clientModule(name){
 const source=fs.readFileSync(new URL('../src/'+name+'.ts',import.meta.url),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const module={exports:{}};new Function('require','module','exports',code)(()=>apiModule,module,module.exports);return module.exports;
}
const orders=clientModule('orders'),enquiries=clientModule('enquiries');

// Actual workspace and pager TSX, existing API clients and real page controller.
// Native hosts/hooks are adapted in memory: no app/device state or DB writes.
function workspace(kind,dealer,{empty=false}={}){
 const slots=[],effects=[],requests=[];let failPage=null,index=0,history,loaded,draft=[{listing:8,branch:1,branch_name:'Fixture branch',dealer_name:'Fixture',product_name:'Fixture product',variant_sku:null,quantity:'3',requirement:'Unsaved line'}];
 const jsx=(type,props)=>({type,props:props??{}});
 const React={
  useCallback:fn=>fn,
  useState:initial=>{const i=index++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],value=>{slots[i]=typeof value==='function'?value(slots[i]):value}];},
  useEffect:(effect,deps)=>{const i=index++;if(!slots[i]||deps.some((x,n)=>x!==slots[i][n])){slots[i]=deps;effects.push(effect)}},
 };
 const native={StyleSheet:{create:s=>s}};for(const name of ['View','Text','ScrollView','ActivityIndicator','TextInput'])native[name]=name;
 const fixture=n=>kind==='orders'?{id:n,order_number:'ORDER-'+n,state:'PENDING',dealer_business_name:'Fixture dealer',branch_name:'Fixture branch',created_at:'2026-11-01T00:00:00Z',items:[],total:'0',invoice:null}:{id:n,branch_name:'Fixture branch',state:'SUBMITTED',items:[],quotations:[],requirements:'',notes:''};
 const api={get:async(path,signal,token)=>{requests.push({path,token});const n=Number(new URL('http://fixture.test'+path).searchParams.get('page'));if(n===failPage)throw Error('History offline');return empty?{count:0,next:null,previous:null,results:[]}:{count:2,next:n===1?'?page=2':null,previous:n===2?'?page=1':null,results:[fixture(n)]}}};
 const imports={react:React,'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'react-native':native,
  './Button':{Button:props=>jsx('button',props)},'./api':apiModule,'./india':india,'./orders':orders,'./enquiries':enquiries,
  'expo-sharing':{},'./local-files':{downloadApiFile:()=>{throw Error('No download in navigation test')}},'./LocalFileVault':{default:()=>null},
  './session':{useSession:()=>({account:{account_type:dealer?'BUSINESS':'PERSONAL'},token:'fixture-token',revalidateSession(){}})},
  './useHistoryPage':{useHistoryPage:load=>{if(!history){history=new HistoryPage(load);loaded=history.start(load);}return{...history.snapshot,next:history.next,previous:history.previous,retry:history.retry,refresh:history.refresh,reload:history.reload}}},
 };
 imports['./HistoryPager']=compile('HistoryPager',imports);
 const Component=compile(kind==='orders'?'OrderWorkspace':'EnquiryWorkspace',imports).default;
 let nodes=[];
 function walk(node){if(node===null||node===undefined||node===false)return;if(Array.isArray(node)){node.forEach(walk);return}if(typeof node!=='object'){nodes.push({type:'value',props:{value:String(node)}});return}if(typeof node.type==='function'){walk(node.type(node.props));return}nodes.push(node);walk(node.props.children);}
 function render(){index=0;nodes=[];walk(jsx(Component,{api,draft,setDraft:value=>{draft=value}}));effects.splice(0).forEach(fn=>fn());return nodes;}
 render();
 return {render,ready:()=>loaded,requests,fail:value=>{failPage=value},
  button:title=>nodes.find(n=>n.type==='button'&&n.props.title===title),
  input:label=>nodes.find(n=>n.type==='TextInput'&&n.props.accessibilityLabel===label),
  text:()=>nodes.filter(n=>n.type==='value').map(n=>n.props.value).join(' '),
  snapshot:()=>history.snapshot,
 };
}

for(const dealer of [false,true])for(const kind of ['orders','enquiries']){
 test(`${dealer?'Dealer':'Buyer'} ${kind} UI navigates pages and preserves selected detail and unsaved input`,async()=>{
  const h=workspace(kind,dealer);await h.ready();h.render();
  const first=kind==='orders'?'ORDER-1 · PENDING':'Enquiry 1 · Fixture branch · SUBMITTED';
  h.button(first).props.onPress();h.render();
  const label=kind==='orders'?(dealer?'Transition reason':'Cancellation reason'):(dealer?'Dealer quotation notes':'Buyer notes');
  const input=h.input(label);assert.ok(input);input.props.onChangeText('Unsaved text');h.render();
  const next=h.button('Next history page').props.onPress();h.render();assert.equal(h.button('Next history page').props.disabled,true);await next;h.render();
  assert.equal(h.snapshot().page,2);assert.ok(h.button(kind==='orders'?'ORDER-2 · PENDING':'Enquiry 2 · Fixture branch · SUBMITTED'));
  assert.equal(h.button('Next history page').props.disabled,true);assert.equal(h.input(label).props.value,'Unsaved text');
  assert.match(h.text(),kind==='orders'?/ORDER-1/:/Enquiry\s+1/);
  await h.button('Previous history page').props.onPress();h.render();assert.equal(h.snapshot().page,1);
  assert.equal(h.input(label).props.value,'Unsaved text');
  assert.ok(h.requests.every(x=>x.token==='fixture-token'&&x.path.startsWith(dealer?'/businesses/me/':'/')));
  assert.ok(h.requests[1].path.includes('page=2'));
  if(!dealer&&kind==='enquiries')assert.equal(h.input('Requirement for Fixture product').props.value,'Unsaved line');
  await h.button('Next history page').props.onPress();h.render();
  await h.button(kind==='orders'?'Refresh orders':'Refresh enquiries').props.onPress();h.render();
  assert.equal(h.snapshot().page,1);assert.equal(h.input(label).props.value,'Unsaved text');
 });
}
test('actual order history renders page failure and retry rather than empty success',async()=>{
 const h=workspace('orders',false);await h.ready();h.render();h.fail(2);await h.button('Next history page').props.onPress();h.render();
 assert.match(h.text(),/History offline/);assert.equal(h.button('Next history page').props.disabled,true);assert.doesNotMatch(h.text(),/No orders found/);
 h.fail(null);await h.button('Retry').props.onPress();h.render();assert.equal(h.snapshot().page,2);assert.ok(h.button('ORDER-2 · PENDING'));
});
test('actual dealer enquiry history renders an empty page with disabled pagination',async()=>{
 const h=workspace('enquiries',true,{empty:true});await h.ready();h.render();assert.match(h.text(),/No enquiries found/);assert.equal(h.button('Previous history page').props.disabled,true);assert.equal(h.button('Next history page').props.disabled,true);
});
