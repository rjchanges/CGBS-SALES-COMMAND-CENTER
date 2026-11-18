import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Bootstrap } from './api';
import { ApiRequestError, request } from './api';
import { supabase, supabaseConfigured } from './supabase';

export type AuthenticatedUser = { id: string; name: string; role: string; email: string };
type AppContextValue = {
  data: Bootstrap | null;
  user: AuthenticatedUser | null;
  authenticated: boolean;
  loading: boolean;
  error: string;
  refresh: () => Promise<AuthenticatedUser | null>;
  logout: () => void;
  toast: (message: string, kind?: 'success' | 'error') => void;
};
const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const signoutError = useRef('');
  const seenNotificationIds = useRef<Set<string> | null>(null);
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error'; id: number } | null>(null);

  const refresh = useCallback(async () => {
    const currentGeneration = ++generation.current;
    const sessionResult = supabase ? await supabase.auth.getSession() : null;
    const hasCredentials = Boolean(sessionResult?.data.session);
    if (!hasCredentials) {
      setData(null); setUser(null); setError(''); setLoading(false); return null;
    }
    setLoading(true);
    try {
      // Validate the user's JWT and profile independently from CRM bootstrap. A
      // workspace/data outage must not be mistaken for a failed sign-in.
      const identity = await request<{ user: AuthenticatedUser }>('/auth/me');
      if (currentGeneration !== generation.current) return null;
      setUser(identity.user);
      setError('');
      try {
        const workspace = await request<Bootstrap>('/bootstrap');
        if (currentGeneration !== generation.current) return null;
        setData(workspace);
        seenNotificationIds.current = new Set(workspace.notifications.map((item) => item.id));
      } catch (workspaceError) {
        if (currentGeneration !== generation.current) return null;
        setData(null);
        setError(workspaceError instanceof Error ? workspaceError.message : 'Your account is signed in, but workspace data could not be loaded.');
      }
      return identity.user;
    } catch (authError) {
      if (currentGeneration !== generation.current) return null;
      setData(null); setUser(null);
      const message = authError instanceof Error ? authError.message : 'The API could not validate your sign-in.';
      if (authError instanceof ApiRequestError && (authError.status === 401 || authError.status === 403)) {
        signoutError.current = message;
        setError(message);
        if (supabase) await supabase.auth.signOut();
      } else setError(message);
      throw authError;
    } finally {
      if (currentGeneration === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    if (!supabase) {
      setLoading(false);
      return () => { mounted = false; };
    }
    void supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!mounted) return;
      if (sessionData.session) void refresh().catch(() => undefined);
      else setLoading(false);
    }).catch(() => {
      if (mounted) { setError('Could not restore your Supabase session. Please sign in again.'); setLoading(false); }
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_OUT' || !session) {
        generation.current += 1;
        const message = signoutError.current;
        signoutError.current = '';
        setData(null); setUser(null); setError(message); setLoading(false);
        return;
      }
      if (event === 'USER_UPDATED') {
        window.setTimeout(() => { if (mounted) void refresh().catch(() => undefined); }, 0);
      }
    });
    return () => { mounted = false; listener.subscription.unsubscribe(); };
  }, [refresh]);

  const syncQuietly = useCallback(async () => {
    const sessionResult = supabase ? await supabase.auth.getSession() : null;
    if (!sessionResult?.data.session) return;
    try {
      const workspace = await request<Bootstrap>('/bootstrap');
      const previous = seenNotificationIds.current;
      if (previous && 'Notification' in window && Notification.permission === 'granted') {
        for (const item of workspace.notifications) if (!previous.has(item.id)) try { new Notification(item.title, { body: item.body }); } catch { /* browser alerts are optional */ }
      }
      seenNotificationIds.current = new Set(workspace.notifications.map((item) => item.id));
      setData(workspace); setError('');
    } catch (syncError) {
      if (syncError instanceof ApiRequestError && syncError.status === 401 && supabase) await supabase.auth.signOut();
    }
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void syncQuietly(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void syncQuietly(); };
    window.addEventListener('focus', onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onVisible); };
  }, [syncQuietly]);

  const logout = useCallback(() => {
    generation.current += 1;
    signoutError.current = '';
    setData(null); setUser(null); setError(''); setLoading(false);
    if (supabase) void supabase.auth.signOut();
  }, []);
  const toast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = Date.now(); setNotice({ message, kind, id });
    window.setTimeout(() => setNotice((current) => current?.id === id ? null : current), 3300);
  }, []);
  const value = useMemo(() => ({ data, user, authenticated: Boolean(user), loading, error, refresh, logout, toast }), [data, user, loading, error, refresh, logout, toast]);
  return <AppContext.Provider value={value}>{children}{notice && <div className={'toast toast-' + notice.kind}>{notice.kind === 'success' ? '✓' : '!'} {notice.message}</div>}</AppContext.Provider>;
}
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider.');
  return context;
}
