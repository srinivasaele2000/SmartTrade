import { ApiClient, ApiError, type Page } from './api';

export type EnquiryLine = { id: number; listing_id: number; product_id: number; product_name: string; product_code: string; variant_id: number | null; variant_sku: string | null; variant_name: string | null; quantity: string; requirement: string };
export type QuoteLine = { id: number; enquiry_item_id: number; product_name: string; variant_sku: string | null; quantity: string; unit_price: string; currency: 'INR'; notes: string; line_total: string };
export type Quotation = { id: number; revision: number; state: string; effective_state: string; valid_until: string; dealer_notes: string; created_at: string; responded_at: string | null; items: QuoteLine[]; total: string };
export type Enquiry = { id: number; buyer_id: number; branch_id: number; branch_name: string; dealer_business_id: number; dealer_business_name: string; requirements: string; notes: string; state: string; created_at: string; updated_at: string; items: EnquiryLine[]; quotations: Quotation[] };
export type DraftLine = { listing: number; branch: number; branch_name: string; dealer_name: string; product_name: string; variant_sku: string | null; quantity: string; requirement: string };
export type QuoteInput = { enquiry_item: number; quantity: string; unit_price: string; currency: 'INR'; notes: string };

function validPage(value: unknown): Page<Enquiry> {
  const page = value as Page<Enquiry>;
  if (!page || !Number.isInteger(page.count) || !Array.isArray(page.results)) throw new ApiError('Enquiry list response is incomplete.');
  return page;
}
function validEnquiry(value: unknown): Enquiry {
  const item = value as Enquiry;
  if (!item || !Number.isInteger(item.id) || !Array.isArray(item.items) || !Array.isArray(item.quotations)) throw new ApiError('Enquiry response is incomplete.');
  for (const quote of item.quotations) for (const line of quote.items) if (line.currency !== 'INR') throw new ApiError('Unexpected quotation currency.');
  return item;
}
export async function enquiryPage(api: ApiClient, token: string, dealer: boolean, page = 1, signal?: AbortSignal) {
  return validPage(await api.get(`${dealer ? '/businesses/me/enquiries' : '/enquiries'}?page=${page}`, signal, token));
}
export async function createEnquiry(api: ApiClient, token: string, lines: DraftLine[], requirements: string, notes: string) {
  if (!lines.length) throw new ApiError('Add at least one dealer listing.');
  if (new Set(lines.map(line => line.branch)).size !== 1) throw new ApiError('All enquiry items must be from the same dealer branch.');
  if (lines.some(line => !/^\d{1,14}(\.\d{1,4})?$/.test(line.quantity) || Number(line.quantity) <= 0)) throw new ApiError('Each requested quantity must be positive.');
  return validEnquiry(await api.post('/enquiries', { branch: lines[0].branch, requirements: requirements.trim(), notes: notes.trim(), items: lines.map(line => ({ listing: line.listing, quantity: line.quantity, requirement: line.requirement.trim() })) }, token));
}
export async function respondQuotation(api: ApiClient, token: string, id: number, action: 'ACCEPT' | 'REJECT', reason = '') {
  if (action === 'REJECT' && !reason.trim()) throw new ApiError('A rejection reason is required.');
  return validEnquiry(await api.post(`/enquiries/${id}/response`, { action, reason: reason.trim() }, token));
}
export async function sendQuotation(api: ApiClient, token: string, enquiry: Enquiry, lines: QuoteInput[], validUntil: string, notes: string) {
  if (lines.length !== enquiry.items.length || new Set(lines.map(line => line.enquiry_item)).size !== enquiry.items.length) throw new ApiError('Quote every enquiry item exactly once.');
  if (lines.some(line => line.currency !== 'INR' || !/^\d{1,14}(\.\d{1,4})?$/.test(line.unit_price) || Number(line.unit_price) < 0 || Number(line.quantity) <= 0)) throw new ApiError('Quotation quantities and INR prices are invalid.');
  return validEnquiry(await api.post(`/businesses/me/enquiries/${enquiry.id}/quotations`, { valid_until: validUntil, dealer_notes: notes.trim(), items: lines }, token));
}
export async function declineEnquiry(api: ApiClient, token: string, id: number, reason: string) {
  if (!reason.trim()) throw new ApiError('A decline reason is required.');
  return validEnquiry(await api.post(`/businesses/me/enquiries/${id}/decline`, { reason: reason.trim() }, token));
}
