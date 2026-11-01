import { ApiClient, ApiError, type Page } from './api.ts';
export type DealerIdentity = { id: number; legal_name: string; verification_state: string };
export type Grant = { id: number; company: number; company_name: string; brand: number; brand_name: string; business: number; business_name: string; active: boolean; eligible: boolean; business_verification_state: string; company_verification_state: string; company_activity_state: string; reason: string; actor: number; updated_at: string };
export async function authorizationPage<T>(api: ApiClient, token: string, kind: 'dealers' | 'dealer-authorizations', page: number, search: string, active = '', signal?: AbortSignal): Promise<Page<T>> {
 if (!Number.isInteger(page) || page < 1 || !['','true','false'].includes(active)) throw new ApiError('Invalid authorization filter.');
 const query = new URLSearchParams({page:String(page),search:search.trim()});if(kind==='dealer-authorizations'&&active)query.set('active',active);
 const value = await api.get(`/companies/me/${kind}?${query}`,signal,token) as Page<T>;
 if (!value || !Array.isArray(value.results) || !Number.isInteger(value.count) || value.count < 0) throw new ApiError('Authorization response is incomplete.');
 return value;
}
export async function changeAuthorization(api: ApiClient, token: string, brand: number, business: number, active: boolean, reason: string): Promise<Grant> {
 if (!Number.isInteger(brand)||brand<=0||!Number.isInteger(business)||business<=0||!reason.trim()||reason.trim().length>4000)throw new ApiError('Choose an owned brand and dealer, and provide a reason of up to 4000 characters.');
 const value=await api.post('/companies/me/dealer-authorizations',{brand,business,active,reason:reason.trim()},token) as Grant;
 if(!value||!Number.isInteger(value.id)||value.brand!==brand||value.business!==business||value.active!==active)throw new ApiError('Authorization change could not be confirmed. Refresh before retrying.');
 return value;
}
