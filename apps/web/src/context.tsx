import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Bootstrap } from './api';
import { getSession, request, setSession, startDemoSession } from './api';

type AppContextValue = {
  data: Bootstrap | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  loginDemo: () => Promise<void>;
  logout: () => void;
  toast: (message: string, kind?: 'success' | 'error') => void;
};
const AppContext = createContext<AppContextValue | null>(null);
export function AppProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [loading, setLoading] = useState(Boolean(getSession()));
  const [error, setError] = useState('');
  const seenNotificationIds = useRef<Set<string> | null>(null);
  const [notice, setNotice] = useState<{ message: string; kind: 'success' | 'error'; id: number } | null>(null);
  const refresh = useCallback(async () => {
    if (!getSession()) { setData(null); setLoading(false); return; }
    setLoading(true);
    try {
      const next = await request<Bootstrap>('/bootstrap');
      setData(next);
      seenNotificationIds.current = new Set(next.notifications.map((item) => item.id));
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load workspace data.');
      setData(null);
      setSession(null);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const syncQuietly = useCallback(async () => {
    if (!getSession()) return;
    try { const next = await request<Bootstrap>('/bootstrap'); const previous = seenNotificationIds.current; if (previous && 'Notification' in window && Notification.permission === 'granted') { for (const item of next.notifications) if (!previous.has(item.id)) try { new Notification(item.title, { body: item.body }); } catch { /* native alerts are optional; inbox delivery remains persisted */ } } seenNotificationIds.current = new Set(next.notifications.map((item) => item.id)); setData(next); setError(''); }
    catch { /* keep the last good snapshot until the normal refresh handles auth expiry */ }
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void syncQuietly(); }, 15_000);
    const onVisible = () => { if (document.visibilityState === 'visible') void syncQuietly(); };
    window.addEventListener('focus', onVisible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', onVisible); };
  }, [syncQuietly]);
  const loginDemo = useCallback(async () => {
    setLoading(true);
    try {
      await startDemoSession();
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : 'Unable to start demo session.'); }
    finally { setLoading(false); }
  }, [refresh]);
  const logout = useCallback(() => { setSession(null); setData(null); }, []);
  const toast = useCallback((message: string, kind: 'success' | 'error' = 'success') => {
    const id = Date.now();
    setNotice({ message, kind, id });
    window.setTimeout(() => setNotice((current) => current?.id === id ? null : current), 3300);
  }, []);
  const value = useMemo(() => ({ data, loading, error, refresh, loginDemo, logout, toast }), [data, loading, error, refresh, loginDemo, logout, toast]);
  return <AppContext.Provider value={value}>{children}{notice && <div className={'toast toast-' + notice.kind}>{notice.kind === 'success' ? '✓' : '!'} {notice.message}</div>}</AppContext.Provider>;
}
export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider.');
  return context;
}



