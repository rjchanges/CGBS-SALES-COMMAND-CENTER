
import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context';
import { Shell } from './layout';
import './styles.css';

const DashboardPage = lazy(() => import('./pages/dashboard').then((page) => ({ default: page.DashboardPage })));
const LeadsPage = lazy(() => import('./pages/leads').then((page) => ({ default: page.LeadsPage })));
const CallingPage = lazy(() => import('./pages/calling').then((page) => ({ default: page.CallingPage })));
const FollowUpsPage = lazy(() => import('./pages/tasks').then((page) => ({ default: page.FollowUpsPage })));
const CalendarPage = lazy(() => import('./pages/calendar').then((page) => ({ default: page.CalendarPage })));
const OpportunitiesPage = lazy(() => import('./pages/revenue').then((page) => ({ default: page.OpportunitiesPage })));
const ReportsPage = lazy(() => import('./pages/revenue').then((page) => ({ default: page.ReportsPage })));
const TemplatesPage = lazy(() => import('./pages/settings').then((page) => ({ default: page.TemplatesPage })));
const SettingsPage = lazy(() => import('./pages/settings').then((page) => ({ default: page.SettingsPage })));
const NotificationsPage = lazy(() => import('./pages/settings').then((page) => ({ default: page.NotificationsPage })));

function Gate() {
  const { data, loading, error, loginDemo } = useApp();
  if (loading) return <div className="loading-screen"><span className="spinner" />Loading your workspace</div>;
  if (!data) return <main className="login-screen"><section className="login-card"><img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" /><span className="eyebrow">CGBS SALES</span><h1>Good work starts with a clear next step.</h1><p>Keep your leads, calls and pipeline moving from one calm workspace.</p>{error && <div className="inline-error">{error}</div>}<button className="button button-primary button-wide" onClick={() => void loginDemo()}>Continue to demo workspace <span>→</span></button><small>Local fictional demo · no password required</small></section><div className="login-side"><div className="login-grid"></div><div className="login-quote"><span>“</span><h2>Make every follow-up count.</h2><p>A thoughtful sales day begins with knowing who needs you next.</p></div></div></main>;
  return <Suspense fallback={<div className="loading-screen"><span className="spinner" />Opening workspace</div>}><Routes><Route element={<Shell />}><Route index element={<DashboardPage />} /><Route path="leads" element={<LeadsPage />} /><Route path="calling" element={<CallingPage />} /><Route path="follow-ups" element={<FollowUpsPage />} /><Route path="calendar" element={<CalendarPage />} /><Route path="opportunities" element={<OpportunitiesPage />} /><Route path="reports" element={<ReportsPage />} /><Route path="templates" element={<TemplatesPage />} /><Route path="notifications" element={<NotificationsPage />} /><Route path="settings" element={<SettingsPage />} /><Route path="*" element={<Navigate to="/" replace />} /></Route></Routes></Suspense>;
}
export default function App() {
  return <AppProvider><BrowserRouter><Gate /></BrowserRouter></AppProvider>;
}
