import {businessLabel} from './businessCopy';
import { FormEvent, useEffect, useState } from 'react';
import { ensureList, requestApi } from './api';
import { inr, istDateTime } from './india';

type Line={id:number;product_name:string;product_code:string;variant_sku:string|null;quantity:string;requirement:string};
type QuoteLine={id:number;product_name:string;variant_sku:string|null;quantity:string;unit_price:string;currency:string;line_total:string};
type Quote={id:number;revision:number;state:string;effective_state:string;valid_until:string;created_at:string;total:string;items:QuoteLine[]};
type Enquiry={id:number;buyer_id:number;branch_id:number;branch_name:string;dealer_business_id:number;dealer_business_name:string;requirements:string;notes:string;state:string;created_at:string;items:Line[];quotations:Quote[]};
type Page={count:number;next:string|null;previous:string|null;results:Enquiry[]};

export default function Enquiries({baseUrl,token,permissions}:{baseUrl:string;token:string;permissions:string[]}){
 const allowed=permissions.includes('READ_REPORTS');
 const[page,setPage]=useState(1),[state,setState]=useState(''),[applied,setApplied]=useState(''),[data,setData]=useState<Page>({count:0,next:null,previous:null,results:[]}),[selected,setSelected]=useState<Enquiry|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(''),[version,setVersion]=useState(0);
 useEffect(() => {
   if (!allowed) return;
   const controller = new AbortController();
   setLoading(true); setError('');
   const params = new URLSearchParams({page: String(page)});
   if (applied) params.set('state', applied);
   void requestApi<Page>(baseUrl, `/staff/enquiries?${params}`, token, {signal: controller.signal})
     .then(value => {ensureList(value, true); if (!controller.signal.aborted) setData(value);})
     .catch(failure => {
       if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Enquiries unavailable.');
     })
     .finally(() => {if (!controller.signal.aborted) setLoading(false);});
   return () => controller.abort();
 }, [allowed, applied, baseUrl, page, token, version]);
 async function inspect(id:number){setError('');try{setSelected(await requestApi<Enquiry>(baseUrl,`/staff/enquiries/${id}`,token));}catch(failure){setError(failure instanceof Error?failure.message:'Could not load this enquiry. Try again.')}}
 function filter(event:FormEvent){event.preventDefault();setApplied(state);setPage(1)}
 if(!allowed)return <section className="state-panel"><h2>Customer enquiries</h2><p>You need permission to view enquiries and quotes.</p></section>;
 return <section className="queue-section"><h2>Customer enquiries</h2><p>View customer enquiries and dealer quotes. Accepted quotes can become orders and invoices.</p><form onSubmit={filter} className="decision-buttons"><label>Status<select value={state} onChange={event=>setState(event.target.value)}><option value="">All</option>{['SUBMITTED','QUOTED','ACCEPTED','REJECTED','DECLINED'].map(value=><option key={value} value={value}>{businessLabel(value)}</option>)}</select></label><button className="button button-quiet">Filter</button><button type="button" className="button button-quiet" onClick={()=>setVersion(value=>value+1)}>Refresh</button></form>{loading?<p role="status">Loading enquiries…</p>:error?<div role="alert"><p>{error}</p><button className="button button-quiet" onClick={()=>setVersion(value=>value+1)}>Retry</button></div>:<>{data.results.length===0&&<p className="empty-state">No enquiries match this filter.</p>}{data.results.map(item=><article className="detail-card" key={item.id}><div className="record-heading"><h3>Enquiry {item.id}</h3><span className="status-pill" data-status={item.state}>{businessLabel(item.state)}</span></div><p>{item.dealer_business_name} · {item.branch_name} · branch {item.branch_id}</p><p>Buyer {item.buyer_id} · {istDateTime(item.created_at)} · {item.items.length} item(s) · {item.quotations.length} revision(s)</p><button className="btn-secondary" onClick={()=>void inspect(item.id)}>View enquiry</button></article>)}<div className="decision-buttons"><button className="button button-quiet" disabled={!data.previous} onClick={()=>setPage(value=>value-1)}>Previous</button><span>Page {page} · {data.count} enquiries</span><button className="button button-quiet" disabled={!data.next} onClick={()=>setPage(value=>value+1)}>Next</button></div></>}{selected&&<article className="detail-card"><h3>Enquiry {selected.id} and quote history</h3><p>Requirements: {selected.requirements||'Not provided'}</p>{selected.items.map(item=><p key={item.id}>{item.product_name} · Item code {item.variant_sku??'No variant'} · quantity {item.quantity}</p>)}{selected.quotations.length===0&&<p>No quotes have been sent.</p>}{selected.quotations.map(quote=><section key={quote.id}><h4 className="record-meta">Revision {quote.revision} <span className="status-pill" data-status={quote.effective_state}>{businessLabel(quote.effective_state)}</span></h4><p>Sent {istDateTime(quote.created_at)} · valid until {istDateTime(quote.valid_until)} · total {inr(quote.total)}</p>{quote.items.map(item=><p key={item.id}>{item.product_name} · {item.quantity} × {inr(item.unit_price)} = {inr(item.line_total)}</p>)}</section>)}</article>}</section>;
}
