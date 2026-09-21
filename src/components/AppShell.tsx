import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { CloudSyncBanner } from './CloudSyncBanner';
import { CopyToAIDialog } from './CopyToAIDialog';
import { MobileNav } from './MobileNav';
import {
  AboutIcon,
  BoardIcon,
  CalendarIcon,
  GoalsIcon,
  ProjectsIcon,
  SettingsIcon,
  TasksIcon,
  TodayIcon,
} from './navIcons';
import { PasswordRecoveryDialog } from './PasswordRecoveryDialog';
import { QuickAddTask } from './QuickAddTask';
import { QuickNoteDialog } from './QuickNoteDialog';

const NAV_ITEMS = [
  { to: '/', label: 'Today', icon: <TodayIcon /> },
  { to: '/board', label: 'Board', icon: <BoardIcon /> },
  { to: '/tasks', label: 'Tasks', icon: <TasksIcon /> },
  { to: '/projects', label: 'Projects', icon: <ProjectsIcon /> },
  { to: '/goals', label: 'Goals', icon: <GoalsIcon /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarIcon /> },
  { to: '/about', label: 'About', icon: <AboutIcon /> },
  { to: '/settings', label: 'Settings', icon: <SettingsIcon /> },
];

export function AppShell() {
  const location = useLocation();
  const [copyToAIOpen, setCopyToAIOpen] = useState(false);
  const [quickNoteOpen, setQuickNoteOpen] = useState(false);

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Main navigation">
        <div className="brand">
          <img src="/gsd-logo-128.png" alt="GSD" className="brand-logo" />
        </div>
        <nav className="sidebar-nav">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={location.pathname === item.to ? 'nav-link active' : 'nav-link'}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </nav>
      </aside>

      <div className="main-column">
        <header className="top-bar">
          <div className="brand mobile-brand">
            <img src="/gsd-logo-128.png" alt="GSD" className="brand-logo" />
          </div>
          <QuickAddTask />
          <button type="button" className="secondary" onClick={() => setQuickNoteOpen(true)}>
            Quick Note
          </button>
          <button type="button" className="secondary" onClick={() => setCopyToAIOpen(true)}>
            Copy to AI
          </button>
        </header>

        <main className="main-content">
          <CloudSyncBanner />
          <Outlet />
        </main>

        <MobileNav />
      </div>

      <PasswordRecoveryDialog />
      {copyToAIOpen && <CopyToAIDialog onClose={() => setCopyToAIOpen(false)} />}
      {quickNoteOpen && <QuickNoteDialog onClose={() => setQuickNoteOpen(false)} />}
    </div>
  );
}
