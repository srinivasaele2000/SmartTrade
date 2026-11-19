import {ApiClient, ApiError, type Page} from './api.ts';

export type CatalogueItem = {id: number; name: string; product_code: string; hsn_sac_code: string;
  price_per_unit: string; brand_name: string; category_name: string; sub_category?: string; image_url: string | null};
export type EstimateLine = {product: number | null; dealer_custom_item?: number | null; list_price_per_unit?: string | null;
  product_name: string; product_code?: string; hsn_sac_code: string;
  unit_price: string; quantity: string; line_total?: string; net_unit_rate?: string;
  discount_mode?: 'PERCENT' | 'AMOUNT'; discount_value?: string};
export type Estimate = {id: number; customer_name: string; customer_mobile: string; discount_percentage: string;
  gst_type: 'CGST_SGST' | 'IGST'; gst_rate_percentage: string; status: string; items: EstimateLine[];
  created_at?: string;
  totals: {total_amount: string; sub_total?: string; discount_amount?: string; taxable_amount?: string;
    cgst_amount?: string; sgst_amount?: string; igst_amount?: string}};
export type Bill = {id: number; bill_number: string; issued_at: string; payment_status: string;
  snapshot: Estimate & {dealer_name?: string; dealer_gstin?: string}};

export type GeneralItem = {id: number; product_name: string; product_code: string; hsn_sac_code: string; list_price_per_unit: string};
export const generalItemPrice = /^\d{1,10}(?:\.\d{1,2})?$/;

// The document table needs one number per row. IDs from the two tables can overlap.
export const estimateLineKey = (line: EstimateLine) => line.dealer_custom_item ? -line.dealer_custom_item : line.product!;

export function scaled(text: string, decimals: number) {
  if (!/^\d{1,26}(?:\.\d{0,4})?$/.test(text)) return 0n;
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole + fraction.padEnd(decimals, '0').slice(0, decimals));
}
export const rounded = (value: bigint, divisor: bigint) => (value + divisor / 2n) / divisor;
const percentage = (value: string) => {
  const parsed = scaled(value, 2);
  return parsed > 10000n ? 0n : parsed;
};
export const rupees = (paise: bigint) => String(paise / 100n) + '.' + String(paise % 100n).padStart(2, '0');

export function validItemDiscount(row: EstimateLine) {
  const value = row.discount_value ?? '0';
  return /^\d{1,14}(?:\.\d{1,2})?$/.test(value)
    && scaled(value, 2) <= (row.discount_mode === 'AMOUNT' ? scaled(row.unit_price, 4) / 100n : 10000n);
}

function netRate(row: EstimateLine) {
  const base = scaled(row.unit_price, 4);
  const discount = scaled(row.discount_value ?? '0', 2);
  if (!discount || !validItemDiscount(row)) return base;
  return 100n * (row.discount_mode === 'AMOUNT'
    ? rounded(base - discount * 100n, 100n)
    : rounded(base * (10000n - discount), 1000000n));
}

export function estimateNetRate(row: EstimateLine) {
  const net = netRate(row);
  return net === scaled(row.unit_price, 4) ? row.unit_price : rupees(net / 100n);
}

export function estimateTotals(lines: EstimateLine[], discount: string, mode: Estimate['gst_type'], rate: string) {
  const itemDiscounts = lines.some(row => validItemDiscount(row) && scaled(row.discount_value ?? '0', 2) > 0n);
  const lineTotals = lines.map(row => rounded(netRate(row) * scaled(row.quantity, 3), 100000n));
  const subtotal = lineTotals.reduce((sum, line) => sum + line, 0n);
  const discountAmount = itemDiscounts ? 0n : rounded(subtotal * percentage(discount), 10000n);
  const taxable = subtotal - discountAmount;
  const tax = itemDiscounts
    ? lineTotals.reduce((sum, line) => sum + rounded(line * percentage(rate), 10000n), 0n)
    : rounded(taxable * percentage(rate), 10000n);
  const cgst = mode === 'CGST_SGST' ? rounded(tax, 2n) : 0n;
  return {lines: lineTotals.map(rupees), subtotal: rupees(subtotal), discount: rupees(discountAmount),
    taxable: rupees(taxable), cgst: rupees(cgst), sgst: rupees(mode === 'CGST_SGST' ? tax - cgst : 0n),
    igst: rupees(mode === 'IGST' ? tax : 0n), total: rupees(taxable + tax)};
}

export async function estimatePage<T>(api: ApiClient, path: string, page: number, token: string, signal?: AbortSignal) {
  const result = await api.get(path + (path.includes('?') ? '&' : '?') + 'page=' + page, signal, token) as Page<T>;
  if (!result || !Array.isArray(result.results) || typeof result.count !== 'number') throw new ApiError('Could not read the list.');
  return result;
}
