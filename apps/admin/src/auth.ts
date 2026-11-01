import { requestApi } from './api.ts';

export type StaffAccount = { id: number; account_type: string; staff_profile?: { state: string; roles: string[]; permissions: string[] } | null };
export type LoginResponse = { access: string; refresh: string; expires_in: number; account: StaffAccount };

export async function developmentAvailable(base: string, developmentBuild: boolean, hostname: string): Promise<boolean> {
  if (!developmentBuild || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return false;
  try { return (await requestApi<{ enabled: boolean }>(base, '/auth/dev-login')).enabled === true; }
  catch { return false; }
}

export async function loadStaffSession(base: string, payload: LoginResponse) {
  if (!payload.refresh || !payload.access || !Number.isFinite(payload.expires_in) || payload.expires_in <= 0) throw new Error('Invalid authentication response.');
  const me = await requestApi<{ account: StaffAccount }>(base, '/auth/me', payload.access);
  if (me.account.account_type !== 'STAFF' || me.account.staff_profile?.state !== 'ACTIVE') throw new Error('An active staff identity is required.');
  return { ...payload, account: me.account, refreshDelay: Math.max(1000, (payload.expires_in - 30) * 1000) };
}

export async function developmentOtpAvailable(base: string, developmentBuild: boolean, hostname: string): Promise<boolean> {
  if (!developmentBuild || !['localhost', '127.0.0.1', '[::1]'].includes(hostname)) return false;
  try { return (await requestApi<{ enabled: boolean }>(base, '/auth/otp/request')).enabled === true; }
  catch { return false; }
}
export type OtpAcknowledgement = { status: string; authentication_mode?: string };
export function otpAcknowledgementMessage(response: OtpAcknowledgement): string {
  return response.authentication_mode === 'development_otp'
    ? 'LOCAL DEVELOPMENT ONLY: no SMS was sent. Enter any non-empty code. Phone ownership remains unverified; staff restrictions still apply.'
    : 'If this staff account is eligible, the configured provider has accepted the request.';
}
