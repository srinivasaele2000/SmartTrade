import {useEffect, useRef, useState} from 'react';
import {apiResponse, requestApi} from './api';
import {validateCatalogueImage} from './catalogueImageValidation';
import {istDateTime} from './india';

export type Attachment = {filename: string; size: number; content_type: string; uploaded_at: string};
export type MediaKind = 'image' | 'catalogue-pdf';

const settings = {
  image: {title: 'Primary image', types: ['image/jpeg', 'image/png', 'image/webp'], limit: 2},
  'catalogue-pdf': {title: 'Catalogue PDF', types: ['application/pdf'], limit: 10},
};

export function ProductMediaCard({baseUrl, token, productId, kind, attachment, onChange}: {
  baseUrl: string;
  token: string;
  productId: number;
  kind: MediaKind;
  attachment: Attachment | null;
  onChange: (attachment: Attachment | null) => void;
}) {
  const path = '/staff/catalogue/products/' + productId + '/' + kind;
  const config = settings[kind];
  const picker = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [checkingFile, setCheckingFile] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    setPreview('');
    if (kind !== 'image' || (!file && !attachment)) return;
    const controller = new AbortController();
    let url = '';
    async function load() {
      try {
        const blob = file ?? await (await apiResponse(baseUrl, path, token, {signal: controller.signal})).blob();
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob);
          setPreview(url);
        }
      } catch {
        // The placeholder remains visible when the preview can't be retrieved.
      }
    }
    void load();
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [attachment, baseUrl, file, kind, path, token]);

  async function select(next: File | null) {
    setNotice(''); setError(''); setFile(null);
    if (!next) return;
    setCheckingFile(true);
    try {
      if (!next.size) throw new Error('The selected file is empty. Choose another file.');
      if (next.size > config.limit * 1024 * 1024) throw new Error(`File size exceeds the ${config.limit} MB limit.`);
      if (kind === 'image') await validateCatalogueImage(next);
      else if (!config.types.includes(next.type)) throw new Error('Choose a PDF file.');
      setFile(next);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The selected file could not be checked.');
      if (picker.current) picker.current.value = '';
    } finally {
      setCheckingFile(false);
    }
  }

  async function run(operation: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try {await operation();}
    catch (failure) {setError(failure instanceof Error ? failure.message : 'Media request failed.');}
    finally {setBusy(false);}
  }

  return <section className="detail-card" aria-label={config.title}>
    <h4>{config.title}</h4>
    {kind === 'image' && (preview
      ? <img src={preview} alt="Primary product preview" style={{width: 160, height: 120, objectFit: 'contain'}} onError={() => setPreview('')} />
      : <p className="state-panel">Product image placeholder</p>)}
    {attachment
      ? <p>{attachment.filename} · {Math.ceil(attachment.size / 1024)} KB · {istDateTime(attachment.uploaded_at)}</p>
      : <p>No file uploaded.</p>}
    <label>
      {attachment ? 'Select replacement' : 'Select file'} ({config.limit} MB max)
      <input ref={picker} type="file" accept={config.types.join(',')} disabled={busy || checkingFile}
        onChange={event => void select(event.currentTarget.files?.[0] ?? null)} />
    </label>
    {checkingFile && <p role="status">Checking image…</p>}
    {file && <p>Selected {file.name} · {Math.ceil(file.size / 1024)} KB</p>}
    <div className="decision-buttons">
      <button className="button button-primary" type="button" disabled={busy || checkingFile || !file} onClick={() => void run(async () => {
        if (!file) return;
        const body = new FormData();
        body.append('file', file);
        onChange(await requestApi<Attachment>(baseUrl, path, token, {method: 'POST', body}));
        setFile(null);
        if (picker.current) picker.current.value = '';
        setNotice('File uploaded.');
      })}>{attachment ? 'Replace file' : 'Upload file'}</button>
      {attachment && <>
        {kind === 'catalogue-pdf' && <button className="button button-quiet" type="button" disabled={busy}
          onClick={() => void run(async () => {
            const blob = await (await apiResponse(baseUrl, path, token)).blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = attachment.filename;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          })}>Download PDF</button>}
        <button className="button button-quiet" type="button" disabled={busy} onClick={() => {
          if (!window.confirm('Remove this catalogue attachment?')) return;
          void run(async () => {
            await requestApi(baseUrl, path, token, {method: 'DELETE'});
            onChange(null);
            setNotice('File removed.');
          });
        }}>Remove file</button>
      </>}
    </div>
    {error && <p className="action-message error" role="alert">{error}</p>}
    {notice && <p className="action-message success" role="status">{notice}</p>}
  </section>;
}
