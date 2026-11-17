import {useEffect, useRef, useState, type FormEvent} from 'react';
import {apiResponse, requestApi} from './api';
import {catalogueBusinessTypes, SUB_BUSINESS_TAXONOMY, type CatalogueBusinessType} from './BusinessType';
import {indianNumber, istDateTime} from './india';
import {useAdminPage} from './useAdminPage';
import CatalogueExtractionReview from './CatalogueExtractionReview';

type Document = {key: string; business_type: CatalogueBusinessType; sub_category: string; brand_name: string; title: string;
  filename: string; content_type: string; file_size_bytes: number; created_at: string; is_active: boolean};
const path = '/admin/catalogues/';
const pdfLimitMb = 100;
const imageLimitMb = 2;

export function validateVaultFileSize(file: Pick<File, 'type' | 'name' | 'size'>) {
  const isPdf = file.type === 'application/pdf' || (file.type === '' && /\.pdf$/i.test(file.name));
  const limit = isPdf ? pdfLimitMb : imageLimitMb;
  if (file.size > limit * 1024 * 1024) throw new Error(`File size exceeds the ${limit} MB limit.`);
}

export default function CatalogueVault({baseUrl, token, allowed}: {baseUrl: string; token: string; allowed: boolean}) {
  const [business, setBusiness] = useState('');
  const [subCategory, setSubCategory] = useState('');
  const [filterBusiness, setFilterBusiness] = useState('');
  const [filterSubCategory, setFilterSubCategory] = useState('');
  const filters = new URLSearchParams();
  if (filterBusiness) filters.set('business_type', filterBusiness);
  if (filterSubCategory) filters.set('sub_category', filterSubCategory);
  const page = useAdminPage<Document>(baseUrl, token, allowed ? path : '', filters.toString());
  const uploadOptions = SUB_BUSINESS_TAXONOMY[business] ?? [];
  const filterOptions = SUB_BUSINESS_TAXONOMY[filterBusiness] ?? [];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [preview, setPreview] = useState<{document: Document; url: string} | null>(null);
  const [remove, setRemove] = useState<{item: Document; action: 'archive' | 'delete'} | null>(null);
  const [edit, setEdit] = useState<Document | null>(null);
  const [extraction, setExtraction] = useState<Document | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const dialogOpen = edit !== null || remove !== null;
  useEffect(() => {
    if (dialogOpen) dialog.current?.showModal();
  }, [dialogOpen]);
  useEffect(() => () => {if (preview) URL.revokeObjectURL(preview.url);}, [preview]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {await action();}
    catch (failure) {setError(failure instanceof Error ? failure.message : 'The request could not be completed.');}
    finally {setBusy(false);}
  }

  function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const body = new FormData(form);
    void run(async () => {
      const file = body.get('file');
      if (file instanceof File) validateVaultFileSize(file);
      await requestApi<Document>(baseUrl, path, token, {method: 'POST', body});
      form.reset();
      setBusiness('');
      setSubCategory('');
      setNotice('Catalogue uploaded.');
      page.setNumber(1);
      page.reload();
    });
  }

  function closeRemoval() {
    setRemove(null);
    setError('');
  }

  async function confirmRemoval() {
    if (!remove || busy) return;
    const deleting = remove.action === 'delete';
    await run(async () => {
      await requestApi<void>(baseUrl, path + remove.item.key + (deleting ? '/delete/' : '/'), token, {method: 'DELETE'});
      if (deleting && preview?.document.key === remove.item.key) setPreview(null);
      setRemove(null);
      setNotice(deleting ? 'Catalogue PDF permanently deleted.' : 'Catalogue removed from public browsing.');
      if (deleting && page.data?.results.length === 1 && page.number > 1) page.setNumber(page.number - 1);
      page.reload();
    });
  }

  function saveChanges(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!edit || busy) return;
    const fields = {title: edit.title, brand_name: edit.brand_name,
      business_type: edit.business_type, sub_category: edit.sub_category};
    void run(async () => {
      await requestApi<Document>(baseUrl, path + edit.key + '/', token, {method: 'PATCH', body: JSON.stringify(fields)});
      setEdit(null);
      setNotice('Catalogue changes saved.');
      page.setNumber(1);
      page.reload();
    });
  }

  if (!allowed) return <p>Your staff role cannot manage the catalogue vault.</p>;
  return <section className="queue-section" aria-label="Catalogue vault">
    <h2>Upload brand catalogue</h2>
    <form onSubmit={upload} className="detail-card form-grid">
      <label>Business type <select name="business_type" required value={business}
        onChange={event => {setBusiness(event.target.value); setSubCategory('');}}>
        <option value="" disabled>Select business type</option>
        {Object.entries(catalogueBusinessTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Sub-Business <select name="sub_category" value={subCategory} disabled={!uploadOptions.length}
        onChange={event => setSubCategory(event.target.value)}>
        <option value="">Uncategorized</option>
        {uploadOptions.map(({key, label}) => <option key={key} value={key}>{label}</option>)}
      </select></label>
      <label>Brand name <input name="brand_name" maxLength={200} required /></label>
      <label>Catalogue title <input name="title" maxLength={200} required /></label>
      <label>Catalogue file <input name="file" type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" required /></label>
      <p>Max {pdfLimitMb} MB PDF. JPEG, PNG or WebP up to {imageLimitMb} MB and 4096 × 4096 pixels.</p>
      <button className="btn-primary" disabled={busy}>Upload catalogue</button>
    </form>
    {notice && <p role="status">{notice}</p>}
    {error && !edit && !remove && <p className="action-message error" role="alert">{error}</p>}
    <div className="decision-buttons" aria-label="Catalogue filters">
      <label>Filter by business type <select value={filterBusiness} onChange={event => {
        setFilterBusiness(event.target.value); setFilterSubCategory(''); page.setNumber(1);
      }}>
        <option value="">All business types</option>
        {Object.entries(catalogueBusinessTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <label>Filter by Sub-Business <select value={filterSubCategory} disabled={!filterOptions.length}
        onChange={event => {setFilterSubCategory(event.target.value); page.setNumber(1);}}>
        <option value="">All sub-businesses</option>
        {filterOptions.map(({key, label}) => <option key={key} value={key}>{label}</option>)}
      </select></label>
    </div>
    {page.error ? <><p role="alert">{page.error}</p><button onClick={page.reload}>Retry</button></>
      : !page.data ? <p role="status">Loading catalogue documents…</p>
      : !page.data.results.length ? <p className="empty-state">{filterBusiness ? 'No catalogue documents match these filters.' : 'No catalogue documents have been uploaded.'}</p>
      : <div className="onboarding-table"><table>
        <caption>Catalogue documents</caption>
        <thead><tr>{['Title', 'Brand', 'Business type', 'Sub-Business', 'File', 'Uploaded', 'Status', 'Actions'].map(value => <th key={value} scope="col">{value}</th>)}</tr></thead>
        <tbody>{page.data.results.map(item => <tr key={item.key}>
          <td>{item.title}</td><td>{item.brand_name}</td><td>{catalogueBusinessTypes[item.business_type]}</td>
          <td>{SUB_BUSINESS_TAXONOMY[item.business_type]?.find(option => option.key === item.sub_category)?.label || 'Uncategorized'}</td>
          <td><span className="cell-filename" title={item.filename}>{item.filename}</span> <small className="cell-meta">{indianNumber(item.file_size_bytes)} bytes</small></td><td className="cell-meta">{istDateTime(item.created_at)}</td>
          <td><span className="status-pill" data-status={item.is_active ? 'active' : 'archived'}>{item.is_active ? 'Active' : 'Archived'}</span></td>
          <td><div className="table-actions"><button disabled={busy} onClick={() => {setError(''); setEdit(item);}}>Edit</button>
          <button disabled={busy} onClick={() => void run(async () => {
            const response = await apiResponse(baseUrl, path + item.key + '/file/', token);
            setPreview({document: item, url: URL.createObjectURL(await response.blob())});
          })}>Preview / download</button>{item.is_active && <button className="btn-warning" disabled={busy}
            onClick={() => {setError(''); setRemove({item, action: 'archive'});}}>Archive</button>}
          {item.is_active && item.content_type === 'application/pdf' && <button disabled={busy}
            onClick={() => {setNotice(''); setError(''); setExtraction(item);}}>Extract Items &amp; Images from PDF</button>}
          {item.content_type === 'application/pdf' && <button className="btn-danger" disabled={busy}
            onClick={() => {setError(''); setRemove({item, action: 'delete'});}}>Delete</button>}</div></td>
        </tr>)}</tbody>
      </table></div>}
    {page.data && <nav aria-label="Catalogue pages">
      <button disabled={!page.data.previous} onClick={() => page.setNumber(page.number - 1)}>Previous</button>
      <button disabled={!page.data.next} onClick={() => page.setNumber(page.number + 1)}>Next</button>
    </nav>}
    {extraction && <CatalogueExtractionReview baseUrl={baseUrl} token={token} documentKey={extraction.key}
      title={extraction.title} close={() => setExtraction(null)} onCommit={(count, discarded) => {
        setExtraction(null);
        setNotice(`${count} catalogue items published. ${discarded} drafts discarded.`);
      }} />}
    {edit && <dialog ref={dialog} className="contacts-dialog" aria-labelledby="edit-catalogue-title"
      onCancel={event => {event.preventDefault(); if (!busy) setEdit(null);}}>
      <h3 id="edit-catalogue-title">Edit catalogue</h3>
      <form className="detail-card form-grid" onSubmit={saveChanges}>
        <label>Catalogue Title <input required maxLength={200} value={edit.title}
          onChange={event => setEdit({...edit, title: event.target.value})} /></label>
        <label>Brand Name <input required maxLength={200} value={edit.brand_name}
          onChange={event => setEdit({...edit, brand_name: event.target.value})} /></label>
        <label>Business Type <select value={edit.business_type} onChange={event => setEdit({
          ...edit, business_type: event.target.value as CatalogueBusinessType, sub_category: '',
        })}>
          {Object.entries(catalogueBusinessTypes).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label>Sub-Business Type <select value={edit.sub_category} disabled={!SUB_BUSINESS_TAXONOMY[edit.business_type]?.length}
          onChange={event => setEdit({...edit, sub_category: event.target.value})}>
          <option value="">Uncategorized</option>
          {SUB_BUSINESS_TAXONOMY[edit.business_type]?.map(({key, label}) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {error && <p className="action-message error" role="alert">{error}</p>}
        <div className="decision-buttons">
          <button className="btn-primary" disabled={busy}>Save Changes</button>
          <button className="btn-ghost" type="button" disabled={busy} onClick={() => {setEdit(null); setError('');}}>Cancel</button>
        </div>
      </form>
    </dialog>}
    {preview && <section className="detail-card" aria-label="Catalogue preview">
      <h3>{preview.document.title}</h3>
      {preview.document.content_type.startsWith('image/') &&
        <img className="vault-preview" src={preview.url} alt={preview.document.title} />}
      <div className="decision-buttons">
        <a className="action-link-btn" href={preview.url} download={preview.document.filename}>Download file</a>
        {preview.document.content_type === 'application/pdf' && <a className="action-link-btn" href={preview.url} target="_blank" rel="noreferrer">Open PDF in a new tab</a>}
        <button className="btn-ghost" onClick={() => setPreview(null)}>Close preview</button>
      </div>
    </section>}
    {remove && <dialog ref={dialog} className="contacts-dialog" aria-labelledby="remove-catalogue-title"
      onCancel={event => {event.preventDefault(); if (!busy) closeRemoval();}}>
      <h3 id="remove-catalogue-title">{remove.action === 'delete' ? 'Permanently delete catalogue PDF?' : 'Archive catalogue?'}</h3>
      {remove.action === 'delete'
        ? <p>Delete “{remove.item.title}” and its unapproved extraction drafts and thumbnails? This cannot be undone.</p>
        : <p>Remove “{remove.item.title}” from the public vault? Staff can still inspect the archived file.</p>}
      {error && <p className="action-message error" role="alert">{error}</p>}
      <div className="decision-buttons">
        <button type="button" className={remove.action === 'delete' ? 'btn-danger' : 'btn-warning'}
          disabled={busy} onClick={() => void confirmRemoval()}>{remove.action === 'delete' ? 'Delete permanently' : 'Confirm removal'}</button>
        <button type="button" className="btn-ghost" autoFocus disabled={busy} onClick={closeRemoval}>Cancel</button>
      </div>
    </dialog>}
  </section>;
}
