import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { AppState } from 'react-native';
import { recoverSession, SessionRejected } from './session-recovery';
import { ApiClient, ApiError } from './api';
import { account as loadAccount, type Account, type Tokens } from './auth';

type Session = { token: string | null; account: Account | null; message: string; establishSession: (issued: Tokens) => Promise<void>; clearSession: () => void; revalidateSession: () => void; signOut: () => Promise<void> };
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
  const clearSession = useCallback(() => { generation.current++; setSession(null); setAccount(null); void SecureStore.deleteItemAsync(SESSION_KEY); }, []);
  useEffect(() => {
    let cancelled = false;
    void SecureStore.getItemAsync(SESSION_KEY).then(async raw => {
      if (!raw || cancelled) return;
      try {
        const saved: unknown = JSON.parse(raw);
        if (!validPersisted(saved)) throw new Error('Invalid saved session.');
        try {
          const recovered = await recoverSession(api, saved.tokens);
          if (!cancelled) { setSession(recovered.tokens); setAccount(recovered.account); setOffline(false); setMessage('Encrypted local session restored and revalidated.'); await persist(recovered.tokens, recovered.account); }
        } catch (error) {
          if (!(error instanceof SessionRejected)) {
            if (!cancelled) { setSession(saved.tokens); setAccount(saved.account); setOffline(true); setMessage('Server unavailable: local session retained for device files. Server revalidation will retry.'); }
          } else {
            await SecureStore.deleteItemAsync(SESSION_KEY);
            if (!cancelled) setMessage('Saved session is no longer valid. Sign in again.');
          }
        }
      } catch { await SecureStore.deleteItemAsync(SESSION_KEY); if (!cancelled) setMessage('Saved session was invalid and has been cleared.'); }
    }).catch(() => { if (!cancelled) setMessage('Secure session storage is unavailable. Sign in again.'); });
    return () => { cancelled = true; };
  }, [api]);
  async function establishSession(issued: Tokens) {
    const id = ++generation.current;
    const profile = await loadAccount(api, issued.access);
    if (id !== generation.current) return;
    setAccount(profile); setSession(issued); setOffline(false); setMessage(''); await persist(issued, profile);
  }
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    let inFlight = false;
    const revalidate = async () => {
      if(inFlight || cancelled)return;
      inFlight=true;
      try {
        const recovered = await recoverSession(api,session,true);
        if (!cancelled) { setSession(recovered.tokens); setAccount(recovered.account); setOffline(false); setMessage(''); await persist(recovered.tokens, recovered.account); }
      } catch(error) {
        if (!cancelled) {
          if(error instanceof SessionRejected){clearSession();setMessage('Session rejected by server. Sign in again.');}
          else {setOffline(true);setMessage('Server unavailable: local session retained for device files. Server revalidation will retry.');}
        }
      } finally {inFlight=false;}
    };
    const timer = setInterval(() => void revalidate(), offline ? 15000 : Math.max(1000, Math.min(60000,(session.expires_in-30)*1000)));
    const active = AppState.addEventListener('change',state=>{if(state==='active')void revalidate();});
    revalidationRunner.current=()=>void revalidate();
    return () => { cancelled = true; clearInterval(timer); active.remove(); revalidationRunner.current=()=>{}; };
  }, [session, api, clearSession, offline]);
  async function signOut() {
    const current = session;
    clearSession(); setMessage('');
    if (current) {
      try { await api.post('/auth/logout', {}, current.access); }
      catch { setMessage('Local session cleared. Server logout could not be confirmed.'); }
    }
  }
  return <Context.Provider value={{ token: session?.access ?? null, account, message, establishSession, clearSession, revalidateSession, signOut }}>{children}</Context.Provider>;
}
export function useSession() {
  const session = useContext(Context);
  if (!session) throw new Error('Missing session provider.');
  return session;
}
