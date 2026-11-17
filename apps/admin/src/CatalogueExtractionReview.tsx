import {useEffect, useRef, useState, type FormEvent} from 'react';
import {ApiError, apiResponse, requestApi} from './api';

type Draft = {
  id: number; page: number; name: string; product_code: string; hsn_sac_code: string;
  price_per_unit: string | null; category: string; status: 'DRAFT' | 'APPROVED' | 'DISCARDED';
  image_url: string | null;
  pack_size?: {standard?: string; box_quantity?: string};
};
type Category = {id: number; category__name: string; brand__company__legal_name: string};
type Row = Draft & {approved: boolean; association: string};
type Diagnostics = {status?: string; pages_scanned?: number; ocr_pages?: number; product_sections?: number;
  items_extracted?: number; skipped_pages?: {page: number; reason: string}[]; warnings?: string[]; error?: string};
type Review = {rows: Draft[]; categories: Category[];
  diagnostics?: Diagnostics;
  batch?: {start_page: number; end_page: number; processed_through: number; added: number; replaced?: boolean}};
const EXTRACTION_TIMEOUT_MS = 180_000;
const CHUNK_PAGES = 3;
const PUBLISH_TIMEOUT_MS = 120_000;
const previewQueue: Array<() => Promise<void>> = [];
let activePreviews = 0;

function loadNextPreview() {
  while (activePreviews < 4 && previewQueue.length) {
    const load = previewQueue.shift()!;
    activePreviews++;
    void load().finally(() => {
      activePreviews--;
      loadNextPreview();
    });
  }
}

export function extractionPayload(input: string, append: boolean) {
  const range = input.trim();
  if (!range) return {append};
  const match = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(range);
  const start = Number(match?.[1]);
  const end = Number(match?.[2] ?? match?.[1]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start) {
    throw new Error('Enter a page number or an ascending range, such as 6 or 6-10.');
  }
  return {start_page: start, end_page: end, append};
}

async function requestExtraction(baseUrl: string, path: string, token: string, body?: string): Promise<Review> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), EXTRACTION_TIMEOUT_MS);
  try {
    return await requestApi<Review>(baseUrl, path, token, {method: body ? 'POST' : 'GET', body, signal: controller.signal});
  } catch (failure) {
    if (controller.signal.aborted || (failure instanceof ApiError && [408, 504].includes(failure.status))) {
      throw new Error('The request timed out. Try again with a smaller page range.');
    }
    throw failure;
  } finally {
    clearTimeout(timer);
  }
}

function Thumbnail({baseUrl, token, path}: {baseUrl: string; token: string; path: string}) {
  const [source, setSource] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let url = '';
    setSource('');
    setFailed(false);
    previewQueue.push(async () => {
      for (let attempt = 0; attempt < 3 && !controller.signal.aborted; attempt++) {
        try {
          const response = await apiResponse(baseUrl, path, token, {signal: controller.signal});
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          if (!blob.type.startsWith('image/')) throw new Error('Invalid thumbnail response');
          url = URL.createObjectURL(blob);
          setSource(url);
          return;
        } catch (error) {
          if (controller.signal.aborted) return;
          if (attempt === 2 || !(error instanceof ApiError) || ![0, 429, 502, 503, 504].includes(error.status)) {
            setFailed(true);
            return;
          }
          await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
        }
      }
    });
    loadNextPreview();
    return () => {controller.abort(); if (url) URL.revokeObjectURL(url);};
  }, [baseUrl, path, token]);
  return source && !failed ? <img className="catalogue-item-thumbnail" src={source} alt="Extracted product"
    onError={() => setFailed(true)} />
    : <span className="catalogue-item-placeholder">{failed ? 'Preview unavailable' : 'Loading preview…'}</span>;
}

