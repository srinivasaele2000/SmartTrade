import {businessLabel} from './businessCopy.ts';

export class ApiError extends Error {
  status: number;
  readonly fieldErrors?: Record<string, unknown>;
  constructor(status: number, message: string, fieldErrors?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}
const expiredListeners = new Set<(token: string) => void>();
export function onSessionExpired(listener: (token: string) => void) {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}
const fieldLabels: Record<string, string> = {
  mobile_e164: 'Mobile number',
  product_code: 'Item code',
  price_per_unit: 'Unit price',
  brand_category: 'Brand and category',
  category_id: 'Category',
  hsn_sac_code: 'HSN / SAC',
  row_errors: 'Products to review',
  non_field_errors: 'Please check your entries',
};

function plainMessage(value: unknown): string {
  if (typeof value !== 'string' || /^\s*[\[{<]/.test(value) || /^\s*[A-Z]+(?:_[A-Z]+)+\s*$/.test(value) ||
      /traceback|\bHTTP\s*\d|API request failed|unreadable JSON/i.test(value)) return '';
  if (/^given token not valid/i.test(value)) return 'Your session expired. Sign in again.';
  if (/^request validation failed\.?$/i.test(value)) return 'Check your entries and try again.';
  return value.replace(/\bSKU\b/g, 'item code');
}

function messages(value: unknown): string[] {
  if (typeof value === 'string') return [plainMessage(value)].filter(Boolean);
  if (Array.isArray(value)) return value.flatMap(messages);
  if (value && typeof value === 'object') return Object.entries(value)
    .flatMap(([key, item]) => messages(item).map(message => `${fieldLabels[key] ?? businessLabel(key)}: ${message}`));
  return [];
}
function errorMessage(value: unknown, status: number): string {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (data.code === 'AUTH_PROVIDER_UNAVAILABLE') return 'Sign-in codes are unavailable. Try again later or contact your administrator.';
  if (status >= 500) return 'The service could not complete your request. Try again in a moment.';
  const fields = messages(data.field_errors ?? Object.fromEntries(
    Object.entries(data).filter(([key]) => !['code', 'message', 'detail'].includes(key)),
  ));
  const defaultMessage = status === 403 ? 'You don’t have permission to do this.'
    : status === 404 ? 'This item could not be found. Refresh the page and try again.'
    : 'Could not complete your request. Check your entries and try again.';
  const summary = plainMessage(data.message) || plainMessage(data.detail) || defaultMessage;
  return [summary, ...fields].join(' ');
}
export async function apiResponse(base: string, path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers: {
      Accept: 'application/json', ...(init.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers,
    } });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, 'Cannot reach SmartTrade. Check your connection and try again.');
  }
  if (!response.ok) {
    if (response.status === 401 && token) {
      expiredListeners.forEach(listener => listener(token));
      throw new ApiError(401, 'Your session expired. Sign in again to continue.');
    }
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, errorMessage(data, response.status), data?.field_errors);
  }
  return response;
}
export async function requestApi<T>(base: string, path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await apiResponse(base, path, token, init);
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new ApiError(response.status, 'Your request could not be confirmed. Refresh the page and check before trying again.'); }
}
export function ensureList(data: unknown, paginated = false): void {
  const value = data as { results?: unknown; count?: unknown } | null;
  if (!value || !Array.isArray(value.results) || (paginated && (typeof value.count !== 'number' || value.count < 0))) throw new ApiError(0, 'Could not load the list. Refresh the page and try again.');
}
