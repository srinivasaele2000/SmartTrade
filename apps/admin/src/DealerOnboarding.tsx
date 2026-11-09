import {useCallback, useEffect, useState} from 'react';
import {requestApi} from './api';
import {istDateTime} from './india';

type Suggestion = {id: number; name: string; context: string; status: string; canonical_brand: number | null};
type Duplicate = {business: number; signals: string[]; fingerprint: string; decision: {outcome: string; reason: string; at: string} | null};
type Details = {
  profile: Record<string, string>;
  declarations: {categories: string[]; brands: {id: number; name: string; company_name: string}[]};
  suggestions: Suggestion[];
  duplicates: Duplicate[];
  reviews: {action: string; actor: number; reason: string; at: string; snapshot: Record<string, unknown>}[];
};
type ContactPage = {count: number; next: string | null; previous: string | null; results: {
  id: number; name: string; mobile_e164: string; trade: string; location: string; consent_confirmed_at: string;
}[]};
type Review = {label: string; path: string; body: object; mapping?: boolean};

export default function DealerOnboarding({id, baseUrl, token, canReviewContacts, close}: {
  id: number; baseUrl: string; token: string; canReviewContacts: boolean; close: () => void;
}) {
  const base = '/staff/dealers/businesses/' + id;
  const [details, setDetails] = useState<Details | null>(null);
  const [contacts, setContacts] = useState<ContactPage | null>(null);
  const [contactPage, setContactPage] = useState(1);
  const [review, setReview] = useState<Review | null>(null);
  const [reason, setReason] = useState(''), [brand, setBrand] = useState('');
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [revision, refresh] = useState(0);
  const request = useCallback(<T,>(path: string, init?: RequestInit) =>
    requestApi<T>(baseUrl, base + path, token, init), [baseUrl, base, token]);

  useEffect(() => {
    let current = true;
    setLoading(true); setError('');
    void request<Details>('/onboarding').then(value => {
      if (current) setDetails(value);
    }, failure => {
      if (current) {setDetails(null); setError(failure.message);}
    }).finally(() => {if (current) setLoading(false);});
    return () => {current = false;};
  }, [request, revision]);

  async function loadContacts(number: number) {
    setSaving(true); setError('');
    try {
      setContacts(await request<ContactPage>('/trade-contacts?page=' + number));
      setContactPage(number);
    } catch (failure) {
      setContacts(null);
      setError(failure instanceof Error ? failure.message : 'Cannot load private contacts.');
    } finally {setSaving(false);}
  }

  function startReview(value: Review) {setReview(value); setReason(''); setBrand(''); setNotice('');}

  return <section className="detail-card" aria-label="Dealer onboarding review">
    <h3>Onboarding review · business {id}</h3>
    <div className="decision-buttons">
      <button className="button button-quiet" type="button" onClick={close}>Close review</button>
      <button className="button button-quiet" type="button" disabled={loading || saving} onClick={() => refresh(n => n + 1)}>Refresh review</button>
    </div>
    {error && <p role="alert" className="action-message error">{error}</p>}
    {notice && <p role="status" className="action-message success">{notice}</p>}
    {loading && <p role="status">Loading dealer onboarding…</p>}
    {details && <>
      <h4>Business identity</h4>
      <p>{details.profile.legal_name || 'Name not provided'} · {details.profile.verification_state}</p>
      <dl>{Object.entries({
        owner_name: 'Owner or authorized person', business_email: 'Business email', registration_number: 'Registration reference',
        gstin: 'GSTIN', pan: 'PAN', registered_address: 'Registered address', registered_locality: 'Locality',
        registered_district: 'District', registered_state: 'State', registered_pin_code: 'PIN',
      }).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{details.profile[key] || 'Not provided'}</dd></div>)}</dl>
      <h4>Dealer declarations</h4>
      <p>{details.declarations.categories.join(', ') || 'No categories declared.'}</p>
      <ul>{details.declarations.brands.map(item => <li key={item.id}>{item.name} · {item.company_name} · brand {item.id}</li>)}</ul>
      <p>Declarations are independent of company authorization.</p>
      <h4>Other-brand suggestions</h4>
      {details.suggestions.length === 0 && <p>No suggestions.</p>}
      {details.suggestions.map(item => <article key={item.id}>
        <p><strong>{item.name}</strong> · {item.status}{item.canonical_brand && ' · brand ' + item.canonical_brand}</p>
        {item.context && <p>{item.context}</p>}
        {item.status === 'PENDING' && <div className="decision-buttons">
          {(['APPROVED', 'REJECTED', 'MAPPED'] as const).map(action =>
            <button className="button button-quiet" key={action} disabled={saving} onClick={() => startReview({
              path: '/brand-suggestions/' + item.id + '/review', label: action + ' ' + item.name, body: {action}, mapping: action === 'MAPPED',
            })}>{action === 'APPROVED' ? 'Approve for follow-up' : action === 'REJECTED' ? 'Reject' : 'Map to existing brand'}</button>)}
        </div>}
      </article>)}
      <h4>Potential duplicate identities</h4>
      {details.duplicates.length === 0 && <p>No potential matches found.</p>}
      {details.duplicates.map(item => <article key={item.fingerprint}>
        <p>Business {item.business} · {item.signals.join(', ')}</p>
        {item.decision && <p>{item.decision.outcome} · {istDateTime(item.decision.at)} · {item.decision.reason}</p>}
        <div className="decision-buttons">
          {(['DISTINCT', 'NEEDS_FOLLOW_UP'] as const).map(outcome => <button className="button button-quiet" key={outcome}
            disabled={saving} onClick={() => startReview({
              path: '/duplicate-review', label: outcome + ' · business ' + item.business, body: {outcome, fingerprint: item.fingerprint},
            })}>{outcome === 'DISTINCT' ? 'Record distinct businesses' : 'Flag for follow-up'}</button>)}
        </div>
      </article>)}
      {review && <form className="detail-card" onSubmit={async event => {
        event.preventDefault();
        if (saving || !reason.trim()) return;
        setSaving(true); setError(''); setNotice('');
        try {
          await request(review.path, {method: 'POST', body: JSON.stringify({
            ...review.body, reason: reason.trim(), ...(review.mapping ? {brand: Number(brand)} : {}),
          })});
          setReview(null); setNotice('Review recorded.'); refresh(n => n + 1);
        } catch (failure) {setError(failure instanceof Error ? failure.message : 'Review failed.');}
        finally {setSaving(false);}
      }}>
        <h4>{review.label}</h4>
        {review.mapping && <label>Existing canonical brand ID <input type="number" min="1" required value={brand} onChange={event => setBrand(event.target.value)} /></label>}
        <label>Review reason <textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} /></label>
        <button className="button button-primary" disabled={saving || !reason.trim()}>Record review</button>
        <button className="button button-quiet" type="button" disabled={saving} onClick={() => setReview(null)}>Cancel</button>
      </form>}
      <h4>Recent review history</h4>
      {details.reviews.length === 0 && <p>No review events.</p>}
      <ul>{details.reviews.map((row, index) => <li key={index}>{istDateTime(row.at)} · staff {row.actor} · {row.action} · {String(row.snapshot.status ?? row.snapshot.outcome ?? '')} · {row.reason}</li>)}</ul>
      {canReviewContacts && <>
        <h4>Restricted trade-worker consent records</h4>
        <button className="button button-quiet" disabled={saving} onClick={() => void loadContacts(1)}>Load private contacts</button>
        {contacts && <>
          {contacts.count === 0 && <p>No contacts saved.</p>}
          <ul>{contacts.results.map(row => <li key={row.id}>{row.name} · {row.mobile_e164} · {row.trade} · {row.location || 'No location'} · Permission reported {istDateTime(row.consent_confirmed_at)}</li>)}</ul>
          <div className="decision-buttons">
            <button className="button button-quiet" disabled={saving || !contacts.previous} onClick={() => void loadContacts(contactPage - 1)}>Previous contacts</button>
            <span>Page {contactPage} · {contacts.count} contacts</span>
            <button className="button button-quiet" disabled={saving || !contacts.next} onClick={() => void loadContacts(contactPage + 1)}>Next contacts</button>
          </div>
        </>}
      </>}
    </>}
  </section>;
}
