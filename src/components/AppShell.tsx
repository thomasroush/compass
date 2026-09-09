import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { CloudSyncBanner } from './CloudSyncBanner';
import { CopyToAIDialog } from './CopyToAIDialog';
import { PasswordRecoveryDialog } from './PasswordRecoveryDialog';
import { QuickAddTask } from './QuickAddTask';

const NAV_ITEMS = [
  { to: '/', label: 'Today' },
  { to: '/board', label: 'Board' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/projects', label: 'Projects' },
  { to: '/goals', label: 'Goals' },
  { to: '/notes', label: 'Daily Notes' },
  { to: '/calendar', label: 'Calendar' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell() {
  const location = useLocation();
  const [copyToAIOpen, setCopyToAIOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <img src="/compass_logo.jpg" alt="Daily Compass" className="brand-logo" />
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={location.pathname === item.to ? 'nav-link active' : 'nav-link'}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="main-column">
        <header className="top-bar">
          <div className="brand mobile-brand">
            <img src="/compass_logo.jpg" alt="Daily Compass" className="brand-logo" />
          </div>
          <QuickAddTask />
          <button type="button" className="secondary" onClick={() => setCopyToAIOpen(true)}>
            Copy to AI
          </button>
        </header>

        <main className="main-content">
          <CloudSyncBanner />
          <Outlet />
        </main>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={location.pathname === item.to ? 'mobile-nav-link active' : 'mobile-nav-link'}
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <PasswordRecoveryDialog />
      {copyToAIOpen && <CopyToAIDialog onClose={() => setCopyToAIOpen(false)} />}
    </div>
  );
}
