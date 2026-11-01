import { requestApi } from './api.ts';

export async function restoreCompanyActivity(baseUrl: string, token: string, companyId: number, reason: string) {
  if (!Number.isInteger(companyId) || companyId <= 0 || !reason.trim() || reason.trim().length > 4000) throw new Error('A company and a valid restoration reason are required.');
  const result = await requestApi<{ company?: { id?: number; activity_state?: string } }>(baseUrl, `/staff/companies/${companyId}/restore`, token, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
  if (result.company?.id !== companyId || result.company.activity_state !== 'ACTIVE') throw new Error('Restoration could not be confirmed. Refresh requests before retrying.');
  return result.company;
}
