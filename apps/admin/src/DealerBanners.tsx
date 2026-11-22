import {businessLabel} from './businessCopy';
import {useEffect, useState, type FormEvent} from 'react';
import {apiResponse, requestApi} from './api';
import './dealer-banners.css';

const path = '/banners/admin/';
const actions = {none: 'None', brand: 'Open brand', category: 'Open category', item: 'Open product', support_chat: 'Open Admin Support'} as const;
const themes = {
  emerald: ['Emerald Forest', '#104537'], indigo: ['Royal Indigo', '#302a73'],
  amber: ['Warm Amber', '#783a0a'], slate: ['Deep Slate', '#243247'], crimson: ['Crimson Offer', '#831f3d'],
} as const;
const cta = {none: '', brand: 'Shop Brand ›', category: 'Browse Category ›', item: 'View Product ›', support_chat: 'Chat with Admin ›'};
type Target = keyof typeof actions;
type Theme = keyof typeof themes;
type Banner = {id: number; title: string; subtitle: string; image_url: string | null; target_type: Target;
  banner_type: 'image' | 'text'; theme_preset: Theme; badge_text: string;
  target_brand_id: number | null; target_category_id: number | null; target_item_id: number | null;
  target_brand_name: string | null; target_category_name: string | null;
  sort_order: number; is_active: boolean; starts_at: string | null; ends_at: string | null; status: string};
type BannerList = {banners: Banner[]};
const initial = {title: '', subtitle: '', banner_type: 'image' as Banner['banner_type'], theme_preset: 'emerald' as Theme, badge_text: '',
  target_type: 'none' as Target, target: '', sort_order: '0', is_active: true, starts_at: '', ends_at: ''};
function asIst(value: string | null) {
  return value ? new Date(new Date(value).getTime() + 330 * 60_000).toISOString().slice(0, 16) : '';
}

function usePreview(base: string, token: string, imagePath?: string, file?: File) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    const show = (blob: Blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    };
    if (file) show(file);
    else if (imagePath) void apiResponse(base, imagePath, token, {signal: controller.signal}).then(r => r.blob()).then(show).catch(() => {});
    return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [base, token, imagePath, file]);
  return url;
}

type Card = Pick<Banner, 'banner_type' | 'theme_preset' | 'badge_text' | 'title' | 'subtitle' | 'target_type'>;
function BannerPreview({base, token, card, imagePath, file}: {base: string; token: string; card: Card; imagePath?: string | null; file?: File}) {
  const isText = card.banner_type === 'text';
  const url = usePreview(base, token, isText ? undefined : imagePath ?? undefined, isText ? undefined : file);
  if (isText) return <div className="promo-preview promo-text" style={{backgroundColor: themes[card.theme_preset][1]}}>
    <div className="promo-pills">
      {card.badge_text && <span>{card.badge_text}</span>}
      {cta[card.target_type] && <span className="promo-cta">{cta[card.target_type]}</span>}
    </div>
    <div className="promo-copy"><strong>{card.title || 'Your headline'}</strong>{card.subtitle && <p>{card.subtitle}</p>}</div>
  </div>;
  return <div className="promo-preview">{url ? <>
    <img src={url} alt={card.title || 'Banner preview'} />
    {card.subtitle && <span className="promo-caption">{card.subtitle}</span>}
  </> : <span>Banner preview</span>}</div>;
}

