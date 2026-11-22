import {businessLabel} from './businessCopy';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureList, requestApi } from './api';
import { inr, istDateTime } from './india';

type Item = { id: number; product_name: string; variant_sku: string; quantity: string; unit_price: string; line_total: string };
type Invoice = { invoice_number: string; kind: string; issued_at: string; grand_total: string; cgst_total: string; sgst_total: string; igst_total: string };
type Audit = { id: number; action: string; actor_id: number; reason?: string; occurred_at: string };
type Order = { id: number; order_number: string; buyer_id: number; dealer_business_name: string; branch_name: string; state: string; created_at: string; items: Item[]; total: string; invoice: Invoice | null; audit?: Audit[]; invoice_audit?: Audit[] };
type Page = { count: number; next: string | null; previous: string | null; results: Order[] };

export default function Orders({ baseUrl, token, permissions }: { baseUrl: string; token: string; permissions: string[] }) {
  const allowed = permissions.includes('READ_REPORTS');
  const [data, setData] = useState<Page>({ count: 0, next: null, previous: null, results: [] });
  const [selected, setSelected] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [version, setVersion] = useState(0);
  const [query, setQuery] = useState('');
  const [state, setState] = useState('');
  const [kind, setKind] = useState('');
  const [page, setPage] = useState(1);
  const loadId = useRef(0);
  const load = useCallback(async () => {
    if (!allowed) return;
    const id = ++loadId.current;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({page: String(page)});
      if (query.trim()) params.set('q', query.trim());
      if (state) params.set('state', state);
      if (kind) params.set('invoice_kind', kind);
      const response = await requestApi<Page>(baseUrl, `/staff/orders${params.size ? `?${params}` : ''}`, token);
      ensureList(response, true);
      if (id === loadId.current) setData(response);
    } catch (caught) { if (id === loadId.current) setError(caught instanceof Error ? caught.message : 'Orders unavailable.'); }
    finally { if (id === loadId.current) setLoading(false); }
  }, [allowed, baseUrl, token, version, query, state, kind, page]);
  useEffect(() => { void load(); return () => { loadId.current++; }; }, [load]);
  async function inspect(id: number) {
    try { setSelected(await requestApi<Order>(baseUrl, `/staff/orders/${id}`, token)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Order unavailable.'); }
  }
  if (!allowed) return <section className="state-panel"><h2>Orders</h2><p>You need permission to view orders and invoices.</p></section>;
  return <section className="queue-section">
    <h2>Orders</h2>
    <p>View order progress, agreed prices, and issued invoices.</p>
    <div className="filter-grid">
      <label>Search<input value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="Order, invoice, dealer or branch" /></label>
      <label>Order status<select value={state} onChange={event => { setState(event.target.value); setPage(1); }}><option value="">All statuses</option>{['PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'READY', 'COMPLETED', 'CANCELLED'].map(value => <option key={value} value={value}>{businessLabel(value)}</option>)}</select></label>
      <label>Invoice type<select value={kind} onChange={event => { setKind(event.target.value); setPage(1); }}><option value="">All invoices</option><option value="TAX_INVOICE">Tax invoice</option><option value="BILL_OF_SUPPLY">Bill of supply</option></select></label>
    </div>
    <button className="button button-quiet" onClick={() => setVersion(value => value + 1)}>Refresh</button>
    {loading ? <p>Loading orders…</p> : error ? <p role="alert">{error}</p> : <>{data.results.length === 0 && <p className="empty-state">No orders found.</p>}{data.results.map(order => <article className="detail-card" key={order.id}><div className="record-heading"><h3>{order.order_number}</h3><span className="status-pill" data-status={order.state}>{businessLabel(order.state)}</span></div><p>Buyer {order.buyer_id} · {order.dealer_business_name} / {order.branch_name} · {istDateTime(order.created_at)}</p><p>Agreed quote total {inr(order.total)}</p><button className="btn-secondary" onClick={() => void inspect(order.id)}>View order</button></article>)}
      <div className="decision-buttons">
        <button className="button button-quiet" disabled={!data.previous} onClick={() => setPage(page - 1)}>Previous</button>
        <span>Page {page} · {data.count} orders</span>
        <button className="button button-quiet" disabled={!data.next} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </>}
    {selected && <article className="detail-card"><h3>{selected.order_number} history</h3>{selected.items.map(item => <p key={item.id}>{item.product_name} · {item.variant_sku || 'No variant'} · {item.quantity} × {inr(item.unit_price)} = {inr(item.line_total)}</p>)}<h4>Order status history</h4>{selected.audit?.map(event => <p key={event.id}>{businessLabel(event.action)} · {istDateTime(event.occurred_at)}{event.reason ? ` · ${event.reason}` : ''}</p>)}{selected.invoice ? <><h4>{businessLabel(selected.invoice.kind)} {selected.invoice.invoice_number}</h4><p>Issued {istDateTime(selected.invoice.issued_at)} · Grand total {inr(selected.invoice.grand_total)}</p><p>CGST {inr(selected.invoice.cgst_total)} · SGST {inr(selected.invoice.sgst_total)} · IGST {inr(selected.invoice.igst_total)}</p>{selected.invoice_audit?.map(event => <p key={event.id}>{businessLabel(event.action)} · {istDateTime(event.occurred_at)}</p>)}</> : <p>No invoice issued.</p>}</article>}
  </section>;
}
