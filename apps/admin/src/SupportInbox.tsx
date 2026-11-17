import {useEffect, useRef, useState} from 'react';
import {apiResponse, requestApi} from './api';
import './support-inbox.css';

const inboxPath = '/messages/admin/threads/';
type Thread = {id: number; business_name: string; owner_name: string; phone: string; city: string;
  verification_status: string; last_message_preview: string; last_message_at: string; admin_unread_count: number};
type Message = {id: number; sender_role: 'dealer' | 'admin'; body: string; attachment_type: string;
  attachment_name: string; attachment_size: number | null; created_at: string; is_read: boolean};
type Inbox = {results: Thread[]; total_unread: number; next: string | null; previous: string | null};
type Conversation = Thread & {messages: Message[]; next: string | null};
const date = (value: string) => new Date(value).toLocaleString('en-IN', {timeZone: 'Asia/Kolkata'});
const size = (bytes: number | null) => `${Math.max(1, Math.round((bytes ?? 0) / 1024))} KB`;

export function useSupportUnread(base: string, token?: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    setCount(0);
    if (!token) return;
    const controller = new AbortController();
    const refresh = () => {
      if (!document.hidden) void requestApi<Inbox>(base, inboxPath + '?page_size=1', token, {signal: controller.signal})
        .then(data => {if (!controller.signal.aborted) setCount(data.total_unread);}).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 6000);
    return () => {controller.abort(); window.clearInterval(timer);};
  }, [base, token]);
  return count;
}

function Attachment({base, path, token, message}: {base: string; path: string; token: string; message: Message}) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState(false);
  const [requested, setRequested] = useState(false);
  useEffect(() => {
    if (message.attachment_type === 'pdf' && !requested) return;
    const controller = new AbortController();
    let objectUrl = '';
    setUrl('');
    setError(false);
    void apiResponse(base, path, token, {signal: controller.signal}).then(response => response.blob()).then(blob => {
      if (!controller.signal.aborted) {objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);}
    }).catch(() => {if (!controller.signal.aborted) setError(true);});
    return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
  }, [base, path, token, message.attachment_type, requested]);
  if (message.attachment_type === 'pdf' && !requested) return <button type="button" onClick={() => setRequested(true)}>
    PDF · {message.attachment_name} · {size(message.attachment_size)}
  </button>;
  if (error) return <span>Attachment unavailable</span>;
  if (!url) return <span>Loading attachment…</span>;
  return message.attachment_type === 'image'
    ? <a className="support-image-link" href={url} target="_blank" rel="noopener noreferrer"><img className="support-image" src={url} alt={message.attachment_name} /></a>
    : <a className="support-file action-link-btn" href={url} download={message.attachment_name}>PDF · {message.attachment_name} · {size(message.attachment_size)}</a>;
}

