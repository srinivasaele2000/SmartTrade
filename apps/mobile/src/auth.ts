import { ApiClient, ApiError } from './api.ts';
import { INDIAN_MOBILE, MOBILE_HELP } from './india.ts';

export const registrationRoles = {
  PERSONAL: 'CUSTOMER', BUSINESS: 'BUSINESS_DEALER', COMPANY: 'COMPANY_BRAND',
  SERVICE_PROVIDER: 'SERVICE_PROVIDER', JOB_SEEKER: 'JOB_SEEKER', EMPLOYER: 'EMPLOYER',
} as const;
export type AccountType = keyof typeof registrationRoles;
export type Account = {
  id: number;
  mobile_e164?: string;
  account_type: AccountType | 'STAFF';
  access_state: string;
  mobile_verified: boolean;
  staff_profile?: {state: string; roles: string[]} | null;
};
export type Tokens = { access: string; refresh: string; expires_in: number; authentication_mode?: string };
export const mobileValid = (value: string) => INDIAN_MOBILE.test(value.trim());

export async function register(api: ApiClient, mobile: string, type: AccountType) {
  if (!mobileValid(mobile)) throw new ApiError(MOBILE_HELP);
  if (!['PERSONAL', 'BUSINESS', 'COMPANY'].includes(type)) throw new ApiError('Choose Personal, Business or Company.');
  return api.post('/auth/register', { mobile_e164: mobile.trim(), account_type: type });
}
export async function registerRole(api: ApiClient, mobile: string, type: AccountType) {
  if (!mobileValid(mobile)) throw new ApiError(MOBILE_HELP);
  if (!Object.hasOwn(registrationRoles, type)) throw new ApiError('Choose an account type.');
  return api.post('/auth/register', {mobile_e164: mobile.trim(), role: registrationRoles[type]});
}
export async function requestOtp(api: ApiClient, mobile: string) {
  if (!mobileValid(mobile)) throw new ApiError(MOBILE_HELP);
  const value = await api.post('/auth/otp/request', { mobile_e164: mobile.trim() }) as { status?: string; authentication_mode?: string };
  if (value.status !== 'accepted') throw new ApiError('We could not send a code. Please try again.');
  return value.authentication_mode === 'development_otp'
    ? 'Test sign-in: no SMS was sent. Enter any code to continue. Your number stays unverified.'
    : 'If this number can sign in, you’ll receive a code by SMS.';
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
  if (!value.account || (value.account.account_type !== 'STAFF' && !Object.hasOwn(registrationRoles, value.account.account_type)) ||
      value.account.access_state !== 'ACTIVE') throw new ApiError('This account cannot start a session.', 401);
  return value.account;
}
