import {ApiClient, ApiError, query, type Page} from './api.ts';
import {resolveApiFileUrl} from './api-file-url.ts';
import {GSTIN, INDIAN_MOBILE, indianMobileDigits} from './india.ts';

export const businessTypes = {
  ELECTRICAL: 'Electrical', PLUMBING: 'Plumbing', PAINTS: 'Paints',
  HARDWARE: 'Hardware', NETWORKING: 'Networking', OTHER: 'Other',
} as const;
export type BusinessType = keyof typeof businessTypes;
export type Worker = {name: string; mobile: string; trade: string; location?: string};
export type DealerOnboardingProfile = {business_type: BusinessType; contacts_submitted_at: string | null; verification_state: string};
export type VaultDocument = {key: string; title: string; brand_name: string; content_type: string;
  file_size_bytes: number; created_at: string; url: string};
export const workerCount = 10;

export async function registerDealer(api: ApiClient, firm: string, gstin: string, mobile: string, type: BusinessType | '') {
  if (!firm.trim() || firm.trim().length > 200) throw new ApiError('Enter your firm name (up to 200 characters).');
  const taxId = gstin.trim().toUpperCase();
  if (!GSTIN.test(taxId)) throw new ApiError('Enter a valid 15-character GSTIN.');
  if (!INDIAN_MOBILE.test(mobile)) throw new ApiError('Enter a valid 10-digit mobile number.');
  if (!type || !Object.hasOwn(businessTypes, type)) throw new ApiError('Choose a business type.');
  return api.post('/auth/dealer/register/', {firm_name: firm.trim(), gstin: taxId, mobile_number: mobile, business_type: type});
}

export function workerProgress(workers: Worker[]) {
  const seen = new Set<string>();
  for (const worker of workers) {
    if (worker.name.trim() && worker.trade.trim() && INDIAN_MOBILE.test('+91' + worker.mobile)) seen.add(worker.mobile);
  }
  return seen.size;
}

export async function submitWorkers(api: ApiClient, token: string, workers: Worker[], consent: boolean) {
  if (!consent || workers.length !== workerCount || workerProgress(workers) !== workerCount) {
    throw new ApiError('Enter ten distinct workers and confirm their consent.');
  }
  return api.post('/dealers/contacts/batch/', {contacts: workers.map(worker => ({
    name: worker.name.trim(), mobile_e164: '+91' + worker.mobile, trade: worker.trade.trim(),
    location: worker.location ?? '', consent: true,
  }))}, token);
}

export async function onboardingProfile(api: ApiClient, token: string, signal?: AbortSignal) {
  const profile = await api.get('/businesses/me', signal, token) as DealerOnboardingProfile;
  if (!profile || !Object.hasOwn(businessTypes, profile.business_type) ||
      (profile.contacts_submitted_at !== null && typeof profile.contacts_submitted_at !== 'string')) {
    throw new ApiError('Could not read your dealer onboarding status.');
  }
  return profile;
}

export async function existingWorkers(api: ApiClient, token: string, signal?: AbortSignal) {
  const page = await api.get('/businesses/me/trade-contacts?page_size=11', signal, token) as
    Page<{name: string; mobile_e164: string; trade: string; location: string}>;
  return {count: page.count, workers: page.results.map(item => ({
    name: item.name, mobile: indianMobileDigits(item.mobile_e164), trade: item.trade, location: item.location,
  }))};
}

export async function targetedCatalogues(api: ApiClient, token: string, type: BusinessType, page: number, signal?: AbortSignal): Promise<Page<VaultDocument>> {
  const data = await api.get('/catalogues/?' + query({business_type: type}, page), signal, token) as
    Page<VaultDocument & {business_type: BusinessType; is_active: boolean; download_url: string}>;
  if (!data || !Array.isArray(data.results) || typeof data.count !== 'number') throw new ApiError('Could not read catalogue results.');
  return {...data, results: data.results.map(item => {
    if (item.business_type !== type || !item.is_active ||
        !['application/pdf', 'image/jpeg', 'image/png', 'image/webp'].includes(item.content_type) ||
        !/^[a-f0-9-]{36}$/i.test(item.key) || typeof item.title !== 'string' ||
        typeof item.brand_name !== 'string' || !Number.isFinite(item.file_size_bytes) || item.file_size_bytes < 1) {
      throw new ApiError('Could not read a catalogue document.');
    }
    const url = resolveApiFileUrl(api.base, item.download_url, 'catalogue');
    if (!new URL(url).pathname.endsWith('/catalogues/' + item.key + '/file/')) throw new ApiError('Invalid catalogue file link.');
    return {...item, url};
  })};
}

export function catalogueDocumentLabel(item: VaultDocument) {
  const bytes = item.file_size_bytes;
  return (item.content_type === 'application/pdf' ? 'PDF' : 'Image') + ' • ' +
    (bytes >= 1_000_000 ? `${Number((bytes / 1_000_000).toFixed(2))} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`);
}
