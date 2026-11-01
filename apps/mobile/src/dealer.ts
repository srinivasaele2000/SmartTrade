import { ApiClient, ApiError, type Page, type Product } from './api.ts';

export type Authorization = { id: number; brand: number; brand_name: string; company: number; company_name: string; active: boolean; eligible: boolean; company_verification_state: string; company_activity_state: string; updated_at: string };
export type Business = { id: number; legal_name: string; registration_number: string; verification_state: string; workspace: { branch_count: number; published_listing_count: number; discoverable_listing_count: number; can_edit: boolean; can_publish_branches: boolean; can_manage_listings: boolean; authorizations: Authorization[] } };
export const branchFields = [
  ['branch_name', 'Branch name', 160], ['address', 'Address', 400], ['pin_code', 'PIN / postal code', 20],
  ['locality', 'Locality', 120], ['district', 'District', 120], ['state', 'State', 120], ['country', 'Country code', 2],
  ['contact_name', 'Private contact name', 160], ['contact_phone', 'Private contact phone (E.164)', 16], ['contact_email', 'Private contact email', 254],
] as const;
export type BranchInput = Record<typeof branchFields[number][0], string> & { active: boolean; visibility_state: 'PRIVATE_DRAFT' | 'VISIBLE' };
export type OwnedBranch = BranchInput & { id: number; business: number; admin_hidden: boolean };
export type ListingFilters = { search?: string; state?: string; stock_status?: string; location?: string };
export type OwnedListing = { company_name?: string; product_code?: string; variant_sku?: string | null; variant_name?: string | null; eligible?: boolean; id: number; location: number; branch_name: string; product: number; product_name: string; variant: number | null; brand_id: number; brand_name: string; company_id: number; selling_price: string; currency: string; stock_status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN'; quantity: string | null; state: 'PUBLISHED' | 'WITHDRAWN'; company_catalogue_price: string | null; company_catalogue_currency: string };
export type InventoryInput = { selling_price: string; currency: string; stock_status: OwnedListing['stock_status']; quantity: string; state: OwnedListing['state'] };
export const blankBranch = (): BranchInput => ({ ...Object.fromEntries(branchFields.map(([key]) => [key, ''])), active: true, visibility_state: 'PRIVATE_DRAFT' }) as BranchInput;
export const blankInventory = (): InventoryInput => ({ selling_price: '', currency: '', stock_status: 'UNKNOWN', quantity: '', state: 'WITHDRAWN' });
export function validateBranch(value: BranchInput): string[] {
  const errors = branchFields.filter(([key,, max]) => value[key].trim().length > max || (!key.startsWith('contact_') && !value[key].trim())).map(([,label]) => `${label} is required and must fit the stated length.`);
  if (!/^[A-Za-z]{2}$/.test(value.country.trim())) errors.push('Use an explicit two-letter country code.');
  if (value.contact_phone && !/^\+[1-9][0-9]{1,14}$/.test(value.contact_phone)) errors.push('Private phone must use E.164 format.');
  if (value.contact_email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.contact_email)) errors.push('Private email is invalid.');
  return errors;
}
const decimal = /^(?:0|[1-9]\d{0,13})(?:\.\d{1,4})?$/;
export function validateInventory(value: InventoryInput): string[] {
  const errors: string[] = [];
  if (!decimal.test(value.selling_price)) errors.push('Selling price must be nonnegative, with up to 14 whole digits and 4 decimals.');
  if (!/^[A-Z]{3}$/.test(value.currency)) errors.push('Enter an explicit uppercase three-letter currency.');
  if (!['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'].includes(value.stock_status)) errors.push('Choose a stock status.');
  if (!['PUBLISHED', 'WITHDRAWN'].includes(value.state)) errors.push('Choose a listing state.');
  if (value.quantity !== '') {
    if (!decimal.test(value.quantity)) errors.push('Quantity must be nonnegative with up to 4 decimals.');
    if (value.stock_status === 'UNKNOWN' || (value.stock_status === 'IN_STOCK' && Number(value.quantity) <= 0) || (value.stock_status === 'OUT_OF_STOCK' && Number(value.quantity) !== 0)) errors.push('Quantity must agree with stock: positive in stock, zero out of stock, empty when unknown.');
  }
  return errors;
}
export function canChooseProduct(product: Product, grants: Authorization[]): boolean {
  return grants.some(grant => grant.eligible && grant.brand === product.brand_id && grant.company === product.company_id);
}
function confirmed(value: unknown): void { if (!value || typeof (value as { id?: number }).id !== 'number') throw new ApiError('Save could not be confirmed. Refresh before retrying.'); }
export async function business(api: ApiClient, token: string, signal?: AbortSignal): Promise<Business> {
  const value = await api.get('/businesses/me', signal, token) as Business;
  if (!value.workspace || !Array.isArray(value.workspace.authorizations)) throw new ApiError('Dealer workspace response is incomplete.');
  return value;
}
export async function ownedPage<T>(api: ApiClient, token: string, kind: 'locations' | 'listings', page: number, signal?: AbortSignal, filters: ListingFilters = {}): Promise<Page<T>> {
  if (!Number.isInteger(page) || page < 1) throw new ApiError('Invalid page.');
  const params = new URLSearchParams({ page: String(page) });
  if (kind === 'listings') for (const [key, value] of Object.entries(filters)) if (value?.trim()) params.set(key, value.trim());
  const value = await api.get(`/businesses/me/${kind}?${params}`, signal, token) as Page<T>;
  if (!Array.isArray(value.results) || typeof value.count !== 'number') throw new ApiError('Dealer list response is incomplete.');
  return value;
}
export async function saveBusiness(api: ApiClient, token: string, legal_name: string, registration_number: string) {
  if (legal_name.length > 200 || registration_number.length > 100) throw new ApiError('Business name allows up to 200 characters; registration number allows up to 100.');
  const value = await api.get('/businesses/me', undefined, token, { method: 'PATCH', body: JSON.stringify({ legal_name: legal_name.trim(), registration_number: registration_number.trim() }) }); confirmed(value); return value;
}
export async function saveBranch(api: ApiClient, token: string, form: BranchInput, id?: number) {
  const errors = validateBranch(form); if (errors.length) throw new ApiError(errors.join(' '));
  const data = { ...Object.fromEntries(branchFields.map(([key]) => [key, form[key].trim()])), country: form.country.trim().toUpperCase(), active: form.active, visibility_state: form.visibility_state };
  const value = await api.get(`/businesses/me/locations${id ? `/${id}` : ''}`, undefined, token, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); confirmed(value); return value;
}
export async function saveListing(api: ApiClient, token: string, form: InventoryInput, selected: { location: number; product: number; variant: number | null }, id?: number) {
  const errors = validateInventory(form); if (errors.length) throw new ApiError(errors.join(' '));
  if (!id && (!selected.location || !selected.product)) throw new ApiError('Select an owned branch and authorized catalogue product.');
  const data = { selling_price: form.selling_price, currency: form.currency, stock_status: form.stock_status, state: form.state, quantity: form.quantity === '' ? null : form.quantity, ...(!id ? selected : {}) };
  const value = await api.get(`/businesses/me/listings${id ? `/${id}` : ''}`, undefined, token, { method: id ? 'PATCH' : 'POST', body: JSON.stringify(data) }); confirmed(value); return value;
}
export async function withdrawListing(api: ApiClient, token: string, id: number) {
  const value = await api.get(`/businesses/me/listings/${id}`, undefined, token, { method: 'PATCH', body: JSON.stringify({ state: 'WITHDRAWN' }) }); confirmed(value); if ((value as {id:number;state:string}).id !== id || (value as {state:string}).state !== 'WITHDRAWN') throw new ApiError('Withdrawal could not be confirmed. Refresh inventory.'); return value;
}

export async function reactivateListing(api: ApiClient, token: string, id: number) {
  const value = await api.get(`/businesses/me/listings/${id}`, undefined, token, {method:'PATCH',body:JSON.stringify({state:'PUBLISHED'})}) as {id?:number;state?:string};
  if(value?.id!==id||value.state!=='PUBLISHED')throw new ApiError('Reactivation could not be confirmed. Refresh inventory.');
  return value;
}
