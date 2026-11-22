import {businessLabel} from './businessCopy';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ensureList, requestApi } from './api';
import { restoreCompanyActivity } from './company-actions';
import { istDateTime } from './india';

type ReviewRequest = {
  id: number; company_id: number; company_name: string; submitted_at: string;
  reason: string; verification_state: string; activity_state: string;
};

export default function ReviewRequests({ baseUrl, token, canRestore = false }: { baseUrl: string; token: string; canRestore?: boolean }) {
  const [items, setItems] = useState<ReviewRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const loadId = useRef(0);

  const request = useCallback(async <T,>(path: string, body?: { reason: string }) => {
    return requestApi<T>(baseUrl, `/staff/companies/review-requests${path}`, token, {
      method: body ? 'POST' : 'GET',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }, [baseUrl, token]);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true); setError('');
    try { const data = await request<{ results: ReviewRequest[] }>(''); ensureList(data); if (id === loadId.current) setItems(data.results); }
    catch (failure) { if (id === loadId.current) setError(failure instanceof Error ? failure.message : 'Could not load review requests.'); }
    finally { if (id === loadId.current) setLoading(false); }
  }, [request]);

  useEffect(() => { void load(); return () => { loadId.current++; }; }, [load]);

  async function resolve(event: FormEvent) {
    event.preventDefault();
    if (selected === null || !reason.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await request(`/${selected}/resolve`, { reason: reason.trim() });
      setNotice('Request resolved.');
      setSelected(null); setReason(''); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save resolution.'); }
    finally { setSaving(false); }
  }

  async function restore(companyId: number) {
    if (!reason.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try {
      await restoreCompanyActivity(baseUrl, token, companyId, reason);
      setNotice('Company restored.');
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not restore the company. Try again.'); }
    finally { setSaving(false); }
  }

  return <section id="review-requests" className="queue-section" aria-labelledby="review-request-title">
    <div className="section-heading"><h2 id="review-request-title">Approval requests</h2><button className="button button-quiet" disabled={loading || saving} onClick={() => void load()}>Refresh requests</button></div>
    <p>Review requests from rejected or suspended companies. To restore a suspended company, use the separate restore action.</p>
    {notice && <p role="status" className="action-message success">{notice}</p>}
    {error && <div role="alert" className="action-message error"><p>{error}</p><button className="button button-quiet" disabled={saving} onClick={() => void load()}>Retry review requests</button></div>}
    {loading ? <p role="status">Loading review requests…</p> : !error && items.length === 0 ? <div className="state-panel">No open company review requests.</div> : !error && items.map(item => <article className="detail-card" key={item.id}>
      <h3>{item.company_name}</h3>
      <p className="record-meta">Company {item.company_id} <span className="status-pill" data-status={item.verification_state}>{businessLabel(item.verification_state)}</span> <span className="status-pill" data-status={item.activity_state}>{businessLabel(item.activity_state)}</span></p>
      <p>Submitted {istDateTime(item.submitted_at)}</p>
      <p className="request-reason">{item.reason}</p>
      {selected === item.id ? <form onSubmit={resolve}>
        <label htmlFor={`resolution-${item.id}`}>Reason for resolving the request</label>
        <textarea id={`resolution-${item.id}`} value={reason} rows={3} maxLength={4000} required disabled={saving} onChange={event => setReason(event.target.value)} />
        {canRestore && item.activity_state === 'SUSPENDED' && <p><button type="button" className="button button-quiet" disabled={saving || !reason.trim()} onClick={() => void restore(item.company_id)}>Restore company</button></p>}
        <div className="decision-buttons"><button className="btn-primary" disabled={saving || !reason.trim()}>{saving ? 'Saving…' : 'Resolve request'}</button><button className="btn-ghost" type="button" disabled={saving} onClick={() => setSelected(null)}>Cancel</button></div>
      </form> : <button className="button button-quiet" disabled={saving} onClick={() => { setSelected(item.id); setReason(''); setNotice(''); }}>Review request</button>}
    </article>)}
  </section>;
}
