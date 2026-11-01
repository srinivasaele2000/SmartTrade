import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ApiClient } from './api';
import { account as loadAccount, type Account, type Tokens } from './auth';

type Session = { token: string | null; account: Account | null; message: string; establishSession: (issued: Tokens) => Promise<void>; clearSession: () => void; signOut: () => Promise<void> };
const Context = createContext<Session | null>(null);
export function SessionProvider({ api, children }: { api: ApiClient; children: ReactNode }) {
  const [session, setSession] = useState<Tokens | null>(null);
  const [account, setAccount] = useState<Account | null>(null);
  const [message, setMessage] = useState('');
  const generation = useRef(0);
  const clearSession = useCallback(() => { generation.current++; setSession(null); setAccount(null); }, []);
  async function establishSession(issued: Tokens) {
    const id = ++generation.current;
    const profile = await loadAccount(api, issued.access);
    if (id !== generation.current) return;
    setAccount(profile); setSession(issued); setMessage('');
  }
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await api.post('/auth/refresh', { refresh: session.refresh }) as { access: string; refresh?: string };
        if (!result.access) throw new Error('Invalid refresh response.');
        const profile = await loadAccount(api, result.access);
        if (!cancelled) { setSession({ ...session, access: result.access, refresh: result.refresh || session.refresh }); setAccount(profile); }
      } catch {
        if (!cancelled) { clearSession(); setMessage('Session refresh failed. Sign in again.'); }
      }
    }, Math.max(1000, (session.expires_in - 30) * 1000));
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session, api, clearSession]);
  async function signOut() {
    const current = session;
    clearSession(); setMessage('');
    if (current) {
      try { await api.post('/auth/logout', {}, current.access); }
      catch { setMessage('Local session cleared. Server logout could not be confirmed.'); }
    }
  }
  return <Context.Provider value={{ token: session?.access ?? null, account, message, establishSession, clearSession, signOut }}>{children}</Context.Provider>;
}
export function useSession() {
  const session = useContext(Context);
  if (!session) throw new Error('Missing session provider.');
  return session;
}
