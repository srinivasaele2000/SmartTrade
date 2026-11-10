import type {ApiClient, Product} from './api.ts';

export type BrowseFilter = 'all' | 'stock' | 'pdf' | 'authorized';
export type Availability = {authorized: boolean; inStock: boolean | null};

export function matchesBrowseFilter(product: Product, filter: BrowseFilter, availability?: Availability) {
  switch (filter) {
    case 'pdf': return Boolean(product.catalogue_pdf_url);
    case 'stock': return availability?.inStock === true;
    case 'authorized': return availability?.authorized === true;
    default: return true;
  }
}

export async function loadBrowseAvailability(api: Pick<ApiClient, 'dealers'>, ids: number[], token: string, signal: AbortSignal) {
  const byProduct = new Map<number, Availability>();
  let index = 0;
  async function worker() {
    while (index < ids.length && !signal.aborted) {
      const id = ids[index++];
      try {
        const page = await api.dealers(id, {}, 1, token, signal);
        const authorized = page.count > 0;
        let inStock: boolean | null = page.results.some(listing => listing.stock_status === 'IN_STOCK');
        if (!inStock && page.next) {
          try { inStock = (await api.dealers(id, {stock_status: 'IN_STOCK'}, 1, token, signal)).count > 0; }
          catch { inStock = null; }
        }
        if (!signal.aborted) byProduct.set(id, {authorized, inStock});
      } catch {
        // Failed checks stay unknown so the UI never labels them as unavailable.
      }
    }
  }
  await Promise.all(Array.from({length: Math.min(ids.length, 4)}, worker));
  return byProduct;
}
