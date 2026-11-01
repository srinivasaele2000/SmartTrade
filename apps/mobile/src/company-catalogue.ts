import { ApiClient, ApiError, type Page, type Product, type Category } from './api.ts';
export type Brand = { id: number; company: number; name: string; company_name: string; company_verification: string; company_activity: string; categories: Category[] };
export type Association = { id: number; brand: number; category: number };
export type OwnerProduct = Product & { brand_category: number; state: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED'; moderation_state: string };
export type Variant = Product['variants'][number] & { active: boolean };
export type ProductForm = { name: string; code: string; description: string; unit: string; specifications: string; catalogue_price: string; currency: string; state: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED' };
export const emptyProduct = (): ProductForm => ({ name: '', code: '', description: '', unit: '', specifications: '{}', catalogue_price: '', currency: '', state: 'DRAFT' });
export function objectInput(text: string, label: string): Record<string, unknown> {
  let value: unknown; try { value = JSON.parse(text); } catch { throw new ApiError(`${label} must be valid JSON.`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError(`${label} must be a JSON object.`);
  return value as Record<string, unknown>;
}
export function productPayload(form: ProductForm, association?: number) {
  if (!form.name.trim() || !form.code.trim() || !form.unit.trim()) throw new ApiError('Product name, code and unit are required.');
  if (form.name.trim().length > 200 || form.code.trim().length > 100 || form.unit.trim().length > 40) throw new ApiError('Product field exceeds its allowed length.');
  if (!['DRAFT', 'PUBLISHED', 'ARCHIVED'].includes(form.state)) throw new ApiError('Invalid publication state.');
  const amount = form.catalogue_price.trim(); const currency = form.currency.trim();
  if ((amount === '') !== (currency === '')) throw new ApiError('Provide both catalogue price and currency, or leave both empty.');
  if (amount && (!/^\d{1,14}(\.\d{1,4})?$/.test(amount) || !/^[A-Z]{3}$/.test(currency))) throw new ApiError('Use a nonnegative price (up to four decimal places) and three-letter uppercase currency.');
  return { name: form.name.trim(), code: form.code.trim(), description: form.description.trim(), unit: form.unit.trim(), specifications: objectInput(form.specifications, 'Specifications'), catalogue_price: amount || null, currency, state: form.state, ...(association === undefined ? {} : { brand_category: association }) };
}
export function variantPayload(form: { name: string; sku: string; attributes: string; active: boolean }) {
  if (!form.name.trim() || !form.sku.trim() || form.name.trim().length > 160 || form.sku.trim().length > 100) throw new ApiError('Variant name and SKU are required and must fit their allowed lengths.');
  return { name: form.name.trim(), sku: form.sku.trim(), attributes: objectInput(form.attributes, 'Attributes'), active: form.active };
}
export async function cataloguePage<T>(api: ApiClient, token: string, path: string, page = 1, signal?: AbortSignal): Promise<Page<T>> {
  if (!Number.isInteger(page) || page < 1) throw new ApiError('Invalid catalogue page.');
  const value = await api.get(`${path}${path.includes('?') ? '&' : '?'}page=${page}`, signal, token) as Page<T>;
  if (!value || !Array.isArray(value.results) || !Number.isInteger(value.count) || value.count < 0) throw new ApiError('Catalogue list response is incomplete.');
  return value;
}
export async function catalogueOptions(api: ApiClient, token: string, signal?: AbortSignal) {
  async function all<T>(path: string) {
    const rows: T[] = []; let page = 1;
    while (true) {
      const value = await cataloguePage<T>(api, token, path, page, signal); rows.push(...value.results);
      if (rows.length >= value.count) return rows;
      if (!value.results.length) throw new ApiError('Catalogue options changed during loading. Retry.');
      page++;
    }
  }
  const [brands, associations, categories] = await Promise.all([all<Brand>('/companies/me/catalogue/brands'), all<Association>('/companies/me/catalogue/brand-categories'), all<Category>('/catalogue/categories')]);
  return { brands, associations, categories };
}
export async function catalogueWrite<T extends { id: number } = { id: number }>(api: ApiClient, token: string, path: string, body: object, editing = false) {
  const value = await api.get(path, undefined, token, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(body) }) as { id?: number };
  if (!value || !Number.isInteger(value.id)) throw new ApiError('Save could not be confirmed. Refresh catalogue before retrying.');
  return value as T;
}
