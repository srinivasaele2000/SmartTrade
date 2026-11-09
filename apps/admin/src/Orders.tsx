import { useCallback, useEffect, useState } from 'react';
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
  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set('q', query.trim());
      if (state) params.set('state', state);
      if (kind) params.set('invoice_kind', kind);
      const response = await requestApi<Page>(baseUrl, `/staff/orders${params.size ? `?${params}` : ''}`, token);
      ensureList(response, true); setData(response);
    } catch (caught) { setError(caught instanceof Error ? caught.message : 'Orders unavailable.'); }
    finally { setLoading(false); }
  }, [allowed, baseUrl, token, version, query, state, kind]);
  useEffect(() => { void load(); }, [load]);
  async function inspect(id: number) {
    try { setSelected(await requestApi<Order>(baseUrl, `/staff/orders/${id}`, token)); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Order unavailable.'); }
  }
  if (!allowed) return <section className="state-panel"><h2>Orders and invoices</h2><p>READ_REPORTS permission is required.</p></section>;
  return <section className="queue-section">
    <h2>Orders and invoices</h2>
    <p>Read-only inspection of immutable commercial records. Staff cannot alter order or invoice state here.</p>
    <div className="filter-grid">
      <label>Search<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Order, invoice, dealer or branch" /></label>
      <label>Order state<select value={state} onChange={event => setState(event.target.value)}><option value="">All states</option>{['PENDING', 'CONFIRMED', 'REJECTED', 'PROCESSING', 'READY', 'COMPLETED', 'CANCELLED'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Invoice type<select value={kind} onChange={event => setKind(event.target.value)}><option value="">All invoices</option><option value="TAX_INVOICE">Tax invoice</option><option value="BILL_OF_SUPPLY">Bill of supply</option></select></label>
    </div>
    <button className="button button-quiet" onClick={() => setVersion(value => value + 1)}>Refresh</button>
    {loading ? <p>Loading orders…</p> : error ? <p role="alert">{error}</p> : <>{data.results.length === 0 && <p>No orders found.</p>}{data.results.map(order => <article className="detail-card" key={order.id}><h3>{order.order_number} · {order.state}</h3><p>Buyer {order.buyer_id} · {order.dealer_business_name} / {order.branch_name} · {istDateTime(order.created_at)}</p><p>Accepted quotation snapshot total {inr(order.total)}</p><button className="button button-quiet" onClick={() => void inspect(order.id)}>Inspect order</button></article>)}</>}
    {selected && <article className="detail-card"><h3>{selected.order_number} history</h3>{selected.items.map(item => <p key={item.id}>{item.product_name} · {item.variant_sku || 'product-level'} · {item.quantity} × {inr(item.unit_price)} = {inr(item.line_total)}</p>)}<h4>Order status history</h4>{selected.audit?.map(event => <p key={event.id}>{event.action} · {istDateTime(event.occurred_at)}{event.reason ? ` · ${event.reason}` : ''}</p>)}{selected.invoice ? <><h4>{selected.invoice.kind.replaceAll('_', ' ')} {selected.invoice.invoice_number}</h4><p>Issued {istDateTime(selected.invoice.issued_at)} · Grand total {inr(selected.invoice.grand_total)}</p><p>CGST {inr(selected.invoice.cgst_total)} · SGST {inr(selected.invoice.sgst_total)} · IGST {inr(selected.invoice.igst_total)}</p>{selected.invoice_audit?.map(event => <p key={event.id}>{event.action} · {istDateTime(event.occurred_at)}</p>)}</> : <p>No invoice issued.</p>}</article>}
  </section>;
}
