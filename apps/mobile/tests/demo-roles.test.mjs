import assert from 'node:assert/strict';
import test from 'node:test';
import {availableDemoPersonas, configuredDemoPersonas, demoLogin} from '../src/demo-roles.ts';

const base = 'http://127.0.0.1:8000/api/v1';
const mobiles = {PERSONAL:'+919800000001', BUSINESS:'+919800000002', COMPANY:'+919800000003', STAFF:'+919800000004',
  SERVICE_PROVIDER:'+919800000005', JOB_SEEKER:'+919800000006', EMPLOYER:'+919800000007'};
const personas = configuredDemoPersonas(base, 'true', mobiles);
const issued = {access:'fixture-access', refresh:'fixture-refresh', expires_in:60};

test('demo roles require explicit opt-in, loopback, and valid configured personas', () => {
  assert.deepEqual(personas.map(persona => persona.role), Object.keys(mobiles));
  assert.deepEqual(configuredDemoPersonas(base, undefined, mobiles), []);
  assert.deepEqual(configuredDemoPersonas('https://example.test/api/v1', 'true', mobiles), []);
  assert.deepEqual(configuredDemoPersonas(base, 'true', {PERSONAL:'invalid'}), []);
});

test('demo login uses local OTP only for marketplace roles and the designated endpoint for staff', async () => {
  const calls = [];
  const api = {
    base,
    get: async path => path === '/auth/dev-login' ? {enabled:true} : {enabled:true,authentication_mode:'development_otp'},
    post: async (path, body) => {calls.push([path,body]);return path === '/auth/dev-login' ? issued : {...issued,authentication_mode:'development_otp'};},
  };
  assert.equal((await availableDemoPersonas(api, personas)).length, 7);
  await demoLogin(api, personas[1]);
  await demoLogin(api, personas[3]);
  await demoLogin(api, personas[6]);
  assert.deepEqual(calls, [['/auth/login',{mobile_e164:mobiles.BUSINESS,code:'demo'}],['/auth/dev-login',{}],
    ['/auth/login',{mobile_e164:mobiles.EMPLOYER,code:'demo'}]]);
  api.get = async () => ({enabled:false});
  await assert.rejects(demoLogin(api, personas[0]), /Demo sign-in is unavailable/);
  assert.equal(calls.length, 3);
});

test('an ordinary login response cannot establish a demo session', async () => {
  const api = {base,get:async()=>({enabled:true,authentication_mode:'development_otp'}),post:async()=>issued};
  await assert.rejects(demoLogin(api, personas[0]), /Demo sign-in is unavailable/);
});
