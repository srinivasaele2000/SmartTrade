import {useEffect,useState} from 'react';
import {ensureList,requestApi} from './api';
import {istDateTime} from './india';

export const auditSources = [
 {label:'Catalogue',path:'/staff/catalogue/audit'},
 {label:'Dealer authorization',path:'/staff/dealers/authorization-audit'},
 {label:'Dealer listings',path:'/staff/dealers/listing-audit'},
] as const;
type Event={id:number;action:string;actor:number;occurred_at:string;reason:string};
type Page={results:Event[];count:number;next:string|null;previous:string|null};
export default function AuditHistory({baseUrl,token,permissions}:{baseUrl:string;token:string;permissions:string[]}){
 const[source,setSource]=useState(0),[page,setPage]=useState(1),[version,setVersion]=useState(0),[data,setData]=useState<Page|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 const allowed=permissions.includes('READ_AUDIT');
 useEffect(()=>{if(!allowed)return;const abort=new AbortController();setLoading(true);setData(null);setError('');requestApi<Page>(baseUrl,`${auditSources[source].path}?page=${page}`,token,{signal:abort.signal}).then(value=>{ensureList(value,true);if(!abort.signal.aborted)setData(value);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Audit unavailable.');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[baseUrl,token,allowed,source,page,version]);
 return <section id="audit" className="queue-section"><h2>Audit history</h2><p>Available histories: catalogue, dealer authorizations and listings. Company verification and commercial histories remain in their respective workflows; this is not an exhaustive platform log.</p>{!allowed?<p>READ_AUDIT permission is required.</p>:<><div className="decision-buttons">{auditSources.map((item,index)=><button className="button button-quiet" key={item.path} aria-pressed={source===index} onClick={()=>{setSource(index);setPage(1);}}>{item.label}</button>)}<button className="button button-quiet" onClick={()=>setVersion(v=>v+1)}>Refresh audit</button></div>{loading?<p role="status">Loading audit history…</p>:error?<div role="alert"><p>{error}</p><button onClick={()=>setVersion(v=>v+1)}>Retry audit</button></div>:data&&<>{data.results.length===0&&<p>No audit events returned.</p>}{data.results.map(event=><article className="detail-card" key={event.id}><h3>{event.action}</h3><p>Event {event.id} · Actor {event.actor} · {istDateTime(event.occurred_at)}</p><p>{event.reason||'No reason recorded for this action.'}</p></article>)}<button disabled={!data.previous} onClick={()=>setPage(p=>p-1)}>Previous audit page</button><span> Page {page} · {data.count} events </span><button disabled={!data.next} onClick={()=>setPage(p=>p+1)}>Next audit page</button></>}</>}</section>;
}