export default function CatalogueExtractionReview({baseUrl, token, documentKey, title, close, onCommit}: {
  baseUrl: string; token: string; documentKey: string; title: string; close: () => void;
  onCommit: (count: number, discarded: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const path = '/admin/catalogues/' + documentKey + '/';
  const [rows, setRows] = useState<Row[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const [photoRequests, setPhotoRequests] = useState<Record<number, {busy: boolean; error?: string}>>({});
  const [attempt, retry] = useState(0);
  const [range, setRange] = useState('');
  const [append, setAppend] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [batchStatus, setBatchStatus] = useState('');
  const [diagnostics, setDiagnostics] = useState<Diagnostics>();
  const [extracting, setExtracting] = useState(false);
  const [cancelPending, setCancelPending] = useState(false);
  const [pageProgress, setPageProgress] = useState<{done: number; total: number}>();
  const [publishFeedback, setPublishFeedback] = useState<{kind: 'pending' | 'success' | 'error'; message: string}>();
  const publishing = useRef(false);
  const extraction = useRef<{cancelled: boolean} | null>(null);

  function applyReview(result: Review, preserveEdits: boolean) {
    setCategories(result.categories);
    setDiagnostics(result.diagnostics);
    setRows(current => {
      const edits = preserveEdits ? new Map(current.map(row => [row.id, row])) : new Map<number, Row>();
      return result.rows.map(row => {
        const previous = edits.get(row.id);
        if (previous?.status === 'DRAFT' && row.status === 'DRAFT') return {...previous, image_url: row.image_url};
        const matching = result.categories.filter(option => row.category.toLowerCase() === option.category__name.toLowerCase());
        const selected = matching.length === 1 ? matching[0] : result.categories.length === 1 ? result.categories[0] : null;
        return {...row, approved: false, association: selected ? String(selected.id) : ''};
      });
    });
    setAppend(result.rows.some(row => row.status === 'DRAFT'));
  }

  useEffect(() => {dialog.current?.showModal();}, []);
  useEffect(() => () => {
    if (extraction.current) extraction.current.cancelled = true;
  }, [path]);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    setLoaded(false);
    void requestExtraction(baseUrl, path + 'extract/', token)
      .then(result => {
        if (!active) return;
        applyReview(result, false);
        setLoaded(true);
      })
      .catch(failure => {
        if (active) setError(failure instanceof Error ? failure.message : 'Extraction failed. Please retry.');
      })
      .finally(() => {if (active) setBusy(false);});
    return () => {active = false;};
  }, [attempt, baseUrl, path, token]);

  async function extractBatch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!loaded || busy || photosBusy || extraction.current) return;
    setPublishFeedback(undefined);
    setError('');
    let remaining: string | undefined;
    let activeAppend = append;
    let replacePending = !append;
    let pagesDone = 0;
    let added = 0;
    try {
      const payload = extractionPayload(range, append);
      const run = {cancelled: false};
      extraction.current = run;
      setBusy(true);
      setExtracting(payload.start_page !== undefined && payload.end_page !== undefined &&
        payload.end_page - payload.start_page >= CHUNK_PAGES);
      setCancelPending(false);
      setBatchStatus('');
      setPageProgress(undefined);
      setDiagnostics(undefined);

      if (payload.start_page === undefined || payload.end_page === undefined) {
        const result = await requestExtraction(baseUrl, path + 'extract/', token, JSON.stringify(payload));
        const batch = result.batch;
        const partial = batch && batch.processed_through < batch.end_page;
        applyReview(result, append || Boolean(partial) || result.diagnostics?.status === 'no_items');
        if (batch) {
          setBatchStatus(`Processed pages ${batch.start_page}–${batch.processed_through}. Added ${batch.added} draft items.`);
          if (partial) {
            setRange(`${batch.processed_through + 1}-${batch.end_page}`);
            setAppend(true);
          }
        }
      } else {
        const {start_page: first, end_page: last} = payload;
        const total = Math.ceil((last - first + 1) / CHUNK_PAGES);
        setPageProgress({done: 0, total: last - first + 1});
        let start = first;
        while (start <= last && !run.cancelled) {
          const chunk = Math.floor((start - first) / CHUNK_PAGES) + 1;
          const end = Math.min(first + chunk * CHUNK_PAGES - 1, last);
          remaining = `${start}-${last}`;
          setBatchStatus(`Extracting pages ${start}–${end} of ${first}–${last} (Chunk ${chunk}/${total})… ${added} drafts added.`);
          const result = await requestExtraction(baseUrl, path + 'extract/', token, JSON.stringify({
            start_page: start, end_page: end, range_end: last, append: activeAppend,
            ...(activeAppend && replacePending ? {replace_on_items: true} : {}),
          }));
          const batch = result.batch;
          if (!batch || !Number.isInteger(batch.processed_through) ||
              batch.processed_through < start || batch.processed_through > end) {
            throw new Error('The server did not confirm which pages were saved. Reload the review before retrying.');
          }
          applyReview(result, !batch.replaced);
          if (batch.replaced) replacePending = false;
          added += batch.added;
          pagesDone += batch.processed_through - start + 1;
          setPageProgress({done: pagesDone, total: last - first + 1});
          start = batch.processed_through + 1;
          remaining = start <= last ? `${start}-${last}` : undefined;
          activeAppend = true;
        }
        setBatchStatus(`${run.cancelled && remaining ? 'Stopped after' : 'Processed'} ${pagesDone} of ${last - first + 1} pages. Added ${added} draft items.`);
        if (remaining) {
          setRange(remaining);
          setAppend(!replacePending);
        }
      }
      setExtracted(true);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Extraction failed. Please retry.');
      if (remaining) {
        setBatchStatus(`Saved progress: ${pagesDone} pages processed, ${added} draft items added.`);
        setRange(remaining);
        setAppend(!replacePending);
      }
    } finally {
      extraction.current = null;
      setExtracting(false);
      setCancelPending(false);
      setBusy(false);
    }
  }

  const pending = rows.filter(row => row.status === 'DRAFT');
  const categoryIds = new Set(categories.map(option => String(option.id)));
  const isEligible = (row: Row) => row.status === 'DRAFT' && categoryIds.has(row.association);
  const eligible = pending.filter(isEligible);
  const eligibleCount = eligible.length;
  const approvedCount = eligible.filter(row => row.approved).length;
  const allSelected = eligibleCount > 0 && approvedCount === eligibleCount;
  const partiallySelected = approvedCount > 0 && !allSelected;
  const photosBusy = Object.values(photoRequests).some(photo => photo.busy);
  function toggleAll() {
    setRows(current => current.map(row => allSelected ? {...row, approved: false}
      : isEligible(row) ? {...row, approved: true} : row));
  }
  function update(id: number, fields: Partial<Row>) {
    setRows(current => current.map(row => row.id === id ? {...row, ...fields} : row));
  }

  async function changePhoto(id: number, file: File | null) {
    setPhotoRequests(current => ({...current, [id]: {busy: true}}));
    try {
      const body = file ? new FormData() : undefined;
      if (body && file) body.append('image', file);
      const draft = await requestApi<Draft>(baseUrl, path + 'drafts/' + id + '/image/', token, {
        method: file ? 'POST' : 'DELETE', body,
      });
      update(id, {image_url: draft.image_url});
      setPhotoRequests(current => ({...current, [id]: {busy: false}}));
    } catch (failure) {
      setPhotoRequests(current => ({...current, [id]: {
        busy: false, error: failure instanceof Error ? failure.message : 'Could not save the photo.',
      }}));
    }
  }

  async function commit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (publishing.current || busy || photosBusy || !approvedCount) return;
    publishing.current = true;
    setBusy(true);
    setError('');
    setPublishFeedback({kind: 'pending', message: `Publishing ${approvedCount} catalogue items…`});
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUBLISH_TIMEOUT_MS);
    try {
      const batch = pending.map(row => row.approved && isEligible(row) ? {
        id: row.id, approved: true, name: row.name, product_code: row.product_code, hsn_sac_code: row.hsn_sac_code,
        price_per_unit: row.price_per_unit ?? '', brand_category: Number(row.association),
      } : {id: row.id, approved: false});
      const result = await requestApi<{items: unknown[]; discarded: number}>(baseUrl, path + 'drafts/commit/', token, {
        method: 'POST', body: JSON.stringify({rows: batch}), signal: controller.signal,
      });
      if (!Array.isArray(result?.items) || result.items.length !== approvedCount ||
          result.discarded !== batch.length - approvedCount) {
        throw new Error('The publish response could not be confirmed. Reopen the review before retrying.');
      }
      const committed = new Map(batch.map(row => [row.id, row.approved]));
      setRows(current => current.map(row => committed.has(row.id) ? {
        ...row, approved: false, status: committed.get(row.id) ? 'APPROVED' : 'DISCARDED',
      } : row));
      setPublishFeedback({kind: 'success', message: `${result.items.length} catalogue items published. ${result.discarded} drafts discarded.`});
      onCommit(result.items.length, result.discarded);
    } catch (failure) {
      const unconfirmed = controller.signal.aborted || (failure instanceof ApiError &&
        (failure.status === 0 || failure.status === 408 || failure.status >= 500));
      const message = failure instanceof Error ? failure.message : 'Could not commit the selected items.';
      setPublishFeedback({kind: 'error', message: unconfirmed
        ? `${controller.signal.aborted ? 'The publish request timed out.' : message} Reopen the review to check the draft status before retrying.`
        : message});
    } finally {
      clearTimeout(timer);
      publishing.current = false;
      setBusy(false);
    }
  }

  function publishBanner(label: string) {
    return publishFeedback && <p aria-label={label} role={publishFeedback.kind === 'error' ? 'alert' : 'status'}
      className={`action-message ${publishFeedback.kind}`}>{publishFeedback.message}</p>;
  }

  return <dialog ref={dialog} className="contacts-dialog catalogue-review-dialog" aria-labelledby="pdf-review-title"
    onCancel={event => {event.preventDefault(); if (!busy && !photosBusy) close();}}>
    <header className="dialog-heading">
      <h3 id="pdf-review-title">Review extracted catalogue items</h3>
      <p>{title}</p>
    </header>
    <form className="extraction-toolbar" aria-label="Extract catalogue batch" onSubmit={extractBatch}>
      <label>Page range <input value={range} placeholder="All pages (e.g. 6-10)" disabled={busy}
        onChange={event => setRange(event.target.value)} /></label>{' '}
      <label><input type="checkbox" checked={append} disabled={busy} onChange={event => setAppend(event.target.checked)} />
        Append to existing drafts</label>{' '}
      <button className="btn-primary" disabled={!loaded || busy || photosBusy}>Extract batch</button>
      {extracting && <button type="button" className="btn-ghost" disabled={cancelPending} onClick={() => {
        if (!extraction.current) return;
        extraction.current.cancelled = true;
        setCancelPending(true);
      }}>Cancel after current chunk</button>}
    </form>
    {pending.length > 0 && !append && <p>Extracting this batch will replace all pending drafts for this catalogue.</p>}
    {busy && publishFeedback?.kind !== 'pending' && !batchStatus && <p role="status">{loaded ? 'Processing catalogue items…' : 'Loading existing drafts…'}</p>}
    {cancelPending && <p role="status">Finishing the current request. Completed drafts will be kept.</p>}
    {error && <p role="alert">{error}</p>}
    {publishBanner('Publish status at top')}
    {error && !loaded && <button disabled={busy} onClick={() => retry(value => value + 1)}>Retry loading drafts</button>}
    {loaded && <p aria-live="polite">Showing {pending.length} extracted draft items</p>}
    {batchStatus && <p role="status">{batchStatus}</p>}
    {extracting && pageProgress && <div className="extraction-progress">
      <progress aria-label="Pages processed in this extraction" value={pageProgress.done} max={pageProgress.total} />
      <span>{pageProgress.done} / {pageProgress.total} pages</span>
    </div>}
    {diagnostics?.status && <section className="extraction-diagnostics" aria-label="Extraction diagnostics" aria-live="polite">
      {diagnostics.error && <p role="alert">{diagnostics.error}</p>}
      {diagnostics.pages_scanned !== undefined && <dl className="extraction-metrics">
        <div><dt>Pages examined</dt><dd>{diagnostics.pages_scanned}</dd></div>
        <div><dt>OCR pages</dt><dd>{diagnostics.ocr_pages ?? 0}</dd></div>
        <div><dt>Product sections</dt><dd>{diagnostics.product_sections ?? 0}</dd></div>
        <div><dt>Items extracted</dt><dd>{diagnostics.items_extracted ?? 0}</dd></div>
        <div><dt>Skipped pages</dt><dd>{diagnostics.skipped_pages?.length ?? 0}</dd></div>
      </dl>}
      {!!diagnostics.warnings?.length && <details>
        <summary>{diagnostics.warnings.length} extraction {diagnostics.warnings.length === 1 ? 'warning' : 'warnings'}</summary>
        <ul>{diagnostics.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
      </details>}
    </section>}
    {extracted && !busy && !error && !diagnostics?.status && !rows.length && <p>No supported pricing rows were found in this batch.</p>}
    {!!pending.length && !categories.length && <p>Approval requires an active category linked to this PDF’s brand under a verified, active company. Check the vault’s brand name against the catalogue brand.</p>}
    {!!rows.length && <form aria-label="Publish catalogue items" noValidate onSubmit={commit}>
      <div className="onboarding-table"><table className="catalogue-review-table">
        <caption>Approve the rows to publish. Unchecked drafts will be discarded when you commit.</caption>
        <colgroup>{['approve', 'page', 'image', 'name', 'code', 'hsn', 'price', 'category'].map(column =>
          <col key={column} className={'catalogue-review-col-' + column} />)}</colgroup>
        <thead><tr><th scope="col">Approve<br />
          <input type="checkbox" aria-label="Select all eligible rows" checked={allSelected}
            disabled={busy || !eligibleCount}
            ref={input => {if (input) input.indeterminate = partiallySelected;}} onChange={toggleAll} />
        </th>{['Page', 'Image', 'Name', 'Code', 'HSN / SAC', 'Unit price (₹)', 'Category'].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
        <tbody>{rows.map(row => {
          const editable = row.status === 'DRAFT' && !busy;
          const photo = photoRequests[row.id];
          const imagePath = path + 'drafts/' + row.id + '/image/';
          const previewPath = row.image_url ? imagePath + new URL(row.image_url, window.location.origin).search : '';
          return <tr key={row.id}>
            <td>{row.status === 'DRAFT' ? <input type="checkbox" aria-label={'Approve ' + row.product_code}
              checked={row.approved} disabled={!editable || !isEligible(row)} onChange={event => update(row.id, {approved: event.target.checked})} /> : <span className="status-pill" data-status={row.status}>{row.status}</span>}</td>
            <td>{row.page}</td>
            <td><div className="catalogue-review-photo">
              {previewPath && <Thumbnail key={previewPath} baseUrl={baseUrl} token={token} path={previewPath} />}
              {row.status === 'DRAFT' && <>
                <label className="catalogue-review-picker">
                  <input type="file" accept="image/png,image/jpeg,image/webp" disabled={!editable || photo?.busy}
                    aria-label={(previewPath ? 'Change photo for ' : 'Add photo for ') + row.product_code}
                    onChange={event => {
                      const file = event.currentTarget.files?.[0];
                      event.currentTarget.value = '';
                      if (file) void changePhoto(row.id, file);
                    }} />
                  <span>{previewPath ? 'Change' : '+ Add photo'}</span>
                </label>
                {previewPath && <button type="button" className="button button-quiet"
                  aria-label={'Remove photo for ' + row.product_code} disabled={!editable || photo?.busy}
                  onClick={() => void changePhoto(row.id, null)}>Remove</button>}
                {photo?.busy && <span role="status">Saving photo…</span>}
                {photo?.error && <span role="alert">{photo.error}</span>}
              </>}
            </div></td>
            <td><textarea rows={2} aria-label={'Name for row ' + row.id} value={row.name} maxLength={200} required={row.approved}
              disabled={!editable} onChange={event => update(row.id, {name: event.target.value})} />
              {row.pack_size?.standard && <div>Standard pack {row.pack_size.standard}</div>}
              {row.pack_size?.box_quantity && <div>Box quantity {row.pack_size.box_quantity}</div>}
            </td>
            <td><input aria-label={'Code for row ' + row.id} value={row.product_code} maxLength={100} required={row.approved}
              disabled={!editable} onChange={event => update(row.id, {product_code: event.target.value})} /></td>
            <td><input aria-label={'HSN for row ' + row.id} value={row.hsn_sac_code} maxLength={8} required={row.approved}
              pattern={row.approved ? '[0-9]{4,8}' : undefined} disabled={!editable} onChange={event => update(row.id, {hsn_sac_code: event.target.value})} /></td>
            <td><input aria-label={'Price for row ' + row.id} type="text" inputMode="decimal" value={row.price_per_unit ?? ''}
              pattern={row.approved ? '[0-9]+([.][0-9]{1,4})?' : undefined} required={row.approved} disabled={!editable}
              onChange={event => update(row.id, {price_per_unit: event.target.value})} /></td>
            <td>{row.category && <div>{row.category}</div>}
              {row.status === 'DRAFT' && <select aria-label={'Category for row ' + row.id} value={row.association}
                disabled={!editable} required={row.approved} onChange={event => {
                  const association = event.target.value;
                  update(row.id, {association, approved: row.approved && categoryIds.has(association)});
                }}>
                <option value="">Select category</option>
                {categories.map(option => <option value={option.id} key={option.id}>
                  {option.category__name} · {option.brand__company__legal_name}
                </option>)}
              </select>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {!!pending.length && <div className="catalogue-review-selection">
        <span aria-live="polite">{approvedCount} of {eligibleCount} items selected for approval</span>
        <button type="button" className="button button-quiet" disabled={busy || !eligibleCount} onClick={toggleAll}>
          {allSelected ? 'Clear selection' : `Select all (${eligibleCount})`}
        </button>
        <button type="submit" className="btn-primary" disabled={busy || photosBusy || !approvedCount}>
          {publishFeedback?.kind === 'pending' ? 'Committing & Publishing…' : `Commit & Publish (${approvedCount})`}
        </button>
      </div>}
      {publishBanner('Publish status by actions')}
    </form>}
    <button className="btn-ghost" disabled={busy || photosBusy} onClick={close}>Close review</button>
  </dialog>;
}
