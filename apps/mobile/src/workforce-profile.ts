import {ApiClient, ApiError} from './api.ts';
import {INDIAN_PIN} from './india.ts';

type Field = {key: string; label: string; limit: number; numeric?: boolean};
const pin = {key: 'pin_code', label: 'Postal PIN code', limit: 6, numeric: true};
export const workforce = {
  SERVICE_PROVIDER: {title: 'Service Provider', endpoint: 'service-provider-profile', fields: [
    {key: 'full_name', label: 'Full name', limit: 200},
    {key: 'trade', label: 'Profession or trade', limit: 120}, pin,
    {key: 'locality', label: 'Locality', limit: 120}, {key: 'district', label: 'District', limit: 120},
  ]},
  JOB_SEEKER: {title: 'Job Seeker', endpoint: 'job-seeker-profile', fields: [
    {key: 'full_name', label: 'Full name', limit: 200}, {key: 'skills', label: 'Primary skills or trade', limit: 500},
    {key: 'experience', label: 'Years of experience', limit: 3, numeric: true},
    {key: 'preferred_location', label: 'Preferred locality', limit: 200}, pin,
  ]},
  EMPLOYER: {title: 'Employer', endpoint: 'employer-profile', fields: [
    {key: 'organization_name', label: 'Business or shop name', limit: 200},
    {key: 'contact_name', label: 'Contact person', limit: 200}, pin, {key: 'locality', label: 'Locality', limit: 120},
  ]},
} satisfies Record<string, {title: string; endpoint: string; fields: Field[]}>;
export type WorkforceRole = keyof typeof workforce;
export type ProfileDraft = Record<string, string>;
export function isWorkforce(role: string | undefined): role is WorkforceRole {
  return role !== undefined && Object.hasOwn(workforce, role);
}

export function profileInput(role: WorkforceRole, draft: ProfileDraft) {
  const data: ProfileDraft = {};
  for (const field of workforce[role].fields) {
    const value = draft[field.key]?.trim() ?? '';
    if (field.key === 'pin_code' && !INDIAN_PIN.test(value)) throw new ApiError('Enter a valid six-digit Indian PIN code.');
    if (field.key === 'experience' && !/^\d{1,3}$/.test(value)) throw new ApiError('Enter years of experience as a whole number.');
    if (!value || value.length > field.limit) throw new ApiError('Enter a valid ' + field.label.toLowerCase() + '.');
    data[field.key] = value;
  }
  return data;
}

export async function readWorkforceProfile(api: ApiClient, role: WorkforceRole, token: string, signal?: AbortSignal) {
  const result = await api.get('/auth/' + workforce[role].endpoint, signal, token) as ProfileDraft;
  return Object.fromEntries(workforce[role].fields.map(field => [field.key, typeof result?.[field.key] === 'string' ? result[field.key] : '']));
}

export async function saveWorkforceProfile(api: ApiClient, role: WorkforceRole, token: string, draft: ProfileDraft) {
  return api.get('/auth/' + workforce[role].endpoint, undefined, token,
    {method: 'PATCH', body: JSON.stringify(profileInput(role, draft))});
}
