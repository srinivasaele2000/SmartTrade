export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const expiredListeners = new Set<(token: string) => void>();
export function onSessionExpired(listener: (token: string) => void) {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}
function messages(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(messages);
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, item]) => messages(item).map(message => `${key}: ${message}`));
  return [];
}
function errorMessage(value: unknown, status: number): string {
  const data = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const fields = data.field_errors ? messages(data.field_errors) : Object.entries(data).filter(([key]) => !['code', 'message', 'detail'].includes(key)).flatMap(([key, value]) => messages(value).map(message => `${key}: ${message}`));
  const summary = typeof data.message === 'string' ? data.message : typeof data.detail === 'string' ? data.detail : status === 403 ? 'Your staff role does not have permission for this operation.' : `API request failed (${status}).`;
  return [summary, ...fields].join(' ');
}
export async function apiResponse(base: string, path: string, token?: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { ...init, headers: {
      Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers,
    } });
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ApiError(0, 'Cannot reach the SmartTrade API. Check the local backend and proxy, then retry.');
  }
  if (!response.ok) {
    if (response.status === 401 && token) expiredListeners.forEach(listener => listener(token));
    const data = await response.json().catch(() => null);
    throw new ApiError(response.status, errorMessage(data, response.status));
  }
  return response;
}
export async function requestApi<T>(base: string, path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await apiResponse(base, path, token, init);
  if (response.status === 204) return undefined as T;
  try { return await response.json() as T; }
  catch { throw new ApiError(response.status, 'The API returned unreadable JSON. The operation could not be confirmed; refresh before retrying.'); }
}
export function ensureList(data: unknown, paginated = false): void {
  const value = data as { results?: unknown; count?: unknown } | null;
  if (!value || !Array.isArray(value.results) || (paginated && (typeof value.count !== 'number' || value.count < 0))) throw new ApiError(0, 'The API returned an invalid list response.');
}
