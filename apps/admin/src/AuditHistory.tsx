import {businessLabel} from './businessCopy';
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
 useEffect(()=>{if(!allowed)return;const abort=new AbortController();setLoading(true);setData(null);setError('');requestApi<Page>(baseUrl,`${auditSources[source].path}?page=${page}`,token,{signal:abort.signal}).then(value=>{ensureList(value,true);if(!abort.signal.aborted)setData(value);}).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:'Could not load the activity log. Try again.');}).finally(()=>{if(!abort.signal.aborted)setLoading(false);});return()=>abort.abort();},[baseUrl,token,allowed,source,page,version]);
 return <section id="audit" className="queue-section"><h2>Activity log</h2><p>See changes to the catalogue, dealer permissions, and listings. Find company reviews and order history on their own pages.</p>{!allowed?<p>You need permission to view the activity log.</p>:<><div className="decision-buttons tab-strip">{auditSources.map((item,index)=><button className="button button-quiet" key={item.path} aria-pressed={source===index} onClick={()=>{setSource(index);setPage(1);}}>{item.label}</button>)}<button className="button button-quiet" onClick={()=>setVersion(v=>v+1)}>Refresh activity</button></div>{loading?<p role="status">Loading activity…</p>:error?<div role="alert"><p>{error}</p><button onClick={()=>setVersion(v=>v+1)}>Try again</button></div>:data&&<>{data.results.length===0&&<p className="empty-state">No activity found.</p>}{data.results.map(event=><article className="detail-card" key={event.id}><h3>{businessLabel(event.action)}</h3><p>Event {event.id} · Changed by user {event.actor} · {istDateTime(event.occurred_at)}</p><p>{event.reason||'No reason recorded for this action.'}</p></article>)}<button disabled={!data.previous} onClick={()=>setPage(p=>p-1)}>Previous page</button><span> Page {page} · {data.count} events </span><button disabled={!data.next} onClick={()=>setPage(p=>p+1)}>Next page</button></>}</>}</section>;
}
