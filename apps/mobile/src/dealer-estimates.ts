import {ApiClient, ApiError, type Page} from './api.ts';

export type CatalogueItem = {id: number; name: string; product_code: string; hsn_sac_code: string;
  price_per_unit: string; brand_name: string; category_name: string; image_url: string | null};
export type EstimateLine = {product: number; product_name: string; hsn_sac_code: string; unit_price: string; quantity: string};
export type Estimate = {id: number; customer_name: string; customer_mobile: string; discount_percentage: string;
  gst_type: 'CGST_SGST' | 'IGST'; gst_rate_percentage: string; status: string; items: EstimateLine[];
  totals: {total_amount: string}};
export type Bill = {id: number; bill_number: string; issued_at: string; payment_status: string;
  snapshot: Pick<Estimate, 'customer_name' | 'totals'>};

export function estimateTotals(lines: EstimateLine[], discount: string, mode: Estimate['gst_type'], rate: string) {
  const scaled = (text: string, decimals: number) => {
    if (!/^\d{1,15}(?:\.\d{0,4})?$/.test(text)) return 0n;
    const [whole, fraction = ''] = text.split('.');
    return BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
  };
  const rounded = (value: bigint, divisor: bigint) => (value + divisor / 2n) / divisor;
  const percentage = (value: string) => {
    const parsed = scaled(value, 2);
    return parsed > 10000n ? 0n : parsed;
  };
  const lineTotals = lines.map(row => rounded(scaled(row.unit_price, 4) * scaled(row.quantity, 3), 100000n));
  const subtotal = lineTotals.reduce((sum, line) => sum + line, 0n);
  const discountAmount = rounded(subtotal * percentage(discount), 10000n);
  const taxable = subtotal - discountAmount;
  const tax = rounded(taxable * percentage(rate), 10000n);
  const cgst = mode === 'CGST_SGST' ? rounded(tax, 2n) : 0n;
  const rupees = (paise: bigint) => String(paise / 100n) + '.' + String(paise % 100n).padStart(2, '0');
  return {lines: lineTotals.map(rupees), subtotal: rupees(subtotal), discount: rupees(discountAmount),
    taxable: rupees(taxable), cgst: rupees(cgst), sgst: rupees(mode === 'CGST_SGST' ? tax - cgst : 0n),
    igst: rupees(mode === 'IGST' ? tax : 0n), total: rupees(taxable + tax)};
}

export async function estimatePage<T>(api: ApiClient, path: string, page: number, token: string, signal?: AbortSignal) {
  const result = await api.get(path + '?page=' + page, signal, token) as Page<T>;
  if (!result || !Array.isArray(result.results) || typeof result.count !== 'number') throw new ApiError('Could not read the list.');
  return result;
}
