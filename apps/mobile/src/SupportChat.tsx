import {useCallback, useEffect, useRef, useState, type ComponentRef} from 'react';
import {ActivityIndicator, AppState, Platform, ScrollView, StyleSheet, Text, TextInput, View} from 'react-native';
import {Image} from 'expo-image';
import * as DocumentPicker from 'expo-document-picker';
import * as files from 'expo-file-system/legacy';
import {File as NativeFile} from 'expo-file-system';
import {Button} from './Button';
import {StickyBottomBar} from './StickyBottomBar';
import {type ApiClient} from './api';
import {istDateTime} from './india';
import {openLocalPdf} from './open-local-pdf';
import {trade} from './trade-theme';

const base = '/messages/dealer/';
const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
type Attachment = {uri: string; name: string; type: string; size?: number};
type Message = {id: number; sender_role: 'admin' | 'dealer'; body: string; attachment_type: string;
  attachment_name: string; attachment_size: number | null; created_at: string; is_read: boolean};
type Thread = {messages: Message[]; next: string | null; dealer_unread_count: number};

function usePoll(task: (signal: AbortSignal) => Promise<void>, active = true) {
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    let pending = false;
    const tick = async () => {
      if (pending || controller.signal.aborted || (AppState.currentState && AppState.currentState !== 'active')) return;
      pending = true;
      try {await task(controller.signal);} finally {pending = false;}
    };
    void tick();
    const timer = setInterval(() => void tick(), 6000);
    const listener = AppState.addEventListener('change', state => {if (state === 'active') void tick();});
    return () => {controller.abort(); clearInterval(timer); listener.remove();};
  }, [task, active]);
}

export function useDealerSupportUnread(api: ApiClient, token: string | null) {
  const [count, setCount] = useState(0);
  useEffect(() => {if (!token) setCount(0);}, [token]);
  usePoll(useCallback(async signal => {
    if (!token) return;
    try {
      const data = await api.get(base + 'unread/', signal, token) as {dealer_unread_count: number};
      if (!signal.aborted) setCount(data.dealer_unread_count);
    } catch {}
  }, [api, token]), Boolean(token));
  return count;
}

