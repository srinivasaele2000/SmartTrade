import test from 'node:test';
import assert from 'node:assert/strict';
import {recoverSession,SessionRejected} from '../src/session-recovery.ts';
import {ApiClient} from '../src/api.ts';
const saved={access:'expired-access',refresh:'saved-refresh',expires_in:300};
const profile={id:7,account_type:'PERSONAL',access_state:'ACTIVE'};
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('expired access refreshes before profile revalidation and retains unrotated refresh',async()=>{
 const old=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push([url,init]);return calls.length===1?json({},401):calls.length===2?json({access:'new-access'}):json({account:profile});};
 try{const result=await recoverSession(new ApiClient('http://example.test/api/v1'),saved);assert.equal(result.tokens.refresh,saved.refresh);assert.equal(result.tokens.access,'new-access');assert.equal(calls.length,3);assert.equal(calls[2][1].headers.Authorization,'Bearer new-access');}finally{globalThis.fetch=old;}
});
test('network and server failures remain retryable rather than definitive rejection',async()=>{
 const old=globalThis.fetch;
 try{for(const failure of ['network',503]){globalThis.fetch=async()=>{if(failure==='network')throw Error('offline');return json({},failure);};await assert.rejects(recoverSession(new ApiClient('http://example.test/api/v1'),saved,true),e=>!(e instanceof SessionRejected));}}finally{globalThis.fetch=old;}
});
test('rejected refresh and revoked refreshed account terminate session',async()=>{
 const old=globalThis.fetch;
 try{for(const status of [400,401,403]){globalThis.fetch=async()=>json({},status);await assert.rejects(recoverSession(new ApiClient('http://example.test/api/v1'),saved,true),SessionRejected);}
 let count=0;globalThis.fetch=async()=>++count===1?json({access:'new'}):json({},401);await assert.rejects(recoverSession(new ApiClient('http://example.test/api/v1'),saved,true),SessionRejected);
 }finally{globalThis.fetch=old;}
});
test('rotated refresh is preserved and malformed responses are retryable',async()=>{
 const old=globalThis.fetch;
 try{let count=0;globalThis.fetch=async()=>++count===1?json({access:'new',refresh:'rotated'}):json({account:profile});assert.equal((await recoverSession(new ApiClient('http://example.test/api/v1'),saved,true)).tokens.refresh,'rotated');globalThis.fetch=async()=>json({});await assert.rejects(recoverSession(new ApiClient('http://example.test/api/v1'),saved,true),e=>!(e instanceof SessionRejected));}finally{globalThis.fetch=old;}
});
