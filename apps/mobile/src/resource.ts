import type { Listing } from './api';

export type Resource<T> = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: T };
export type ResourceAction<T> = { type: 'loading' } | { type: 'error'; message: string } | { type: 'ready'; data: T };
export function resourceReducer<T>(_state: Resource<T>, action: ResourceAction<T>): Resource<T> {
  if (action.type === 'ready') return { status: 'ready', data: action.data };
  if (action.type === 'error') return { status: 'error', message: action.message };
  return { status: 'loading' };
}
export function variantListings(items: Listing[], variant: number | null) { return variant === null ? items : items.filter(item => item.variant === variant); }
export function inventoryLabel(item: Listing): string {
  if (item.stock_status === 'OUT_OF_STOCK') return 'Out of stock';
  if (item.stock_status === 'UNKNOWN') return 'Availability not confirmed';
  return item.quantity === null ? 'In stock' : `In stock · quantity ${item.quantity}`;
}
export function matchLabel(level: string): string {
  return ({ PIN_CODE: 'Matched PIN/postal code', LOCALITY: 'Locality match — PIN match unavailable or not supplied', DISTRICT: 'District match — broader fallback', NO_LOCATION_MATCH: 'No location matches', UNFILTERED: 'All locations — no location filter applied' } as Record<string, string>)[level] ?? 'Location match not specified';
}