export default function SupportInbox({base, token}: {base: string; token: string}) {
  const [search, setSearch] = useState('');
  const [threadPage, setThreadPage] = useState(1);
  const [list, setList] = useState<Inbox>();
  const [selected, setSelected] = useState<number>();
  const [conversation, setConversation] = useState<Conversation>();
  const [older, setOlder] = useState<Message[]>([]);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [more, setMore] = useState(false);
  const [body, setBody] = useState('');
  const [file, setFile] = useState<File>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, refresh] = useState(0);
  const timeline = useRef<HTMLDivElement>(null);
  const path = selected ? `${inboxPath}${selected}/` : '';
  useEffect(() => {
    const controller = new AbortController();
    let busy = false;
    async function poll() {
      if (busy || document.hidden || controller.signal.aborted) return;
      busy = true;
      try {
        const init = {signal: controller.signal};
        const data = await requestApi<Inbox>(base, inboxPath + `?page=${threadPage}&q=${encodeURIComponent(search)}`, token, init);
        if (!controller.signal.aborted) setList(data);
        if (path) {
          const active = await requestApi<Conversation>(base, path, token, init);
          if (controller.signal.aborted) return;
          setConversation(active);
          const latest = active.messages.at(-1);
          if (active.admin_unread_count && latest && document.hasFocus()) await requestApi(base, path + 'mark-read/', token, {
            ...init, method: 'POST', body: JSON.stringify({through_id: latest.id}),
          });
        }
      } catch (e) {if (!controller.signal.aborted) setError(e instanceof Error ? e.message : 'Could not load messages.');}
      finally {busy = false;}
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 6000);
    return () => {controller.abort(); window.clearInterval(timer);};
  }, [base, token, search, threadPage, path, revision]);
  const latestId = conversation?.messages.at(-1)?.id;
  useEffect(() => {if (timeline.current) timeline.current.scrollTop = timeline.current.scrollHeight;}, [latestId, selected]);
  async function loadOlder() {
    const before = (older[0] ?? conversation?.messages[0])?.id;
    if (!before || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const data = await requestApi<Conversation>(base, path + `?before_id=${before}`, token);
      setOlder(current => [...data.messages, ...current]);
      setMore(Boolean(data.next));
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not load older messages.');}
    finally {setLoadingOlder(false);}
  }
  async function send() {
    if (busy || !path || (!body.trim() && !file)) return;
    if (file && file.size > 10 * 1024 * 1024) {setError('Choose a file up to 10 MB.'); return;}
    const data = new FormData();
    data.append('body', body.trim());
    if (file) data.append('attachment', file);
    setBusy(true);
    setError('');
    try {
      await requestApi(base, path + 'messages/', token, {method: 'POST', body: data});
      setBody(''); setFile(undefined); refresh(value => value + 1);
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not send the message.');}
    finally {setBusy(false);}
  }
  const messages = [...new Map([...older, ...(conversation?.messages ?? [])].map(message => [message.id, message])).values()];
  return <>
    {error && <p role="alert">{error} <button onClick={() => {setError(''); refresh(value => value + 1);}}>Retry</button></p>}
    <div className="support-inbox">
      <section aria-label="Dealer conversations" className="support-threads">
        <input aria-label="Search conversations" placeholder="Search by dealer name or mobile…" value={search} onChange={e => {setSearch(e.target.value); setThreadPage(1);}} />
        {!list && !error && <p>Loading conversations…</p>}
        {list?.results.length === 0 && <p className="empty-state">No conversations found.</p>}
        {list?.results.map(thread => <button key={thread.id} disabled={busy || loadingOlder} className="support-thread" aria-pressed={thread.id === selected} onClick={() => {
          if (selected === thread.id) return;
          setSelected(thread.id); setConversation(undefined); setOlder([]); setMore(false); setBody(''); setFile(undefined); setError('');
        }}>
          <strong>{thread.business_name || 'Dealer'} · {thread.verification_status}</strong>
          <span>{[thread.owner_name, thread.phone, thread.city].filter(Boolean).join(' · ')}</span>
          <span>{thread.last_message_preview} {thread.admin_unread_count > 0 && <b className="support-badge">{thread.admin_unread_count}</b>}</span>
          <small>{date(thread.last_message_at)}</small>
        </button>)}
        {list?.previous && <button onClick={() => setThreadPage(p => p - 1)}>Previous</button>}
        {list?.next && <button onClick={() => setThreadPage(p => p + 1)}>Next</button>}
      </section>
      <section aria-label="Conversation" className="support-conversation">
        {!conversation ? <p>{selected ? 'Loading conversation…' : 'Select a dealer conversation.'}</p> : <>
          <header><strong>{conversation.business_name}</strong><div>{[conversation.owner_name, conversation.phone, conversation.city, conversation.verification_status].filter(Boolean).join(' · ')}</div></header>
          <div className="support-timeline" ref={timeline} aria-label="Message history">
            {(older.length === 0 ? conversation.next : more) && <button disabled={loadingOlder} onClick={() => void loadOlder()}>Load older messages</button>}
            {messages.map(message => <article className={`support-bubble ${message.sender_role}`} key={message.id}>
              {message.body && <div>{message.body}</div>}
              {message.attachment_type && <Attachment base={base} path={`${path}attachments/${message.id}/`} token={token} message={message} />}
              <small>{date(message.created_at)}{message.sender_role === 'admin' && (message.is_read ? ' · Read' : ' · Sent')}</small>
            </article>)}
          </div>
          <form className="support-composer" onSubmit={e => {e.preventDefault(); void send();}}>
            <textarea aria-label="Reply" placeholder="Write a reply…" maxLength={4000} value={body} disabled={busy} onChange={e => setBody(e.target.value)} onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {e.preventDefault(); void send();}
            }} />
            <label>Attach image or PDF <input type="file" disabled={busy} accept="image/jpeg,image/png,image/webp,application/pdf" onChange={e => {
              setFile(e.target.files?.[0]); e.target.value = '';
            }} /></label>
            {file && <button className="btn-ghost" type="button" disabled={busy} onClick={() => setFile(undefined)}>{file.name} · Remove</button>}
            <button className="btn-primary" type="submit" disabled={busy || (!body.trim() && !file)}>{busy ? 'Sending…' : 'Send'}</button>
          </form>
        </>}
      </section>
    </div>
  </>;
}
