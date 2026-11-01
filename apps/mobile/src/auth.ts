import { ApiClient, ApiError } from './api.ts';

export type AccountType = 'PERSONAL' | 'BUSINESS' | 'COMPANY';
export type Account = { id: number; account_type: AccountType | 'STAFF'; access_state: string; mobile_verified: boolean };
export type Tokens = { access: string; refresh: string; expires_in: number; authentication_mode?: string };
export const mobileValid = (value: string) => /^\+[1-9][0-9]{1,14}$/.test(value.trim());

export async function register(api: ApiClient, mobile: string, type: AccountType) {
  if (!mobileValid(mobile)) throw new ApiError('Enter an E.164 number with + and country code.');
  if (!['PERSONAL', 'BUSINESS', 'COMPANY'].includes(type)) throw new ApiError('Choose Personal, Business or Company.');
  return api.post('/auth/register', { mobile_e164: mobile.trim(), account_type: type });
}
export async function requestOtp(api: ApiClient, mobile: string) {
  if (!mobileValid(mobile)) throw new ApiError('Enter an E.164 number with + and country code.');
  const value = await api.post('/auth/otp/request', { mobile_e164: mobile.trim() }) as { status?: string; authentication_mode?: string };
  if (value.status !== 'accepted') throw new ApiError('OTP request was not acknowledged.');
  return value.authentication_mode === 'development_otp'
    ? 'LOCAL DEVELOPMENT: no SMS sent. Enter any non-empty code. Phone ownership remains unverified.'
    : 'If the account is eligible, the provider has accepted the request.';
}
export async function login(api: ApiClient, mobile: string, code: string): Promise<Tokens> {
  if (!mobileValid(mobile) || !code.trim()) throw new ApiError('Enter a valid mobile number and a non-empty code.');
  return tokens(await api.post('/auth/login', { mobile_e164: mobile.trim(), code: code.trim() }));
}
export function tokens(value: unknown): Tokens {
  const data = value as Tokens | null;
  if (!data || typeof data.access !== 'string' || !data.access || typeof data.refresh !== 'string' || !data.refresh || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new ApiError('Invalid sign-in response.');
  return data;
}
export async function account(api: ApiClient, access: string): Promise<Account> {
  const value = await api.get('/auth/me', undefined, access) as { account?: Account };
  if (!value.account || !['PERSONAL', 'BUSINESS', 'COMPANY', 'STAFF'].includes(value.account.account_type) || value.account.access_state !== 'ACTIVE') throw new ApiError('This account cannot start a session.', 401);
  return value.account;
}
