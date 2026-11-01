export type Category = { id: number; name: string; active: boolean };
export type Variant = { id: number; product: number; sku: string; name: string; attributes: Record<string, unknown>; active: boolean };
export type Product = {
  id: number; name: string; code: string; brand_id?: number; company_id?: number; brand_name: string; company_name: string; category_name: string;
  description: string; specifications: Record<string, unknown>; unit: string;
  catalogue_price: string | null; currency: string; variants: Variant[];
};
export type Branch = { id: number; branch_name: string; address: string; pin_code: string; locality: string; district: string; state: string; country: string };
export type Listing = {
  id: number; business_id: number; business_name: string; location: number; product: number; product_name: string;
  variant: number | null; selling_price: string; currency: string; stock_status: 'IN_STOCK' | 'OUT_OF_STOCK' | 'UNKNOWN';
  quantity: string | null; branch: Branch;
};
export type Page<T> = { count: number; next: string | null; previous: string | null; results: T[] };
export type Discovery = Page<Listing> & { match_level: string };
export type CatalogueFilters = { search?: string; category?: string; brand?: string };
export type DealerFilters = { variant?: string; pin_code?: string; locality?: string; district?: string; stock_status?: string };

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 0, code?: string) { super(message); this.status = status; this.code = code; }
}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('Unexpected API response.');
  return value as Record<string, unknown>;
};
const text = (value: unknown): string => { if (typeof value !== 'string') throw new ApiError('Unexpected API field.'); return value; };
const number = (value: unknown): number => { if (typeof value !== 'number' || !Number.isFinite(value)) throw new ApiError('Unexpected numeric API field.'); return value; };
const nullable = (value: unknown): string | null => value === null ? null : text(value);
const array = (value: unknown): unknown[] => { if (!Array.isArray(value)) throw new ApiError('Unexpected API list.'); return value; };
export function mapProduct(value: unknown): Product {
  const p = object(value);
  return {
    id: number(p.id), name: text(p.name), code: text(p.code), brand_id: typeof p.brand_id === 'number' ? p.brand_id : undefined, company_id: typeof p.company_id === 'number' ? p.company_id : undefined, brand_name: text(p.brand_name), company_name: text(p.company_name), category_name: text(p.category_name),
    description: text(p.description), specifications: object(p.specifications), unit: text(p.unit), catalogue_price: nullable(p.catalogue_price), currency: text(p.currency),
    variants: array(p.variants).map(value => { const v = object(value); return { id: number(v.id), product: number(v.product), name: text(v.name), sku: text(v.sku), attributes: object(v.attributes), active: v.active === true }; }).filter(v => v.active),
  };
}
export function mapListing(value: unknown): Listing {
  const item = object(value), b = object(item.branch);
  const stock = text(item.stock_status);
  if (!['IN_STOCK', 'OUT_OF_STOCK', 'UNKNOWN'].includes(stock)) throw new ApiError('Unexpected stock status.');
  // Explicit projection prevents private contacts from entering mobile view models.
  return {
    id: number(item.id), business_id: number(item.business_id), business_name: text(item.business_name), location: number(item.location), product: number(item.product), product_name: text(item.product_name),
    variant: item.variant === null ? null : number(item.variant), selling_price: text(item.selling_price), currency: text(item.currency), stock_status: stock as Listing['stock_status'], quantity: nullable(item.quantity),
    branch: { id: number(b.id), branch_name: text(b.branch_name), address: text(b.address), pin_code: text(b.pin_code), locality: text(b.locality), district: text(b.district), state: text(b.state), country: text(b.country) },
  };
}
function mapPage<T>(value: unknown, map: (value: unknown) => T): Page<T> {
  const p = object(value);
  return { count: number(p.count), next: nullable(p.next), previous: nullable(p.previous), results: array(p.results).map(map) };
}
export function query(filters: Record<string, string | undefined>, page: number): string {
  if (!Number.isInteger(page) || page < 1) throw new ApiError('Page must be a positive integer.');
  const params = new URLSearchParams({ page: String(page) });
  for (const [key, value] of Object.entries(filters)) if (value?.trim()) params.set(key, value.trim());
  return params.toString();
}