export default function SupportChat({api, token}: {api: ApiClient; token: string}) {
  const [thread, setThread] = useState<Thread>();
  const [older, setOlder] = useState<Message[]>([]);
  const [more, setMore] = useState(false);
  const [body, setBody] = useState('');
  const [file, setFile] = useState<Attachment>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [revision, refresh] = useState(0);
  const scroll = useRef<ComponentRef<typeof ScrollView>>(null);
  const autoScroll = useRef(true);
  const poll = useCallback(async (signal: AbortSignal) => {
    try {
      const data = await api.get(base + 'thread/', signal, token) as Thread;
      if (signal.aborted) return;
      setThread(data);
      const latest = data.messages.at(-1);
      if (data.dealer_unread_count && latest) await api.get(base + 'mark-read/', signal, token, {
        method: 'POST', body: JSON.stringify({through_id: latest.id}),
      });
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : 'Could not load messages.');
    }
  }, [api, token]);
  usePoll(useCallback(signal => poll(signal), [poll, revision]));

  async function pick(kind: 'photo' | 'camera' | 'pdf') {
    setError(''); setBusy(true);
    try {
      let selected: Attachment | undefined;
      if (kind === 'pdf') {
        const result = await DocumentPicker.getDocumentAsync({type: 'application/pdf', copyToCacheDirectory: true});
        const asset = result.assets?.[0];
        if (asset) selected = {uri: asset.uri, name: asset.name, type: asset.mimeType ?? 'application/pdf', size: asset.size};
      } else {
        const picker = await import('expo-image-picker');
        if (kind === 'camera' && !(await picker.requestCameraPermissionsAsync()).granted) {
          throw new Error('Allow camera access in Settings or choose an existing photo.');
        }
        const result = kind === 'camera' ? await picker.launchCameraAsync({mediaTypes: ['images']})
          : await picker.launchImageLibraryAsync({mediaTypes: ['images']});
        const asset = result.assets?.[0];
        if (asset) {
          const type = asset.mimeType ?? '';
          const suffix = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
          selected = {uri: asset.uri, name: asset.fileName ?? `Photo.${suffix}`, type, size: asset.fileSize};
        }
      }
      if (!selected) return;
      if (!allowed.includes(selected.type)) throw new Error('Choose a JPEG, PNG, WebP or PDF.');
      if ((selected.size ?? 0) > 10 * 1024 * 1024) throw new Error('Choose a file up to 10 MB.');
      setFile(selected);
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not select a file.');}
    finally {setBusy(false);}
  }

  async function send() {
    if (busy || (!body.trim() && !file)) return;
    setBusy(true); setError('');
    try {
      const data = new FormData();
      data.append('body', body.trim());
      if (file) {
        if (Platform.OS === 'web') data.append('attachment', await (await fetch(file.uri)).blob(), file.name);
        else {
          const source = new NativeFile(file.uri);
          // Expo fetch reads file bytes rather than accepting a React Native URI part.
          const attachment = {name: file.name, type: file.type, bytes: () => source.bytes()};
          data.append('attachment', attachment as unknown as Blob);
        }
      }
      await api.get(base + 'messages/', undefined, token, {method: 'POST', body: data});
      autoScroll.current = true;
      setBody(''); setFile(undefined); refresh(value => value + 1);
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not send the message.');}
    finally {setBusy(false);}
  }
  async function olderMessages() {
    const before = (older[0] ?? thread?.messages[0])?.id;
    if (busy || !before) return;
    setBusy(true); setError('');
    try {
      const data = await api.get(base + `thread/?before_id=${before}`, undefined, token) as Thread;
      autoScroll.current = false;
      setOlder(current => [...data.messages, ...current]); setMore(Boolean(data.next));
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not load older messages.');}
    finally {setBusy(false);}
  }
  async function openPdf(id: number) {
    setError('');
    const uri = api.base + base + `attachments/${id}/`;
    const headers = {Authorization: `Bearer ${token}`};
    let local: string | undefined;
    try {
      if (Platform.OS === 'web') {
        const response = await fetch(uri, {headers});
        if (!response.ok) throw new Error('Could not download this PDF.');
        const objectUrl = URL.createObjectURL(await response.blob());
        const link = document.createElement('a');
        link.href = objectUrl;
        link.download = 'Support attachment.pdf';
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        return;
      }
      if (!files.cacheDirectory) throw new Error('Local storage is unavailable.');
      local = files.cacheDirectory + `support-${id}-${Date.now()}.pdf`;
      const result = await files.downloadAsync(uri, local, {headers});
      if (result.status !== 200) throw new Error('Could not download this PDF.');
      await openLocalPdf(local);
    } catch (e) {setError(e instanceof Error ? e.message : 'Could not open the PDF.');}
    finally {if (local) await files.deleteAsync(local, {idempotent: true}).catch(() => {});}
  }
  const messages = [...new Map([...older, ...(thread?.messages ?? [])].map(item => [item.id, item])).values()];
  return <View style={s.screen}>
    <ScrollView ref={scroll} style={s.screen} contentContainerStyle={s.timeline} keyboardShouldPersistTaps="handled"
      onContentSizeChange={() => {if (autoScroll.current) scroll.current?.scrollToEnd({animated: false});}}>
      {!thread && !error && <ActivityIndicator accessibilityLabel="Loading messages" />}
      {thread && messages.length === 0 && <Text style={s.meta}>Start a conversation with SmartTrade Support.</Text>}
      {(older.length === 0 ? thread?.next : more) && <Button variant="tertiary" title="Load older messages" disabled={busy} onPress={() => void olderMessages()} />}
      {messages.map(message => <View key={message.id} style={[s.bubble, message.sender_role === 'dealer' && s.mine]}>
        {!!message.body && <Text style={s.body}>{message.body}</Text>}
        {message.attachment_type === 'image' && <Image accessibilityLabel={message.attachment_name} style={s.image}
          source={{uri: api.base + base + `attachments/${message.id}/`, headers: {Authorization: `Bearer ${token}`}}}
          cachePolicy="none" contentFit="contain" />}
        {message.attachment_type === 'pdf' && <Button variant="secondary" title={`PDF · ${message.attachment_name} · ${Math.max(1, Math.round((message.attachment_size ?? 0) / 1024))} KB`}
          onPress={() => void openPdf(message.id)} />}
        <Text style={s.meta}>{istDateTime(message.created_at)}{message.sender_role === 'dealer' && (message.is_read ? ' · Read' : ' · Sent')}</Text>
      </View>)}
    </ScrollView>
    <StickyBottomBar aboveTabs>
      {!!error && <View style={s.actions}><Text accessibilityRole="alert" style={[s.body, s.error]}>{error}</Text>
        <Button variant="tertiary" title="Retry loading" onPress={() => {setError(''); refresh(value => value + 1);}} /></View>}
      {file && <Button variant="tertiary" title={`${file.name} · Remove`} disabled={busy} onPress={() => setFile(undefined)} />}
      <TextInput style={s.input} accessibilityLabel="Message" placeholder="Write a message…" multiline maxLength={4000}
        value={body} editable={!busy} onChangeText={setBody} />
      <View style={s.actions}>
        <Button variant="secondary" compact title="Photo" disabled={busy} onPress={() => void pick('photo')} />
        {Platform.OS !== 'web' && <Button variant="secondary" compact title="Camera" disabled={busy} onPress={() => void pick('camera')} />}
        <Button variant="secondary" compact title="PDF" disabled={busy} onPress={() => void pick('pdf')} />
        <Button variant="primary" compact title="Send" disabled={busy || (!body.trim() && !file)} onPress={() => void send()} />
      </View>
    </StickyBottomBar>
  </View>;
}

const s = StyleSheet.create({
  screen: {flex: 1}, timeline: {padding: trade.gutter, gap: 8},
  bubble: {alignSelf: 'flex-start', maxWidth: '88%', borderRadius: 12, backgroundColor: trade.surface,
    borderColor: trade.border, borderWidth: 1, padding: 10, gap: 4},
  mine: {alignSelf: 'flex-end', backgroundColor: '#e6f4ed'},
  body: {color: trade.ink, fontSize: 14}, meta: {color: trade.secondary, fontSize: 12},
  image: {width: 200, height: 150, maxWidth: '100%'},
  input: {color: trade.ink, minHeight: 44, maxHeight: 110, borderWidth: 1, borderColor: trade.border, borderRadius: 8, padding: 8},
  actions: {flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, marginTop: 4},
  error: {flex: 1, color: '#9c2820'},
});
