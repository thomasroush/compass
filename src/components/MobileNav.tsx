import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';

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

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="mobile-nav-icon"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function BoardIcon() {
  return (
    <Icon>
      <rect x="3.5" y="4" width="4.5" height="16" rx="1" />
      <rect x="9.75" y="4" width="4.5" height="10" rx="1" />
      <rect x="16" y="4" width="4.5" height="13" rx="1" />
    </Icon>
  );
}

function TasksIcon() {
  return (
    <Icon>
      <path d="M4 7l1.5 1.5L8 6" />
      <path d="M4 15.5L5.5 17 8 14.5" />
      <path d="M12 7.25h8" />
      <path d="M12 15.75h8" />
    </Icon>
  );
}

function CalendarIcon() {
  return (
    <Icon>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </Icon>
  );
}

function ProjectsIcon() {
  return (
    <Icon>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2.25H19A1.5 1.5 0 0 1 20.5 9.75V17.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
    </Icon>
  );
}

function MoreIcon() {
  return (
    <Icon>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" />
    </Icon>
  );
}
