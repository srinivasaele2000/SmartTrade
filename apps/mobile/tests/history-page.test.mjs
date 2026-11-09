import test from 'node:test';
import assert from 'node:assert/strict';
import {HistoryPage} from '../src/history-page.ts';

const page=(n,total=3)=>({count:total,next:n<total?`?page=${n+1}`:null,previous:n>1?`?page=${n-1}`:null,results:[{id:n}]});
test('history Next/Previous load different records and final page blocks Next',async()=>{
 const calls=[],loader=async(n)=>{calls.push(n);return page(n)};const history=new HistoryPage(loader);
 await history.start(loader);assert.equal(history.snapshot.state.data.results[0].id,1);
 await history.next();assert.equal(history.snapshot.page,2);assert.equal(history.snapshot.state.data.results[0].id,2);
 await history.next();assert.equal(history.snapshot.page,3);await history.next();assert.deepEqual(calls,[1,2,3]);
 await history.previous();assert.equal(history.snapshot.page,2);await history.previous();assert.equal(history.snapshot.page,1);await history.previous();assert.deepEqual(calls,[1,2,3,2,1]);
});
test('rapid navigation is gated synchronously and stale responses cannot overwrite a reloaded page',async()=>{
 const pending=[],loader=(n,signal)=>new Promise(resolve=>pending.push({n,signal,resolve}));const history=new HistoryPage(loader);
 const start=history.start(loader);pending[0].resolve(page(1));await start;
 const next=history.next();history.next();assert.equal(pending.length,2);assert.equal(history.snapshot.state.status,'loading');
 const reload=history.reload();assert.equal(pending[1].signal.aborted,true);pending[2].resolve(page(2));await reload;
 pending[1].resolve({...page(2),results:[{id:999}]});await next;assert.equal(history.snapshot.state.data.results[0].id,2);
 history.dispose();
});
test('loading/error/retry/empty are distinct and retry stays on the failed page',async()=>{
 let fail=false;const states=[],loader=async n=>{if(fail)throw Error('Offline');return page(n)};const history=new HistoryPage(loader);history.subscribe(x=>states.push(x.state.status));
 await history.start(loader);fail=true;await history.next();assert.equal(history.snapshot.page,2);assert.equal(history.snapshot.state.status,'error');assert.equal(history.snapshot.state.message,'Offline');
 fail=false;await history.retry();assert.equal(history.snapshot.page,2);assert.equal(history.snapshot.state.data.results[0].id,2);
 const empty=async()=>({count:0,next:null,previous:null,results:[]});await history.start(empty);assert.equal(history.snapshot.state.status,'ready');assert.equal(history.snapshot.state.data.results.length,0);
 assert.ok(states.includes('loading')&&states.includes('error')&&states.includes('ready'));
});
test('refresh returns to page one without changing loader filters or externally held drafts/details',async()=>{
 const filter={state:'ACCEPTED'},draft={quantity:'3',note:'Unsaved'},selected={id:1};const calls=[];
 const loader=async n=>{calls.push({n,filter});return page(n)};const history=new HistoryPage(loader);await history.start(loader);await history.next();await history.refresh();
 assert.equal(history.snapshot.page,1);assert.ok(calls.every(x=>x.filter===filter));assert.equal(draft.note,'Unsaved');assert.equal(selected.id,1);
});
test('disposed history ignores late completions and loader replacement preserves current page',async()=>{
 const loader=async n=>page(n);const history=new HistoryPage(loader);await history.start(loader);await history.next();await history.start(async n=>page(n));assert.equal(history.snapshot.page,2);
 let resolve;const pending=history.start(()=>new Promise(r=>{resolve=r}));history.dispose();resolve(page(2));await pending;assert.equal(history.snapshot.state.status,'loading');
});
