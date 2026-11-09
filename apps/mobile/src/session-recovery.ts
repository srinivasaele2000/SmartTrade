import {ApiClient, ApiError} from './api.ts';
import {account as loadAccount, type Account, type Tokens} from './auth.ts';

export class SessionRejected extends Error {}
const rejected = (error: unknown) => error instanceof ApiError && [400,401,403].includes(error.status);

/** No storage side effects: only definitive authentication rejection permits clearing. */
export async function recoverSession(api: ApiClient, saved: Tokens, refreshFirst = false): Promise<{tokens: Tokens; account: Account}> {
  if (!refreshFirst) {
    try { return {tokens:saved, account:await loadAccount(api,saved.access)}; }
    catch(error) { if (!(error instanceof ApiError) || ![401,403].includes(error.status)) throw error; }
  }
  let result: {access?:string;refresh?:string};
  try { result = await api.post('/auth/refresh',{refresh:saved.refresh}) as typeof result; }
  catch(error) { if (rejected(error)) throw new SessionRejected('Session rejected. Sign in again.'); throw error; }
  if (!result || typeof result.access!=='string' || !result.access || (result.refresh!==undefined && (typeof result.refresh!=='string'||!result.refresh))) throw new ApiError('Session refresh response could not be confirmed.');
  const updated={...saved,access:result.access,refresh:result.refresh??saved.refresh};
  try { return {tokens:updated,account:await loadAccount(api,updated.access)}; }
  catch(error) { if(rejected(error)) throw new SessionRejected('Account access rejected. Sign in again.'); throw error; }
}
