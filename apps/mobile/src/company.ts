import { ApiClient, ApiError } from './api.ts';
import { GSTIN, INDIAN_PIN, INDIAN_STATES, PAN } from './india.ts';

export const fields = [
  ['legal_name', 'Legal company name', 200], ['trading_name', 'Trading name', 200],
  ['registration_number', 'Registration number', 100], ['tax_registration_number', 'Legacy tax registration reference', 100],
  ['gstin', 'GSTIN (optional)', 15], ['pan', 'PAN (optional)', 10],
  ['authorized_person_name', 'Authorized person', 200], ['company_email', 'Company email', 254],
  ['address_line', 'Address', 300], ['pin_code', 'Indian PIN code', 6], ['area', 'Area / locality', 120],
  ['district', 'District', 120], ['state_or_region', 'Indian state / union territory', 120], ['website', 'Website', 200],
] as const;
export type ProfileInput = Record<typeof fields[number][0], string>;
export type Company = ProfileInput & { id: number; verification_state: 'PENDING' | 'VERIFIED' | 'REJECTED'; activity_state: 'ACTIVE' | 'SUSPENDED'; email_verified_at: string | null; can_publish_catalogue: boolean };
export type DocumentPolicy = { configured: boolean; required_types: string[]; allowed_mime_types: string[]; max_bytes: number | null };
export type DocumentMetadata = { id: number; document_type: string; original_filename: string; content_type: string; size_bytes: number; uploaded_at: string; verification_case_id: number | null };
export type CompanyContext = { company: Company; verification: {
  document_policy: DocumentPolicy; documents: DocumentMetadata[];
  application: { id: number; status: 'PENDING' | 'APPROVED' | 'REJECTED'; submitted_at: string; reviewed_at: string | null; decision_reason: string } | null;
  email_verification_mode?: 'development_email' | 'provider'; email_ready?: boolean; can_verify_email?: boolean;
  missing_document_types: string[]; email_provider_configured: boolean; can_edit: boolean; can_upload: boolean; can_submit: boolean; can_request_review: boolean;
  review_requests: { id: number; state: string; reason: string; submitted_at: string }[];
} };
export const blankProfile = (): ProfileInput => Object.fromEntries(fields.map(([key]) => [key, ''])) as ProfileInput;
export function validateProfile(value: ProfileInput): string[] {
  const errors = fields.filter(([key, , max]) => value[key].trim().length > max).map(([, label]) => `${label} is too long.`);
  if (!value.legal_name.trim()) errors.push('Legal company name is required.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.company_email.trim())) errors.push('Enter a valid company email.');
  if (value.pin_code && !INDIAN_PIN.test(value.pin_code.trim())) errors.push('Use a six-digit Indian PIN code.');
  if (value.state_or_region && !INDIAN_STATES.some(state => state.toLowerCase() === value.state_or_region.trim().toLowerCase())) errors.push('Choose a valid Indian state or union territory.');
  if (value.gstin && !GSTIN.test(value.gstin.trim().toUpperCase())) errors.push('Use a valid 15-character GSTIN.');
  if (value.pan && !PAN.test(value.pan.trim().toUpperCase())) errors.push('Use a valid 10-character PAN.');
  if (value.website && !/^https?:\/\//i.test(value.website)) errors.push('Website must start with http:// or https://.');
  return errors;
}
export function statusLabel(company: Company): string {
  if (company.activity_state === 'SUSPENDED') return 'Suspended';
  return company.verification_state === 'VERIFIED' ? 'Approved / verified' : company.verification_state === 'REJECTED' ? 'Rejected' : 'Pending verification';
}
export async function loadCompany(api: ApiClient, token: string, signal?: AbortSignal): Promise<CompanyContext | null> {
  try {
    const value = await api.get('/companies/me', signal, token) as CompanyContext;
    if (!value.company || !value.verification || !Array.isArray(value.verification.documents) || !Array.isArray(value.verification.document_policy?.required_types)) throw new ApiError('Company status response is incomplete.');
    return value;
  } catch (error) { if (error instanceof ApiError && error.status === 404 && error.code === 'COMPANY_NOT_REGISTERED') return null; throw error; }
}
export async function saveProfile(api: ApiClient, token: string, value: ProfileInput, creating: boolean) {
  const errors = validateProfile(value); if (errors.length) throw new ApiError(errors.join(' '));
  const body = Object.fromEntries(fields.map(([key]) => [key, ['gstin','pan'].includes(key) ? value[key].trim().toUpperCase() : value[key].trim()]));
  const result = await api.get(creating ? '/companies/register' : '/companies/me', undefined, token, { method: creating ? 'POST' : 'PATCH', body: JSON.stringify(body) }) as { company?: { id?: number } };
  if (typeof result.company?.id !== 'number') throw new ApiError('Save response is incomplete. Refresh company status before retrying.');
  return result;
}
export function confirmReply(value: unknown, required: Record<string, 'number' | 'string'>): void {
  if (!value || typeof value !== 'object' || Object.entries(required).some(([key, type]) => typeof (value as Record<string, unknown>)[key] !== type)) throw new ApiError('Server response is incomplete. Refresh company status before retrying.');
}
/** Display real ownership verification separately from local simulation evidence. */
export function emailStatus(context: CompanyContext): string {
  if (context.company.email_verified_at) return 'Verified by provider';
  return context.verification.email_ready ? 'Locally simulated; ownership unverified' : 'Not verified';
}

export function submissionGuidance(context: CompanyContext): string {
  if (context.company.activity_state === 'SUSPENDED') return 'Company activity is suspended. Status and permitted restricted review requests remain available.';
  if (context.company.verification_state === 'REJECTED') return 'Application rejected. Use the permitted restricted review request; resubmission is not automatically enabled.';
  if (context.verification.application?.status === 'APPROVED') return 'Application approved. No further submission is needed.';
  if (context.verification.application?.status === 'PENDING') return 'Application already submitted. Profile and documents are locked while review is pending.';
  return 'Submission requires company email verification (or enabled local simulation), all configured required documents and an active pending company with no previous application.';
}
