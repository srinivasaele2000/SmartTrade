import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import * as apiModule from '../src/api.ts';
import * as india from '../src/india.ts';
import * as localModel from '../src/local-file-model.ts';
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

test('order tracking distinguishes completion from dispatch readiness and never invents later timestamps', () => {
 const jsx=(type,props)=>({type,props});
 const {OrderTracking}=compile('OrderTracking',{
  'react/jsx-runtime':{jsx,jsxs:jsx},'react-native':{StyleSheet:{create:styles=>styles},View:'view',Text:'text'},'./india':india,
 });
 const order={created_at:'2026-11-01T00:00:00Z',confirmed_at:'2026-11-02T00:00:00Z',updated_at:'2026-11-03T00:00:00Z'};
 function labels(state) {
  const result=[];
  function visit(node) {
   if (Array.isArray(node)) {node.forEach(visit);return;}
   if (!node || typeof node!=='object') return;
   if (node.props.accessibilityLabel) result.push(node.props.accessibilityLabel);
   visit(node.props.children);
  }
  visit(OrderTracking({order:{...order,state}}));
  return result;
 }
 assert.deepEqual(labels('READY'),['Order Placed, Reached, 01-11-2026 05:30 IST','Confirmed, Reached, 02-11-2026 05:30 IST','Ready for Dispatch, Current step','Completed, Pending']);
 assert.equal(labels('COMPLETED').at(-1),'Completed, Current step');
 assert.equal(labels('CANCELLED').at(-2),'Ready for Dispatch, Not reached');
});

test('Dealer activity uses dealer APIs, shows real recent counts, and opens order history', async () => {
 const jsx=(type,props)=>({type,props});
 const native={StyleSheet:{create:styles=>styles},View:'view',Text:'text',ActivityIndicator:'spinner'};
 const records=[{id:1,state:'READY',items:[],invoice:{id:1}},{id:2,state:'COMPLETED',items:[],invoice:null}];
 const calls=[];
 const api={get:async(path,signal,token)=>{
  calls.push({path,token});
  const results=path.includes('/orders?')?records:[{state:'SUBMITTED'},{state:'ACCEPTED'}];
  return {results,count:results.length,next:null,previous:null};
 }};
 let load,state={status:'loading'},opened=0;
 const {DealerActivity}=compile('DealerActivity',{
  react:{useCallback:fn=>fn},'react/jsx-runtime':{jsx,jsxs:jsx,Fragment:'fragment'},'react-native':native,
  './Button':{Button:'button'},'./api':apiModule,'./orders':orders,'./enquiries':enquiries,
  './useResource':{useResource:fn=>{load=fn;return {state,retry(){}};}},
 });
 const props={api,token:'fixture-dealer',revision:0,onExpired(){},onOpenOrders(){opened++;}};
 const nodes=[];
 function walk(node) {
  if (Array.isArray(node)) {node.forEach(walk);return;}
  if (node && typeof node==='object') {nodes.push(node);walk(node.props.children);}
  else if (typeof node==='string') nodes.push(node);
 }
 walk(DealerActivity(props));
 assert.ok(nodes.some(node=>node.type==='spinner'));
 state={status:'ready',data:await load(new AbortController().signal)};
 assert.deepEqual(calls,[{path:'/businesses/me/orders?page=1',token:'fixture-dealer'},{path:'/businesses/me/enquiries?page=1',token:'fixture-dealer'}]);
 nodes.length=0;walk(DealerActivity(props));
 for (const text of ['1 active order in recent activity','1 active enquiry','1 order ready','1 invoice ready']) assert.ok(nodes.includes(text),text);
 nodes.find(node=>node.type==='button'&&node.props.title==='View orders and invoices').props.onPress();
 assert.equal(opened,1);
 state={status:'ready',data:{enquiries:0,active:0,ready:0,invoices:0,moreOrders:false}};
 nodes.length=0;walk(DealerActivity(props));assert.ok(nodes.includes('All orders up to date'));
 state={status:'error'};nodes.length=0;walk(DealerActivity(props));assert.ok(nodes.includes('We couldn’t load recent activity.'));
});

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
  './StickyBottomBar':{StickyBottomBar:({children})=>children}, './Button':{Button:props=>jsx('button',props)},'./api':apiModule,'./india':india,'./orders':orders,'./enquiries':enquiries,
  'react-native-safe-area-context':{useSafeAreaInsets:()=>({bottom:48})},'./local-file-model':localModel,
  './open-local-pdf':{openLocalPdf:()=>{throw Error('No viewer in navigation test')}},'./local-files':{downloadApiFile:()=>{throw Error('No download in navigation test')}},'./LocalFileVault':{default:()=>null},
  './session':{useSession:()=>({account:{account_type:dealer?'BUSINESS':'PERSONAL'},token:'fixture-token',revalidateSession(){}})},
  './useHistoryPage':{useHistoryPage:load=>{if(!history){history=new HistoryPage(load);loaded=history.start(load);}return{...history.snapshot,next:history.next,previous:history.previous,retry:history.retry,refresh:history.refresh,reload:history.reload}}},
 };
 imports['./HistoryPager']=compile('HistoryPager',imports);
 imports['./OrderTracking']=compile('OrderTracking',imports);
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
  const first=kind==='orders'?'ORDER-1 · Order placed':'Enquiry 1 · Fixture branch · SUBMITTED';
  h.button(first).props.onPress();h.render();
  const label=kind==='orders'?(dealer?'Transition reason':'Cancellation reason'):(dealer?'Dealer quotation notes':'Buyer notes');
  const input=h.input(label);assert.ok(input);input.props.onChangeText('Unsaved text');h.render();
  const next=h.button('Next history page').props.onPress();h.render();assert.equal(h.button('Next history page').props.disabled,true);await next;h.render();
  assert.equal(h.snapshot().page,2);assert.ok(h.button(kind==='orders'?'ORDER-2 · Order placed':'Enquiry 2 · Fixture branch · SUBMITTED'));
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
 h.fail(null);await h.button('Retry').props.onPress();h.render();assert.equal(h.snapshot().page,2);assert.ok(h.button('ORDER-2 · Order placed'));
});
test('actual dealer enquiry history renders an empty page with disabled pagination',async()=>{
 const h=workspace('enquiries',true,{empty:true});await h.ready();h.render();assert.match(h.text(),/No enquiries found/);assert.equal(h.button('Previous history page').props.disabled,true);assert.equal(h.button('Next history page').props.disabled,true);
});