export class ApiClient {
  base: string;
  transport: typeof fetch;
  constructor(base: string, transport: typeof fetch = fetch) { this.base = base.replace(/\/+$/, ''); this.transport = transport; }
  async get(path: string, signal?: AbortSignal, token?: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.base) throw new ApiError('Set EXPO_PUBLIC_API_URL to a reachable development API URL, then restart Expo.');
    let url: URL;
    try { url = new URL(this.base); } catch { throw new ApiError('EXPO_PUBLIC_API_URL must be an absolute HTTP(S) API base URL.'); }
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new ApiError('API URL must use HTTP(S) and contain no credentials.');
    if (url.search || url.hash) throw new ApiError('API base URL cannot contain query parameters or fragments.');
    let response: Response;
    try { response = await this.transport(`${this.base}${path}`, { ...init, signal, headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } }); }
    catch (error) { if (signal?.aborted) throw error; throw new ApiError('Cannot reach SmartTrade. Check the API URL, device network and local server.'); }
    if (!response.ok) {
      if (init.method || (path.startsWith('/companies') || path.startsWith('/businesses'))) {
        const error = await response.json().catch(() => ({})) as Record<string, unknown>;
        const fields = error.field_errors ?? Object.fromEntries(Object.entries(error).filter(([key]) => !['message', 'code', 'detail'].includes(key)));
        const describe = (value: unknown): string => typeof value === 'string' ? value : Array.isArray(value) ? value.map(describe).join(' ') : value && typeof value === 'object' ? Object.entries(value).map(([key, val]) => `${key}: ${describe(val)}`).join(' ') : '';
        throw new ApiError([typeof error.message === 'string' ? error.message : 'The request could not be completed.', describe(fields)].filter(Boolean).join(' '), response.status, typeof error.code === 'string' ? error.code : undefined);
      }
      if (response.status === 401) throw new ApiError('Your session is no longer valid. Sign in again to discover dealers.', 401);
      if (response.status === 403) throw new ApiError('This account cannot access dealer discovery.', 403);
      if (response.status === 404) throw new ApiError('This product is no longer available.', 404);
      throw new ApiError(response.status >= 500 ? 'SmartTrade is temporarily unavailable. Retry shortly.' : 'The search could not be completed. Check your filters.', response.status);
    }
    if (response.status === 204) return undefined;
    try { return await response.json(); } catch { throw new ApiError('SmartTrade returned an unreadable response.'); }
  }
  async post(path: string, data: unknown, token?: string) {
    return this.get(path, undefined, token, { method: 'POST', body: JSON.stringify(data) });
  }
  async products(filters: CatalogueFilters, page: number, signal?: AbortSignal) {
    if (filters.brand && !/^\d+$/.test(filters.brand.trim())) throw new ApiError('Brand ID must contain digits only.');
    return mapPage(await this.get(`/catalogue/products?${query(filters, page)}`, signal), mapProduct);
  }
  async product(id: number, signal?: AbortSignal) { return mapProduct(await this.get(`/catalogue/products/${id}`, signal)); }
  async categories(page: number, signal?: AbortSignal) {
    return mapPage(await this.get(`/catalogue/categories?page=${page}`, signal), value => { const c = object(value); return { id: number(c.id), name: text(c.name), active: c.active === true }; });
  }
  async dealers(product: number, filters: DealerFilters, page: number, token: string | null, signal?: AbortSignal): Promise<Discovery> {
    if (!token) throw new ApiError('Sign in is required to discover dealer branches.', 401);
    const value = await this.get(`/dealers/listings?${query({ ...filters, product: String(product) }, page)}`, signal, token);
    return { ...mapPage(value, mapListing), match_level: text(object(value).match_level) };
  }
  async validateSession(token: string) {
    if (!token) throw new ApiError('Sign in required.', 401);
    const account = object(object(await this.get('/auth/me', undefined, token)).account);
    if (account.access_state !== 'ACTIVE') throw new ApiError('This account is restricted.', 403);
  }
}
