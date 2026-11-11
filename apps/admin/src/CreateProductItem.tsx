import {useEffect, useRef, useState, type FormEvent} from 'react';
import {requestApi} from './api';
import {inr} from './india';
import {useAdminPage} from './useAdminPage';

type Item = {id: number; name: string; product_code: string; hsn_sac_code: string; price_per_unit: string;
  brand_id: number; brand_category: number; category_name: string; image_url: string | null};
type Option = {id: number; brand_id: number; brand__name: string; category__name: string};
const path = '/catalogue/items/';

export default function CreateProductItem({baseUrl, token}: {baseUrl: string; token: string}) {
  const page = useAdminPage<Item>(baseUrl, token, path);
  const [options, setOptions] = useState<Option[]>();
  const [optionsError, setOptionsError] = useState('');
  const [revision, retry] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<{type: 'edit' | 'delete'; item: Item} | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogOpen = action !== null;
  useEffect(() => {
    if (dialogOpen) dialog.current?.showModal();
  }, [dialogOpen]);
  useEffect(() => {
    const controller = new AbortController();
    setOptionsError('');
    void requestApi<Option[]>(baseUrl, path + 'options/', token, {signal: controller.signal})
      .then(value => {if (!controller.signal.aborted) setOptions(value);})
      .catch(failure => {if (!controller.signal.aborted) setOptionsError(failure.message);});
    return () => controller.abort();
  }, [baseUrl, token, revision]);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const file = data.get('image');
    if (file instanceof File && !file.name) data.delete('image');
    setBusy(true); setError(''); setNotice('');
    try {
      await requestApi<Item>(baseUrl, path, token, {method: 'POST', body: data});
      form.reset();
      setNotice('Catalogue item created.');
      page.reload();
    } catch (failure) {setError(failure instanceof Error ? failure.message : 'Could not create the catalogue item.');}
    finally {setBusy(false);}
  }

  async function saveAction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!action || busy) return;
    const body = action.type === 'edit' ? new FormData(event.currentTarget) : undefined;
    if (body) {
      const image = body.get('image');
      if (image instanceof File && !image.name) body.delete('image');
      if (!action.item.hsn_sac_code && body.get('hsn_sac_code') === '') body.delete('hsn_sac_code');
    }
    setBusy(true); setError(''); setNotice('');
    try {
      await requestApi<Item | undefined>(baseUrl, path + action.item.id + '/', token,
        {method: action.type === 'edit' ? 'PATCH' : 'DELETE', body});
      setNotice(action.type === 'edit' ? 'Catalogue item updated.' : 'Catalogue item removed from dealer discovery.');
      setAction(null);
      if (action.type === 'delete' && page.data?.results.length === 1 && page.number > 1) {
        page.setNumber(page.number - 1);
      }
      page.reload();
    } catch (failure) {setError(failure instanceof Error ? failure.message : 'Could not update the catalogue item.');}
    finally {setBusy(false);}
  }

  function openAction(type: 'edit' | 'delete', item: Item) {
    setError('');
    setAction({type, item});
  }

  function closeAction() {
    if (!busy) {setError(''); setAction(null);}
  }

  return <section className="detail-card" aria-label="Create catalogue item">
    <h3>Create catalogue item</h3>
    {optionsError && <><p role="alert">{optionsError}</p><button onClick={() => retry(value => value + 1)}>Retry brand and category options</button></>}
    {!options && !optionsError && <p role="status">Loading brands and categories…</p>}
    {options?.length === 0 && <p>No eligible brand and category pairs are available.</p>}
    <form onSubmit={create}>
      <label>Product name <input name="name" required maxLength={200} /></label>
      <label>Product code <input name="product_code" required maxLength={100} /></label>
      <label>HSN / SAC code <input name="hsn_sac_code" inputMode="numeric" pattern="[0-9]{4,8}" required /></label>
      <label>List price per unit (₹) <input name="price_per_unit" type="number" min="0" step="0.0001" required /></label>
      <label>Brand and category <select name="brand_category" required defaultValue="">
        <option value="" disabled>Select brand and category</option>
        {options?.map(option => <option key={option.id} value={option.id}>{option.brand__name} · {option.category__name}</option>)}
      </select></label>
      <label>Product image (optional) <input name="image" type="file" accept=".jpg,.jpeg,.png,.webp" /></label>
      <button className="button" disabled={busy || !options?.length}>Create Item</button>
    </form>
    {error && !action && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {page.error ? <><p role="alert">{page.error}</p><button onClick={page.reload}>Retry items</button></>
      : !page.data ? <p role="status">Loading catalogue items…</p>
      : page.data.results.length === 0 ? <p>No priced catalogue items.</p>
      : <div className="onboarding-table"><table>
        <caption>Catalogue items</caption>
        <thead><tr>{['Image', 'Item', 'Code', 'HSN / SAC', 'Unit price', 'Category', 'Actions'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{page.data.results.map(item => <tr key={item.id}>
          <td>{item.image_url ? <img width="48" height="48" style={{objectFit:'contain'}} src={item.image_url} alt="" /> : '—'}</td>
          <th scope="row">{item.name}</th><td>{item.product_code}</td><td>{item.hsn_sac_code || '—'}</td>
          <td>{inr(item.price_per_unit)}</td><td>{item.category_name}</td>
          <td><div className="decision-buttons">
            <button type="button" className="button button-quiet catalogue-item-edit" disabled={busy}
              onClick={() => openAction('edit', item)}><span aria-hidden="true">✎ </span>Edit</button>
            <button type="button" className="button button-quiet catalogue-item-delete" disabled={busy}
              onClick={() => openAction('delete', item)}><span aria-hidden="true">🗑 </span>Delete</button>
          </div></td>
        </tr>)}</tbody>
      </table></div>}
    {page.data && <nav aria-label="Item pages">
      <button disabled={!page.data.previous} onClick={() => page.setNumber(page.number - 1)}>Previous</button>
      <button disabled={!page.data.next} onClick={() => page.setNumber(page.number + 1)}>Next</button>
    </nav>}
    {action && <dialog ref={dialog} className="contacts-dialog" aria-labelledby="catalogue-item-action-title"
      onCancel={event => {event.preventDefault(); closeAction();}}>
      <h3 id="catalogue-item-action-title">{action.type === 'edit' ? 'Edit catalogue item' : 'Delete catalogue item'}</h3>
      <form className="detail-card" onSubmit={saveAction}>
        {action.type === 'edit' ? <>
          <label>Product name <input name="name" required maxLength={200} defaultValue={action.item.name} /></label>
          <label>Product code <input name="product_code" required maxLength={100} defaultValue={action.item.product_code} /></label>
          <label>HSN / SAC code <input name="hsn_sac_code" inputMode="numeric" pattern="[0-9]{4,8}" required={Boolean(action.item.hsn_sac_code)}
            defaultValue={action.item.hsn_sac_code} /></label>
          <label>List price per unit (₹) <input name="price_per_unit" type="number" min="0" step="0.0001" required
            defaultValue={action.item.price_per_unit} /></label>
          <label>Category / Sub-Business <select name="brand_category" defaultValue={action.item.brand_category}>
            <option value={action.item.brand_category}>{action.item.category_name}</option>
            {options?.filter(option => option.brand_id === action.item.brand_id && option.id !== action.item.brand_category)
              .map(option => <option key={option.id} value={option.id}>{option.category__name}</option>)}
          </select></label>
          {action.item.image_url && <img width="96" height="96" style={{objectFit: 'contain'}}
            src={action.item.image_url} alt="Current product image" />}
          <label>Change Image (optional) <input name="image" type="file" accept=".jpg,.jpeg,.png,.webp" /></label>
        </> : <p>Are you sure you want to delete {action.item.name}? This will remove it from the dealer discovery catalog.</p>}
        {error && <p role="alert">{error}</p>}
        <div className="decision-buttons">
          <button className={action.type === 'delete' ? 'button button-quiet catalogue-item-delete' : 'button'} disabled={busy}>
            {action.type === 'edit' ? 'Save Changes' : 'Confirm Delete'}
          </button>
          <button className="button button-quiet" type="button" disabled={busy} onClick={closeAction}>Cancel</button>
        </div>
      </form>
    </dialog>}
  </section>;
}