export default function DealerBanners({base, token}: {base: string; token: string}) {
  const [rows, setRows] = useState<Banner[]>();
  const [editing, setEditing] = useState<Banner>();
  const [form, setForm] = useState(initial);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<Banner>();
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState<{id: number; name: string}[]>([]);
  const [targetPage, setTargetPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const choosesTarget = ['brand', 'category', 'item'].includes(form.target_type);
  useEffect(() => {
    const controller = new AbortController();
    void requestApi<BannerList>(base, path, token, {signal: controller.signal}).then(data => {
      if (!controller.signal.aborted) setRows(data.banners);
    }).catch(e => {if (!controller.signal.aborted) setError(e.message);});
    return () => controller.abort();
  }, [base, token, revision]);
  useEffect(() => {
    if (!choosesTarget) return;
    const controller = new AbortController();
    setTargets([]);
    setHasNext(false);
    const endpoint = {brand: '/catalogue/brands', category: '/catalogue/categories', item: '/catalogue/products'}[form.target_type as 'brand' | 'category' | 'item'];
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({page: String(targetPage), page_size: '30'});
      if (search.trim() && form.target_type === 'item') params.set('search', search.trim());
      void requestApi<{results: {id: number; name: string; code?: string}[]; next: string | null}>(base, endpoint + '?' + params, token, {signal: controller.signal})
        .then(data => {if (!controller.signal.aborted) {
          setTargets(data.results.map(item => ({id: item.id, name: item.code ? `${item.name} · ${item.code}` : item.name})));
          setHasNext(Boolean(data.next));
        }}).catch(e => {if (!controller.signal.aborted) setError(e.message);});
    }, 250);
    return () => {controller.abort(); window.clearTimeout(timer);};
  }, [base, token, choosesTarget, form.target_type, search, targetPage]);
  function reset() {
    setForm(initial); setEditing(undefined); setFile(undefined); setTargetPage(1); setSearch('');
  }
  async function run(task: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try {await task();} catch (e) {setError(e instanceof Error ? e.message : 'Could not update banners.');}
    finally {setBusy(false);}
  }
  function save(event: FormEvent) {
    event.preventDefault();
    void run(async () => {
      const upload = form.banner_type === 'image' ? file : undefined;
      if (form.banner_type === 'image' && !editing?.image_url && !upload) throw new Error('Choose a banner image.');
      if (upload && upload.size > 8 * 1024 * 1024) throw new Error('Choose an image up to 8 MB.');
      if (form.banner_type === 'text' && !form.title.trim()) throw new Error('Enter a headline.');
      if (choosesTarget && !form.target) throw new Error('Choose the tap destination.');
      const fields = {...form, title: form.title.trim(), sort_order: Number(form.sort_order),
        starts_at: form.starts_at ? form.starts_at + ':00+05:30' : null,
        ends_at: form.ends_at ? form.ends_at + ':00+05:30' : null};
      const {target, ...metadata} = fields;
      const payload = {...metadata, ...(choosesTarget ? {['target_' + form.target_type]: Number(target)} : {})};
      let body: FormData | string = JSON.stringify(payload);
      if (upload) {
        const data = new FormData();
        for (const [key, value] of Object.entries(payload)) data.set(key, value == null ? '' : String(value));
        data.set('image', upload);
        body = data;
      }
      await requestApi(base, editing ? `${path}${editing.id}/` : path, token, {method: editing ? 'PATCH' : 'POST', body});
      reset(); setRevision(value => value + 1);
    });
  }
  const patch = (row: Banner, update: object) => void run(async () => {
    const updated = await requestApi<Banner>(base, `${path}${row.id}/`, token, {method: 'PATCH', body: JSON.stringify(update)});
    setRows(current => current?.map(item => item.id === row.id ? updated : item));
  });
  function move(index: number, delta: number) {
    if (!rows) return;
    const ids = rows.map(row => row.id);
    [ids[index], ids[index + delta]] = [ids[index + delta], ids[index]];
    void run(async () => setRows((await requestApi<BannerList>(base, path + 'reorder/', token, {method: 'POST', body: JSON.stringify({ids})})).banners));
  }
  return <section aria-label="Banner management" className="promo-admin">
    {error && <p role="alert">{error} <button onClick={() => {setError(''); setRevision(value => value + 1);}}>Reload banners</button></p>}
    <form onSubmit={save} className="promo-form">
      <h2>{editing ? 'Edit banner' : 'Create banner'}</h2>
      <BannerPreview base={base} token={token} card={form} imagePath={editing?.image_url} file={file} />
      <fieldset disabled={busy}>
        <div className="promo-mode" role="group" aria-label="Banner type">
          {(['image', 'text'] as const).map(mode => <button key={mode} type="button" aria-pressed={form.banner_type === mode}
            onClick={() => {setForm({...form, banner_type: mode}); setFile(undefined);}}>
            {mode === 'image' ? 'Image Banner' : 'Text-Only Banner'}
          </button>)}
        </div>
        {form.banner_type === 'image' ? <>
          <label>Banner image <input key={editing?.id ?? revision} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => setFile(e.target.files?.[0])} /></label>
          <small>Use wide artwork for the 16:9 preview. JPEG, PNG or WebP up to 8 MB.</small>
        </> : <>
          <label>Badge label <input placeholder="ANNOUNCEMENT" maxLength={40} value={form.badge_text} onChange={e => setForm({...form, badge_text: e.target.value})} /></label>
          <div className="promo-swatches" role="group" aria-label="Card color theme">
            {(Object.keys(themes) as Theme[]).map(theme => <button key={theme} type="button" aria-pressed={form.theme_preset === theme}
              style={{backgroundColor: themes[theme][1]}} onClick={() => setForm({...form, theme_preset: theme})}>{themes[theme][0]}</button>)}
          </div>
        </>}
        <label>{form.banner_type === 'text' ? 'Headline text' : 'Title'} <input required={form.banner_type === 'text'} maxLength={140} value={form.title} onChange={e => setForm({...form, title: e.target.value})} /></label>
        <label>{form.banner_type === 'text' ? 'Supporting copy' : 'Subtitle'} <input maxLength={240} value={form.subtitle} onChange={e => setForm({...form, subtitle: e.target.value})} /></label>
        <label>Tap action <select value={form.target_type} onChange={e => {setForm({...form, target_type: e.target.value as Target, target: ''}); setTargetPage(1); setSearch('');}}>
          {Object.entries(actions).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
        {choosesTarget && <>
          {form.target_type === 'item' && <label>Find product <input value={search} onChange={e => {setSearch(e.target.value); setTargetPage(1);}} /></label>}
          <label>Destination <select required value={form.target} onChange={e => setForm({...form, target: e.target.value})}>
            <option value="">Choose a destination</option>
            {form.target && !targets.some(item => String(item.id) === form.target) && <option value={form.target}>Current selection · #{form.target}</option>}
            {targets.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select></label>
          <div className="promo-actions">{targetPage > 1 && <button type="button" onClick={() => setTargetPage(p => p - 1)}>Previous destinations</button>}
            {hasNext && <button type="button" onClick={() => setTargetPage(p => p + 1)}>More destinations</button>}</div>
        </>}
        <label>Display order <input type="number" min="0" max="2147483647" required value={form.sort_order} onChange={e => setForm({...form, sort_order: e.target.value})} /></label>
        <label><input type="checkbox" checked={form.is_active} onChange={e => setForm({...form, is_active: e.target.checked})} /> Active</label>
        <label>Starts at (IST) <input type="datetime-local" value={form.starts_at} onChange={e => setForm({...form, starts_at: e.target.value})} /></label>
        <label>Ends at (IST) <input type="datetime-local" value={form.ends_at} onChange={e => setForm({...form, ends_at: e.target.value})} /></label>
        <div className="promo-actions"><button type="submit" className="btn-primary">{editing ? 'Save changes' : 'Upload banner'}</button>
          {editing && <button type="button" className="btn-ghost" onClick={reset}>Cancel</button>}</div>
      </fieldset>
    </form>
    <div className="promo-list">
      <h2>Saved banners</h2>
      {!rows && !error && <p>Loading banners…</p>}
      {rows?.length === 0 && <p className="empty-state">No promotional banners yet.</p>}
      {rows?.map((row, index) => <article key={row.id} className="promo-card">
        <BannerPreview base={base} token={token} card={row} imagePath={row.image_url} />
        <strong>{row.title || 'Image banner'}</strong>
        {row.banner_type === 'text' && <span className="promo-kind">Text Banner</span>}
        <span className="promo-destination"><span className="status-pill" data-status={row.status}>{businessLabel(row.status)}</span> {actions[row.target_type]}{row.target_brand_name || row.target_category_name ? ` · ${row.target_brand_name ?? row.target_category_name}` : ''}</span>
        <div className="promo-actions">
          <button disabled={busy || index === 0} onClick={() => move(index, -1)}>Move up</button>
          <button disabled={busy || index === rows.length - 1} onClick={() => move(index, 1)}>Move down</button>
          <button disabled={busy} onClick={() => patch(row, {is_active: !row.is_active})}>{row.is_active ? 'Deactivate' : 'Activate'}</button>
          <button disabled={busy} onClick={() => {setEditing(row); setFile(undefined); setSearch(''); setTargetPage(1); setForm({
            title: row.title, subtitle: row.subtitle, banner_type: row.banner_type, theme_preset: row.theme_preset,
            badge_text: row.badge_text, target_type: row.target_type, is_active: row.is_active,
            target: String(row.target_brand_id ?? row.target_category_id ?? row.target_item_id ?? ''),
            sort_order: String(row.sort_order), starts_at: asIst(row.starts_at), ends_at: asIst(row.ends_at),
          });}}>Edit</button>
          <button className="btn-danger" disabled={busy} onClick={() => setDeleting(row)}>Delete</button>
        </div>
        {deleting?.id === row.id && <div role="alert" className="promo-actions">
          <span>Delete “{row.title}” and its image? Dealers will stop seeing this banner.</span>
          <button className="btn-danger" disabled={busy} onClick={() => void run(async () => {
            await requestApi(base, `${path}${row.id}/`, token, {method: 'DELETE'});
            setRows(current => current?.filter(item => item.id !== row.id)); setDeleting(undefined);
            if (editing?.id === row.id) reset();
          })}>Delete banner</button>
          <button className="btn-ghost" disabled={busy} onClick={() => setDeleting(undefined)}>Cancel delete</button>
        </div>}
      </article>)}
    </div>
  </section>;
}
