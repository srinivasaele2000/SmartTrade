import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ensureList, requestApi } from './api';
import CatalogueTools from './CatalogueTools';
import CreateProductItem from './CreateProductItem';
import {ProductMediaCard, type Attachment} from './ProductMedia';
import { inr } from './india';

type Product = { image_attachment?: Attachment | null; pdf_attachment?: Attachment | null; id: number; name: string; code: string; company_name: string; brand_name: string; category_name: string; state: string; moderation_state: string; description: string; unit: string; specifications: Record<string, unknown>; catalogue_price: string | null; currency: string; variants: { id: number; sku: string; name: string; active: boolean; attributes: Record<string, unknown> }[] };
type TagOption = {id: number; brand__name: string; category__name: string};
type Page = { count: number; results: Product[] };

export default function Catalogue({ token, baseUrl, permissions = [] }: { token: string; baseUrl: string; permissions?: string[] }) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [data, setData] = useState<Page>({ count: 0, results: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selected, setSelected] = useState<Product | null>(null);
  const [action, setAction] = useState('HIDE');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [category, setCategory] = useState('');
  const [categoryMessage, setCategoryMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [untagged, setUntagged] = useState(false);
  const [taggedIds, setTaggedIds] = useState<number[]>([]);
  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [tagTarget, setTagTarget] = useState('');
  const [tagError, setTagError] = useState('');
  const loadId = useRef(0);

  const request = useCallback(async <T,>(path: string, body?: object) => {
    return requestApi<T>(baseUrl, `/staff/catalogue${path}`, token, {
      method: body ? 'POST' : 'GET',
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  }, [baseUrl, token]);

  const load = useCallback(async () => {
    const id = ++loadId.current;
    setLoading(true); setError('');
    try { const data = await request<Page>(`/products?page=${page}&search=${encodeURIComponent(query)}${untagged ? '&category=uncategorized' : ''}`); ensureList(data, true); if (id === loadId.current) setData(data); }
    catch (failure) { if (id === loadId.current) setError(failure instanceof Error ? failure.message : 'Catalogue connection failed.'); }
    finally { if (id === loadId.current) setLoading(false); }
  }, [request, page, query, untagged]);
  useEffect(() => { void load(); return () => { loadId.current++; }; }, [load]);

  async function openTagging() {
    setTagError('');
    setSaving(true);
    try {
      const options = await requestApi<TagOption[]>(baseUrl, '/catalogue/items/options/?canonical=1', token);
      setTagOptions(options);
      if (!options.length) setTagError('No eligible brand and category combinations are available.');
    }
    catch (failure) {setTagError(failure instanceof Error ? failure.message : 'Could not load brand and category options.');}
    finally {setSaving(false);}
  }

  async function assignTags(event: FormEvent) {
    event.preventDefault();
    if (saving || !taggedIds.length || !tagTarget) return;
    setSaving(true); setTagError(''); setNotice('');
    try {
      const result = await request<{updated: number}>('/products/bulk-tag', {
        products: taggedIds, brand_category: Number(tagTarget),
      });
      setTaggedIds([]); setTagTarget('');
      setNotice(`${result.updated} catalogue items tagged.`);
      setPage(1);
      if (page === 1) await load();
    } catch (failure) {setTagError(failure instanceof Error ? failure.message : 'Could not tag the selected items.');}
    finally {setSaving(false);}
  }

  async function moderate(event: FormEvent) {
    event.preventDefault();
    if (!selected || !reason.trim()) return;
    setSaving(true); setNotice(''); setError('');
    try {
      const result = await request<Product>(`/products/${selected.id}/moderation`, { action, reason: reason.trim() });
      if (result.id !== selected.id || result.moderation_state !== ({HIDE:'HIDDEN',SUSPEND:'SUSPENDED',RESTORE:'VISIBLE'} as Record<string,string>)[action]) throw new Error('Moderation could not be confirmed. Refresh before retrying.');
      setNotice(`Moderation recorded for ${selected.name}. Company eligibility still governs public visibility.`);
      setSelected(null); setReason(''); await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Could not save moderation.'); }
    finally { setSaving(false); }
  }

  async function createCategory(event: FormEvent) {
    event.preventDefault(); setSaving(true); setCategoryMessage(null);
    try { const result = await request<{id:number;name:string}>('/categories', { name: category.trim() }); if (!Number.isInteger(result.id) || result.name !== category.trim()) throw new Error('Category creation could not be confirmed. Refresh before retrying.'); setCategory(''); setCategoryMessage({ kind: 'success', text: 'Category created. Verified companies can associate their brands with it.' }); }
    catch (failure) { setCategoryMessage({ kind: 'error', text: failure instanceof Error ? failure.message : 'Could not create category.' }); }
    finally { setSaving(false); }
  }

  return <section id="catalogue" className="queue-section" aria-labelledby="catalogue-title">
    {permissions.includes('MODERATE_PRODUCTS') && <CreateProductItem baseUrl={baseUrl} token={token} />}
    <div className="section-heading"><h2 id="catalogue-title">Company catalogue moderation</h2><button className="button button-quiet" disabled={loading || saving} onClick={() => void load()}>Refresh catalogue</button></div>
    <p>Company-owned products and catalogue prices. Dealer stock and selling prices are separate.</p>
    <form onSubmit={event => { event.preventDefault(); setPage(1); setTaggedIds([]); setQuery(search.trim()); }} className="decision-buttons">
      <label htmlFor="catalogue-search">Search product names</label><input id="catalogue-search" disabled={saving} value={search} onChange={event => setSearch(event.target.value)} /><button className="button button-quiet" disabled={saving}>Search</button>
    </form>
    {permissions.includes('MODERATE_PRODUCTS') && <>
      <label><input type="checkbox" checked={untagged} disabled={saving} onChange={event => {
        setUntagged(event.target.checked); setTaggedIds([]); setPage(1);
      }} /> Show untagged items only</label>
      <form className="decision-buttons" onSubmit={assignTags} aria-label="Assign Category / Brand">
        <span>{taggedIds.length} items selected</span>
        {tagOptions.length === 0 ? <button type="button" disabled={saving || !taggedIds.length}
          onClick={() => void openTagging()}>Assign Category / Brand</button> : <>
          <label>Brand / Category <select value={tagTarget} disabled={saving} onChange={event => setTagTarget(event.target.value)}>
            <option value="">Choose a brand and category</option>
            {tagOptions.map(option => <option key={option.id} value={option.id}>
              {option.brand__name} · {option.category__name}
            </option>)}
          </select></label>
          <button type="submit" disabled={saving || !tagTarget || !taggedIds.length}>Apply tags</button>
        </>}
        {tagError && <p role="alert" className="action-message error">{tagError}</p>}
      </form>
    </>}
    {notice && <p className="action-message success" role="status">{notice}</p>}
    {error && <div className="action-message error" role="alert"><p>{error}</p><button className="button button-quiet" disabled={saving} onClick={() => void load()}>Retry catalogue</button></div>}
    {loading ? <p role="status">Loading catalogue…</p> : !error && data.results.length === 0 ? <div className="state-panel">No products match this catalogue search.</div> : !error && data.results.map(product => <article key={product.id} className="detail-card">
      {permissions.includes('MODERATE_PRODUCTS') && <label>
        <input type="checkbox" aria-label={`Select ${product.code} for tagging`} disabled={saving}
          checked={taggedIds.includes(product.id)} onChange={event => {
            const checked = event.target.checked;
            setTaggedIds(previous => checked ? [...previous, product.id] : previous.filter(id => id !== product.id));
          }} /> Select for tagging</label>}
      <h3>{product.name} · {product.code}</h3><p>{product.company_name} / {product.brand_name} / {product.category_name}</p>
      <p className="record-meta">Publication: <span className="status-pill" data-status={product.state}>{product.state}</span> Moderation: <span className="status-pill" data-status={product.moderation_state}>{product.moderation_state}</span></p>
      <p>{product.catalogue_price === null ? 'Catalogue price not provided' : inr(product.catalogue_price)} · Unit: {product.unit}</p>
      <p className="request-reason">{product.description || 'No description provided.'}</p>
      <details><summary>Product specifications</summary><pre>{JSON.stringify(product.specifications,null,2)}</pre></details><ul>{product.variants.map(variant => <li key={variant.id}>{variant.sku}: {variant.name} ({variant.active ? 'active' : 'inactive'}) · {JSON.stringify(variant.attributes)}</li>)}</ul>
      <button className="button button-quiet" disabled={saving} onClick={() => { setSelected(product); setReason(''); }}>Review product</button>
    </article>)}
    {!loading && !error && <div className="decision-buttons"><button className="button button-quiet" disabled={page === 1 || saving} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page} · {data.count} matching products</span><button className="button button-quiet" disabled={page * 20 >= data.count || saving} onClick={() => setPage(page + 1)}>Next</button></div>}
    {selected && <form className="detail-card" onSubmit={moderate}>
      <h3>Moderate {selected.name}</h3><label htmlFor="moderation-action">Action</label>
      <select id="moderation-action" value={action} disabled={saving} onChange={event => setAction(event.target.value)}><option value="HIDE">Hide</option><option value="SUSPEND">Suspend product</option><option value="RESTORE">Restore product visibility eligibility</option></select>
      <label htmlFor="moderation-reason">Reason (required)</label><textarea id="moderation-reason" rows={3} required maxLength={4000} value={reason} disabled={saving} onChange={event => setReason(event.target.value)} />
      <div className="decision-buttons"><button className="button button-primary" disabled={saving || !reason.trim()}>Record moderation</button><button className="button button-quiet" type="button" disabled={saving} onClick={() => setSelected(null)}>Cancel</button></div>
    </form>}
    {selected && permissions.includes('MODERATE_PRODUCTS') && (
      <section aria-label="Official product media" key={selected.id}>
        <h3>Official media for {selected.name}</h3>
        {(['image', 'catalogue-pdf'] as const).map(kind => {
          const field = kind === 'image' ? 'image_attachment' : 'pdf_attachment';
          const update = (product: Product, attachment: Attachment | null) =>
            product.id === selected.id ? {...product, [field]: attachment} : product;
          return <ProductMediaCard key={kind} kind={kind} baseUrl={baseUrl} token={token}
            productId={selected.id} attachment={selected[field] ?? null} onChange={attachment => {
              setSelected(previous => previous ? update(previous, attachment) : previous);
              setData(previous => ({...previous, results: previous.results.map(product => update(product, attachment))}));
            }} />;
        })}
      </section>
    )}
    <form className="detail-card" onSubmit={createCategory}><h3>Create catalogue category</h3><p>Requires MANAGE_TAXONOMY permission.</p><label htmlFor="new-category">Category name</label><input id="new-category" required maxLength={120} disabled={saving} value={category} onChange={event => setCategory(event.target.value)} /><button className="button button-primary" disabled={saving || !category.trim()}>Create category</button>{categoryMessage && <p className={`action-message ${categoryMessage.kind}`} role={categoryMessage.kind === 'error' ? 'alert' : 'status'}>{categoryMessage.text}</p>}</form>
    <CatalogueTools token={token} baseUrl={baseUrl} permissions={permissions} />
  </section>;
}
