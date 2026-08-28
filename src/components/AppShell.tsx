import { Link, Outlet, useLocation } from 'react-router-dom';
import { QuickAddTask } from './QuickAddTask';

const NAV_ITEMS = [
  { to: '/', label: 'Today' },
  { to: '/board', label: 'Board' },
  { to: '/tasks', label: 'Tasks' },
  { to: '/projects', label: 'Projects' },
  { to: '/notes', label: 'Daily Notes' },
  { to: '/settings', label: 'Settings' },
];

export function AppShell() {
  const location = useLocation();

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">Daily Compass</div>
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
          <div className="brand mobile-brand">Daily Compass</div>
          <QuickAddTask />
        </header>

        <main className="main-content">
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
    </div>
  );
}
