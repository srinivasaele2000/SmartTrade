import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { recoverSession, SessionRejected } from './session-recovery';
import { ApiClient, ApiError } from './api';
import { account as loadAccount, type Account, type Tokens } from './auth';

type ExpectedAccount = {role: Account['account_type']; mobile: string};
type Session = { token: string | null; account: Account | null; message: string; establishSession: (issued: Tokens, expected?: ExpectedAccount) => Promise<Account>; clearSession: () => void; revalidateSession: () => void; signOut: () => Promise<void> };
const Context = createContext<Session | null>(null);
const SESSION_KEY = 'smarttrade.session.v1';
type PersistedSession = { tokens: Tokens; account: Account };
function validPersisted(value: unknown): value is PersistedSession {
  if (!value || typeof value !== 'object') return false;
  const item = value as { tokens?: Partial<Tokens>; account?: Partial<Account> };
  return typeof item.tokens?.access === 'string' && typeof item.tokens?.refresh === 'string' && typeof item.tokens?.expires_in === 'number' && typeof item.account?.id === 'number' && typeof item.account?.account_type === 'string' && typeof item.account?.access_state === 'string';
}
async function persist(tokens: Tokens, account: Account) { await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify({ tokens, account })); }
export function SessionProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [session, setSession] = useState<Tokens | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState('');
  const [offline, setOffline] = useState(false);
  const revalidationRunner = useRef<() => void>(()=>{});
  const revalidateSession = useCallback(() => revalidationRunner.current(), []);
  const generation = useRef(0);
  const storageQueue = useRef(Promise.resolve());
  const enqueueStorage = useCallback((write: () => Promise<void>) => {
    const next = storageQueue.current.then(write);
    storageQueue.current = next.catch(() => {});
    return next;
  }, []);
  const installing = useRef(false);
  const clearSession = useCallback(() => { generation.current++; setSession(null); setAccount(null); void enqueueStorage(() => SecureStore.deleteItemAsync(SESSION_KEY)); }, [enqueueStorage]);
  useEffect(() => {
    let cancelled = false;
    const revision = generation.current;
    const current = () => !cancelled && revision === generation.current;
    void SecureStore.getItemAsync(SESSION_KEY).then(async raw => {
      if (!raw || !current()) return;
      try {
        const saved: unknown = JSON.parse(raw);
        if (!validPersisted(saved)) throw new Error('Invalid saved session.');
        try {
          const recovered = await recoverSession(api, saved.tokens);
          if (current()) { setSession(recovered.tokens); setAccount(recovered.account); setOffline(false); setMessage(''); await enqueueStorage(() => persist(recovered.tokens, recovered.account)); }
        } catch (error) {
          if (!current()) return;
          if (!(error instanceof SessionRejected)) {
            if (!cancelled) { setSession(saved.tokens); setAccount(saved.account); setOffline(true); setMessage('You’re browsing offline. Your saved files stay on this device. We’ll reconnect automatically.'); }
          } else {
            await enqueueStorage(() => SecureStore.deleteItemAsync(SESSION_KEY));
            if (current()) setMessage('Please sign in again to continue.');
          }
        }
      } catch { if (current()) { await enqueueStorage(() => SecureStore.deleteItemAsync(SESSION_KEY)); if (current()) setMessage('Please sign in again to continue.'); } }
    }).catch(() => { if (current()) setMessage('We couldn’t restore your sign-in. Please try signing in again.'); });
    return () => { cancelled = true; };
  }, [api, enqueueStorage]);
  async function establishSession(issued: Tokens, expected?: ExpectedAccount) {
    const id = ++generation.current;
    const profile = await loadAccount(api, issued.access);
    if (id !== generation.current) throw new Error('Sign-in changed. Please try again.');
    if (expected && (profile.account_type !== expected.role || profile.mobile_e164 !== expected.mobile ||
      (expected.role === 'STAFF' && profile.staff_profile?.state !== 'ACTIVE'))) {
      throw new Error('The server returned a different identity. Check the demo account configuration.');
    }
    installing.current = true;
    const revision = ++generation.current;
    try {
      await enqueueStorage(() => persist(issued, profile));
      if (revision !== generation.current) throw new Error('Sign-in changed. Please try again.');
      setAccount(profile); setSession(issued); setOffline(false); setMessage('');
      return profile;
    } finally {installing.current = false;}
  }
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let inFlight = false;
    const revalidate = async () => {
      if(inFlight || cancelled || installing.current)return;
      const revision = generation.current;
      inFlight=true;
      try {
        const recovered = await recoverSession(api,session,true);
        if (!cancelled && revision === generation.current) { setSession(recovered.tokens); setAccount(recovered.account); setOffline(false); setMessage(''); await enqueueStorage(() => persist(recovered.tokens, recovered.account)); }
      } catch(error) {
        if (!cancelled && revision === generation.current) {
          if(error instanceof SessionRejected){clearSession();setMessage('Please sign in again to continue.');}
          else {setOffline(true);setMessage('You’re browsing offline. Your saved files stay on this device. We’ll reconnect automatically.');}
        }
      } finally {inFlight=false;}
    };
    const timer = setInterval(() => void revalidate(), offline ? 15000 : Math.max(1000, Math.min(60000,(session.expires_in-30)*1000)));
    const active = AppState.addEventListener('change',state=>{if(state==='active')void revalidate();});
    revalidationRunner.current=()=>void revalidate();
    return () => { cancelled = true; clearInterval(timer); active.remove(); revalidationRunner.current=()=>{}; };
  }, [session, api, clearSession, offline, enqueueStorage]);
  async function signOut() {
    const current = session;
    clearSession(); setMessage('');
    if (current) {
      try { await api.post('/auth/logout', {}, current.access); }
      catch { setMessage('You’re signed out on this device. We couldn’t confirm sign-out online.'); }
    }
  }
  return <Context.Provider value={{ token: session?.access ?? null, account, message, establishSession, clearSession, revalidateSession, signOut }}>{children}</Context.Provider>;
}
export function useSession() {
  const session = useContext(Context);
  if (!session) throw new Error('Missing session provider.');
  return session;
}
