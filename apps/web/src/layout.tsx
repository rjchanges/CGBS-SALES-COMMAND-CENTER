import { useState, type HTMLAttributes, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3, Bell, CalendarDays, ChartNoAxesCombined, ChevronDown, CircleHelp, Clock3,
  Headset, Home, LogOut, Menu, Settings, UsersRound, X,
} from 'lucide-react';
import { useApp } from './context';

const nav = [
  { to: '/', label: 'Home Page', icon: Home, end: true },
  { to: '/leads', label: 'Leads', icon: UsersRound },
  { to: '/calling', label: 'Calling workspace', icon: Headset },
  { to: '/follow-ups', label: 'Follow-ups', icon: Clock3 },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/opportunities', label: 'Opportunities', icon: ChartNoAxesCombined },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/settings', label: 'Settings', icon: Settings },
];
const titles: Record<string, string> = {
  '/': 'Home Page', '/leads': 'Leads', '/calling': 'Calling workspace', '/follow-ups': 'Follow-ups',
  '/calendar': 'Calendar', '/opportunities': 'Opportunities', '/reports': 'Reports',
  '/templates': 'Email templates', '/notifications': 'Notifications', '/settings': 'Settings',
};
export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { data, logout } = useApp();
  const [open, setOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(() => localStorage.getItem('cgbs_sidebar_hidden') === 'true');
  const toggleSidebar = () => {
    const next = !sidebarHidden;
    setSidebarHidden(next);
    localStorage.setItem('cgbs_sidebar_hidden', String(next));
    if (next) setOpen(false);
  };
  const showSidebar = () => {
    setSidebarHidden(false);
    localStorage.setItem('cgbs_sidebar_hidden', 'false');
    if (window.matchMedia('(max-width: 900px)').matches) setOpen(true);
  };
  const [userMenu, setUserMenu] = useState(false);
  const now = new Date();
  const date = new Intl.DateTimeFormat('en', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
  const fireAdd = () => {
    if (location.pathname !== '/leads') { navigate('/leads'); window.setTimeout(() => window.dispatchEvent(new Event('cgbs:add-lead')), 50); }
    else window.dispatchEvent(new Event('cgbs:add-lead'));
  };
  return <div className={'app-frame ' + (sidebarHidden ? 'sidebar-hidden ' : '') + (open ? 'mobile-nav-open' : '')}>
    <button type="button" className="sidebar-external-toggle" aria-label="Show navigation" title="Show navigation" onClick={showSidebar}><Menu size={19} /></button>
    <aside className={'sidebar ' + (open ? 'sidebar-open' : '')}>
      <div className="sidebar-header"><NavLink to="/" className="brand" onClick={() => setOpen(false)} aria-label="Canopus Global Business Services — Home Page"><img className="brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" /><span className="brand-copy"><strong>Canopus</strong><small>Global Business Services</small></span></NavLink><button type="button" className="sidebar-toggle" onClick={toggleSidebar} aria-label={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'} aria-expanded={!sidebarHidden} title={sidebarHidden ? 'Show sidebar' : 'Hide sidebar'}><Menu size={19} /></button></div>
      <div className="nav-caption">Workspace</div>
      <nav className="side-nav">{nav.map(({ to, label, icon: Icon, end }) =>
        <NavLink key={to} to={to} end={end} title={label} aria-label={label} onClick={() => setOpen(false)} className={({ isActive }) => 'nav-link ' + (isActive ? 'active' : '')}>
          <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{label === 'Follow-ups' && data?.metrics.overdueFollowUps ? <i className="nav-count">{data.metrics.overdueFollowUps}</i> : null}
        </NavLink>
      )}</nav>
      <div className="sidebar-bottom"><button className="help-link" onClick={() => window.alert('Use the Help section in README.md for setup and demo data instructions.')}><CircleHelp size={18} /><span>Help &amp; support</span></button><div className="side-profile"><div className="avatar avatar-lime">RR</div><div className="profile-text"><strong>Rahul Raj M</strong><span>Administrator</span></div><button className="icon-button side-more" title="Sign out" onClick={logout}><LogOut size={17} /></button></div></div>
    </aside>
    {open && <button className="scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <div className="main-area">
      <header className="topbar"><div className="topbar-spacer"></div><div className="date-pill"><CalendarDays size={16} />{date}</div><button className="button button-dark add-lead-top" onClick={fireAdd}><span>＋</span> Add lead</button><div className="topbar-avatar-wrap"><button className="avatar avatar-dark" onClick={() => setUserMenu(!userMenu)} aria-label="Open profile menu">RR<ChevronDown size={13} /></button>{userMenu && <div className="user-menu"><strong>{data?.user.name}</strong><span>Administrator · Local demo</span><button onClick={logout}><LogOut size={15} /> Sign out</button></div>}</div></header>
      <main className="content"><div className="mobile-page-title">{titles[location.pathname] || 'Workspace'}</div><Outlet /></main>
      <footer className="app-footer"><span>© 2026 CGBS Sales Command Center</span><span><i className="status-dot" /> Demo workspace · Fictional sample records</span></footer>
    </div>
  </div>;
}
export function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: React.ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-actions">{action}</div>}</div>;
}
export function Card({ children, className = '', ...props }: HTMLAttributes<HTMLElement> & { children: ReactNode }) {
  return <section className={'card ' + className} {...props}>{children}</section>;
}
export function Button({ children, className = '', variant = 'default', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'primary' | 'ghost' | 'dark' }) {
  return <button className={'button button-' + variant + ' ' + className} {...props}>{children}</button>;
}
export function Modal({ title, sub, onClose, children, wide = false }: { title: string; sub?: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={'modal ' + (wide ? 'modal-wide' : '')} role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><h2>{title}</h2>{sub && <p>{sub}</p>}</div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={19} /></button></header>{children}</section></div>;
}








