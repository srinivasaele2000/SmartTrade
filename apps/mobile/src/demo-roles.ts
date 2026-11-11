import type {ApiClient} from './api.ts';
import {login, mobileValid, tokens, type Account, type Tokens} from './auth.ts';

export type DemoRole = Account['account_type'];
export type DemoPersona = {role: DemoRole; name: string; mobile: string};

const names: Record<DemoRole, string> = {
  PERSONAL: 'Controlled Buyer', BUSINESS: 'Controlled Dealer', COMPANY: 'Controlled Company', STAFF: 'Designated Staff',
  SERVICE_PROVIDER: 'Controlled Service Provider', JOB_SEEKER: 'Controlled Job Seeker', EMPLOYER: 'Controlled Employer',
};

export function configuredDemoPersonas(base: string, enabled: string | undefined, mobiles: Partial<Record<DemoRole, string>>) {
  if (enabled !== 'true') return [];
  try {
    const url = new URL(base);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) ||
        url.username || url.password || url.search || url.hash) return [];
  } catch {return [];}
  return (Object.keys(names) as DemoRole[]).flatMap(role => {
    const mobile = mobiles[role]?.trim();
    return mobile && mobileValid(mobile) ? [{role, name: names[role], mobile}] : [];
  });
}

export async function availableDemoPersonas(api: ApiClient, configured: DemoPersona[], signal?: AbortSignal) {
  async function probe(role: DemoRole) {
    if (!configured.some(persona => (persona.role === 'STAFF') === (role === 'STAFF'))) return false;
    try {
      const reply = await api.get(role === 'STAFF' ? '/auth/dev-login' : '/auth/otp/request', signal) as
        {enabled?: boolean; authentication_mode?: string};
      return reply.enabled === true && (role === 'STAFF' || reply.authentication_mode === 'development_otp');
    } catch {return false;}
  }
  const [otp, staff] = await Promise.all([probe('PERSONAL'), probe('STAFF')]);
  return configured.filter(persona => persona.role === 'STAFF' ? staff : otp);
}

export async function demoLogin(api: ApiClient, persona: DemoPersona): Promise<Tokens> {
  if (!configuredDemoPersonas(api.base, 'true', {[persona.role]: persona.mobile}).length ||
      !(await availableDemoPersonas(api, [persona])).length) {
    throw new Error('Demo sign-in is unavailable. Check the local server and try again.');
  }
  if (persona.role === 'STAFF') return tokens(await api.post('/auth/dev-login', {}));
  // The development adapter accepts a nonempty marker. No SMS request is sent.
  const issued = await login(api, persona.mobile, 'demo');
  if (issued.authentication_mode !== 'development_otp') throw new Error('Demo sign-in is unavailable.');
  return issued;
}
