import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreCompanyActivity } from '../src/company-actions.ts';

test('restoration uses existing staff route, bearer token and mandatory reason only', async () => {
 const original=globalThis.fetch;const calls=[];
 globalThis.fetch=async(url,init)=>{calls.push([url,init]);return new Response(JSON.stringify({company:{id:7,activity_state:'ACTIVE'}}),{status:200});};
 try {
  const company=await restoreCompanyActivity('/api/v1','isolated-token',7,' test restoration ');
  assert.equal(company.activity_state,'ACTIVE');assert.equal(calls[0][0],'/api/v1/staff/companies/7/restore');
  assert.equal(calls[0][1].headers.Authorization,'Bearer isolated-token');assert.deepEqual(JSON.parse(calls[0][1].body),{reason:'test restoration'});
  await assert.rejects(restoreCompanyActivity('/api/v1','isolated-token',7,''),/reason/);
 } finally {globalThis.fetch=original;}
});
test('permission denial and incomplete restoration responses never become success', async () => {
 const original=globalThis.fetch;
 try {
  globalThis.fetch=async()=>new Response(JSON.stringify({message:'Permission denied'}),{status:403});
  await assert.rejects(restoreCompanyActivity('/api/v1','isolated-token',7,'test'),/Permission denied/);
  globalThis.fetch=async()=>new Response('{}',{status:200});
  await assert.rejects(restoreCompanyActivity('/api/v1','isolated-token',7,'test'),/could not be confirmed/);
 } finally {globalThis.fetch=original;}
});
