import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ensureList, requestApi } from './api';
import Authorizations from './Authorizations';
import ListingAudit from './ListingAudit';

type Business = { id: number; legal_name: string; registration_number: string; verification_state: string };
type Branch = { id: number; business: number; branch_name: string; address: string; pin_code: string; locality: string; district: string; state: string; country: string; active: boolean; admin_hidden: boolean; visibility_state: string; contact_name: string; contact_phone: string; contact_email: string };
type Listing = { business_name: string; company_name: string; variant_sku: string|null; variant_name: string|null; product_code: string; eligible: boolean; id: number; business_id: number; location: number; branch_name: string; product: number; product_name: string; brand_name: string; variant: number | null; selling_price: string; currency: string; stock_status: string; quantity: string | null; state: string; company_catalogue_price: string | null; company_catalogue_currency: string };
type Mode = 'businesses' | 'locations' | 'listings';

export default function Dealers({ token, baseUrl, permissions = [] }: { token: string; baseUrl: string; permissions?: string[] }) {
  const [mode, setMode] = useState<Mode>('businesses');
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState('');
  const [appliedFilter, setAppliedFilter] = useState('');
  const [businesses, setBusinesses] = useState<Business[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [listingSearch,setListingSearch]=useState(''),[listingQuery,setListingQuery]=useState(''),[locationFilter,setLocationFilter]=useState(''),[listingState,setListingState]=useState(''),[stock,setStock]=useState(''),[auditListing,setAuditListing]=useState<number|null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [review, setReview] = useState<{ path: string; label: string; payload: object } | null>(null);
  const [reason, setReason] = useState('');
  const loadId = useRef(0);

  const request = useCallback(async <T,>(path: string, body?: object) => {
    return requestApi<T>(baseUrl, `/staff/dealers/${path}`, token, {
      method: body ? 'POST' : 'GET',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }, [token, baseUrl]);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true); setError('');
    try {
      let query = mode === 'businesses' ? '' : appliedFilter ? `&business=${encodeURIComponent(appliedFilter)}` : '';
      if(mode==='listings'){const params=new URLSearchParams();if(listingQuery)params.set('search',listingQuery);if(locationFilter)params.set('location',locationFilter);if(listingState)params.set('state',listingState);if(stock)params.set('stock_status',stock);query+='&'+params.toString();}
      async function fetchPage<T>(setRows: (rows: T[]) => void) {
        const data = await request<{ count: number; results: T[] }>(`${mode}?page=${page}${query}`);
        ensureList(data, true);
        if (id !== loadId.current) return;
        setCount(data.count); setRows(data.results);
      }
      if (mode === 'businesses') await fetchPage<Business>(setBusinesses);
      if (mode === 'locations') await fetchPage<Branch>(setBranches);
      if (mode === 'listings') await fetchPage<Listing>(setListings);
    } catch (failure) { if (id === loadId.current) setError(failure instanceof Error ? failure.message : 'Dealer API unavailable.'); }
    finally { if (id === loadId.current) setLoading(false); }
  }, [request, mode, page, appliedFilter, listingQuery, locationFilter, listingState, stock]);
  useEffect(() => { void load(); return () => { loadId.current++; }; }, [load]);

  function selectMode(next: Mode) { setMode(next); setPage(1); setReview(null); setReason(''); setNotice(''); }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!review || !reason.trim()) return;
    setSaving(true); setError(''); setNotice('');
    try { const response = await request<{id:number;admin_hidden?:boolean}>(review.path, { ...review.payload, reason: reason.trim() }); if(review.path.startsWith('locations/') && (response.id!==Number(review.path.split('/')[1]) || response.admin_hidden!==(review.payload as {hidden:boolean}).hidden)) throw new Error('Branch moderation could not be confirmed. Refresh before retrying.'); setNotice(`${review.label} recorded and audited.`); setReview(null); setReason(''); await load(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Action failed.'); }
    finally { setSaving(false); }
  }

  return <section id="dealers" className="queue-section" aria-labelledby="dealers-title">
    <div className="section-heading"><h2 id="dealers-title">Dealer businesses and branches</h2><button className="button button-quiet" disabled={loading || saving} onClick={() => void load()}>Refresh dealers</button></div>
    <p>Business verification is separate from account blocking and explicit company-issued brand authorization.</p>
    <div className="decision-buttons">{(['businesses', 'locations', 'listings'] as Mode[]).map(next => <button className={`button ${mode === next ? 'button-primary' : 'button-quiet'}`} key={next} disabled={saving} onClick={() => selectMode(next)}>{next === 'businesses' ? 'Business review' : next === 'locations' ? 'Branches' : 'Price and stock'}</button>)}</div>
    {mode !== 'businesses' && <form className="decision-buttons" onSubmit={event => { event.preventDefault(); setAppliedFilter(filter); setPage(1); }}><label htmlFor="dealer-filter">Business ID (optional)</label><input id="dealer-filter" inputMode="numeric" pattern="[0-9]*" value={filter} onChange={event => setFilter(event.target.value)} /><button className="button button-quiet">Apply filter</button></form>}
    {mode==='listings'&&<form className="detail-card" onSubmit={event=>{event.preventDefault();setListingQuery(listingSearch.trim());setPage(1);}}><h3>Search dealer inventory</h3><label htmlFor="inventory-search">Product, SKU, dealer, branch or company</label><input id="inventory-search" value={listingSearch} onChange={event=>setListingSearch(event.target.value)} /><label htmlFor="inventory-location">Branch ID (optional)</label><input id="inventory-location" inputMode="numeric" value={locationFilter} onChange={event=>{setLocationFilter(event.target.value);setPage(1);}} /><label htmlFor="inventory-state">Listing state</label><select id="inventory-state" value={listingState} onChange={event=>{setListingState(event.target.value);setPage(1);}}><option value="">All listing states</option><option value="PUBLISHED">Published</option><option value="WITHDRAWN">Withdrawn</option></select><label htmlFor="inventory-stock">Stock status</label><select id="inventory-stock" value={stock} onChange={event=>{setStock(event.target.value);setPage(1);}}><option value="">All stock states</option><option value="IN_STOCK">In stock</option><option value="OUT_OF_STOCK">Out of stock</option><option value="UNKNOWN">Unknown</option></select><button className="button button-quiet">Search inventory</button><p>Staff inspect inventory; selling prices and stock remain dealer-owned. Visibility moderation is available through the existing branch controls and requires a reason.</p></form>}
    {notice && <p className="action-message success" role="status">{notice}</p>}
    {error && <div className="action-message error" role="alert"><p>{error}</p><button className="button button-quiet" disabled={saving} onClick={() => void load()}>Retry dealer records</button></div>}
    {loading ? <p role="status">Loading dealer records…</p> : !error && count === 0 ? <div className="state-panel">No matching {mode}.</div> : !error && <>
      {mode === 'businesses' && businesses.map(item => <article className="detail-card" key={item.id}><h3>{item.legal_name || 'Business profile incomplete'} · {item.id}</h3><p>Registration: {item.registration_number || 'Not provided'} · {item.verification_state}</p><div className="decision-buttons">{(item.verification_state === 'PENDING' ? ['APPROVE', 'REJECT'] : item.verification_state === 'VERIFIED' ? ['SUSPEND'] : ['RESTORE']).map(action => <button className="button button-quiet" key={action} disabled={saving} onClick={() => { setReview({ path: `businesses/${item.id}/decision`, label: `${action} business ${item.id}`, payload: { action } }); setReason(''); }}>{action}</button>)}<button className="button button-quiet" onClick={() => { setAppliedFilter(String(item.id)); setFilter(String(item.id)); selectMode('locations'); }}>View branches</button></div></article>)}
      {mode === 'locations' && branches.map(item => <article className="detail-card" key={item.id}><h3>{item.branch_name} · branch {item.id} · business {item.business}</h3><p>{[item.address, item.locality, item.district, item.pin_code, item.state, item.country].join(', ')}</p><p>{item.active ? 'Active' : 'Inactive'} · {item.visibility_state} · {item.admin_hidden ? 'Hidden by staff' : 'Not hidden by staff'}</p><p>Private reviewer contact: {item.contact_name || 'Not provided'} · {item.contact_phone || 'No phone'} · {item.contact_email || 'No email'}</p><button className="button button-quiet" disabled={saving} onClick={() => { setReview({ path: `locations/${item.id}/moderation`, label: `${item.admin_hidden ? 'Restore' : 'Hide'} branch ${item.id}`, payload: { hidden: !item.admin_hidden } }); setReason(''); }}>{item.admin_hidden ? 'Restore branch eligibility' : 'Hide branch from discovery'}</button></article>)}
      {mode === 'listings' && listings.map(item => <article className="detail-card" key={item.id}><h3>{item.product_name} · listing {item.id}</h3><p>{item.company_name} / {item.brand_name} · {item.product_code} · SKU {item.variant_sku ?? 'product-level'}</p><p>{item.business_name} · {item.branch_name} (branch {item.location}) · business {item.business_id}</p><p>Buyer discovery: {item.eligible ? 'Currently eligible' : 'Not currently eligible / not published'}</p><p>Dealer selling price: {item.currency} {item.selling_price}</p><p>Company catalogue: {item.company_catalogue_price === null ? 'Not provided' : `${item.company_catalogue_currency} ${item.company_catalogue_price}`}</p><p>{item.state} · {item.stock_status} · quantity {item.quantity ?? 'not supplied'}</p><button className="button button-quiet" onClick={()=>{setFilter(String(item.business_id));setAppliedFilter(String(item.business_id));selectMode('locations');}}>Review branch {item.location} visibility</button>{permissions.includes('READ_AUDIT')&&<button className="button button-quiet" onClick={()=>setAuditListing(item.id)}>View listing {item.id} audit</button>}</article>)}
    </>}
    {!loading && !error && <div className="decision-buttons"><button className="button button-quiet" disabled={saving || page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {count} records</span><button className="button button-quiet" disabled={saving || page * 20 >= count} onClick={() => setPage(page + 1)}>Next</button></div>}
    {review && <form className="detail-card" onSubmit={submit}><h3>{review.label}</h3><label htmlFor="dealer-action-reason">Reason (required)</label><textarea id="dealer-action-reason" required maxLength={4000} rows={3} disabled={saving} value={reason} onChange={event => setReason(event.target.value)} /><div className="decision-buttons"><button className="button button-primary" disabled={saving || !reason.trim()}>Confirm action</button><button className="button button-quiet" type="button" disabled={saving} onClick={() => setReview(null)}>Cancel</button></div></form>}
    {mode==='listings'&&<><button className="button button-quiet" onClick={()=>setAuditListing(null)}>All listing audit events</button><ListingAudit baseUrl={baseUrl} token={token} allowed={permissions.includes('READ_AUDIT')} listing={auditListing} /></>}
    <Authorizations token={token} baseUrl={baseUrl} permissions={permissions} />
  </section>;
}
