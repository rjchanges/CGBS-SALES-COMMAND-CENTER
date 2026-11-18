import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppProvider, useApp } from './context';
import { Shell } from './layout';
import { ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from './pages/auth';
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

function WorkspaceRoutes() {
  return <Suspense fallback={<div className="loading-screen"><span className="spinner" />Opening workspace</div>}>
    <Routes><Route element={<Shell />}>
      <Route index element={<DashboardPage />} /><Route path="leads" element={<LeadsPage />} />
      <Route path="calling" element={<CallingPage />} /><Route path="follow-ups" element={<FollowUpsPage />} />
      <Route path="calendar" element={<CalendarPage />} /><Route path="opportunities" element={<OpportunitiesPage />} />
      <Route path="reports" element={<ReportsPage />} /><Route path="templates" element={<TemplatesPage />} />
      <Route path="notifications" element={<NotificationsPage />} /><Route path="settings" element={<SettingsPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route></Routes>
  </Suspense>;
}
function Gate() {
  const { authenticated, loading, error } = useApp();
  if (loading) return <div className="loading-screen"><span className="spinner" />Loading your workspace</div>;
  return <Routes>
    <Route path="/login" element={authenticated ? <Navigate to="/" replace /> : <SignInPage initialError={error} />} />
    <Route path="/signup" element={authenticated ? <Navigate to="/" replace /> : <SignUpPage />} />
    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
    <Route path="/reset-password" element={<ResetPasswordPage />} />
    <Route path="*" element={authenticated ? <WorkspaceRoutes /> : <Navigate to="/login" replace />} />
  </Routes>;
}
export default function App() {
  return <AppProvider><BrowserRouter><Gate /></BrowserRouter></AppProvider>;
}
