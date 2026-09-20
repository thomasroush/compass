import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BoardIcon, CalendarIcon, MoreIcon, ProjectsIcon, TasksIcon } from './navIcons';

interface NavDestination {
  to: string;
  label: string;
}

const PRIMARY_ITEMS: (NavDestination & { icon: ReactNode })[] = [
  { to: '/board', label: 'Board', icon: <BoardIcon /> },
  { to: '/tasks', label: 'Tasks', icon: <TasksIcon /> },
  { to: '/calendar', label: 'Calendar', icon: <CalendarIcon /> },
  { to: '/projects', label: 'Projects', icon: <ProjectsIcon /> },
];

// Every destination that has no slot in the bottom bar. Together with
// PRIMARY_ITEMS this covers every route in AppShell's desktop sidebar.
const MORE_ITEMS: NavDestination[] = [
  { to: '/', label: 'Today' },
  { to: '/goals', label: 'Goals' },
  { to: '/about', label: 'About' },
  { to: '/settings', label: 'Settings' },
];

function isActive(pathname: string, to: string) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Bottom navigation for mobile widths (shown/hidden purely by CSS at the
 * app's 768px breakpoint; the desktop sidebar is untouched).
 *
 * The More menu records the pathname it was opened on rather than a plain
 * boolean, so any route change closes it without an effect.
 */
export function MobileNav() {
  const { pathname } = useLocation();
  const [openOnPath, setOpenOnPath] = useState<string | null>(null);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuOpen = openOnPath === pathname;
  const moreActive = MORE_ITEMS.some((item) => isActive(pathname, item.to));

  useEffect(() => {
    if (!menuOpen) return;

    function onPointerDown(event: Event) {
      if (!moreRef.current?.contains(event.target as Node)) setOpenOnPath(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpenOnPath(null);
      moreButtonRef.current?.focus();
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <nav className="mobile-nav" aria-label="Mobile navigation">
      {PRIMARY_ITEMS.map((item) => {
        const active = isActive(pathname, item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            className={active ? 'mobile-nav-link active' : 'mobile-nav-link'}
            aria-current={active ? 'page' : undefined}
          >
            {item.icon}
            <span>{item.label}</span>
          </Link>
        );
      })}

      <div className="mobile-more" ref={moreRef}>
        <button
          ref={moreButtonRef}
          type="button"
          className={moreActive ? 'mobile-nav-link active' : 'mobile-nav-link'}
          aria-expanded={menuOpen}
          aria-controls="mobile-more-menu"
          onClick={() => setOpenOnPath(menuOpen ? null : pathname)}
        >
          <MoreIcon />
          <span>More</span>
        </button>

        {menuOpen && (
          <ul id="mobile-more-menu" className="mobile-more-menu" aria-label="More destinations">
            {MORE_ITEMS.map((item) => {
              const active = isActive(pathname, item.to);
              return (
                <li key={item.to}>
                  <Link
                    to={item.to}
                    className={active ? 'mobile-more-link active' : 'mobile-more-link'}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setOpenOnPath(null)}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </nav>
  );
}
