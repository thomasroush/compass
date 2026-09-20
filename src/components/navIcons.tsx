import type { ReactNode } from 'react';

/**
 * Outline icons shared by the desktop sidebar and the mobile bottom bar, so
 * a destination looks the same in both. All are decorative (`aria-hidden`) —
 * every nav item always renders a visible text label beside its icon.
 * Size comes from CSS (`.nav-icon`); the 24px attributes are the fallback.
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      className="nav-icon"
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

export function TodayIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2" />
      <path d="M12 19v2" />
      <path d="M3 12h2" />
      <path d="M19 12h2" />
      <path d="M5.64 5.64l1.41 1.41" />
      <path d="M16.95 16.95l1.41 1.41" />
      <path d="M5.64 18.36l1.41-1.41" />
      <path d="M16.95 7.05l1.41-1.41" />
    </Icon>
  );
}

export function BoardIcon() {
  return (
    <Icon>
      <rect x="3.5" y="4" width="4.5" height="16" rx="1" />
      <rect x="9.75" y="4" width="4.5" height="10" rx="1" />
      <rect x="16" y="4" width="4.5" height="13" rx="1" />
    </Icon>
  );
}

export function TasksIcon() {
  return (
    <Icon>
      <path d="M4 7l1.5 1.5L8 6" />
      <path d="M4 15.5L5.5 17 8 14.5" />
      <path d="M12 7.25h8" />
      <path d="M12 15.75h8" />
    </Icon>
  );
}

export function ProjectsIcon() {
  return (
    <Icon>
      <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h4.2l2 2.25H19A1.5 1.5 0 0 1 20.5 9.75V17.5A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z" />
    </Icon>
  );
}

export function GoalsIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </Icon>
  );
}

export function CalendarIcon() {
  return (
    <Icon>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
      <path d="M3.5 10h17" />
      <path d="M8 3v4" />
      <path d="M16 3v4" />
    </Icon>
  );
}

export function AboutIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5" />
      <path d="M12 7.75h.01" />
    </Icon>
  );
}

export function SettingsIcon() {
  return (
    <Icon>
      <path d="M4 7h9" />
      <path d="M17 7h3" />
      <circle cx="15" cy="7" r="2" />
      <path d="M4 17h3" />
      <path d="M11 17h9" />
      <circle cx="9" cy="17" r="2" />
    </Icon>
  );
}

export function MoreIcon() {
  return (
    <Icon>
      <circle cx="5.5" cy="12" r="1.25" fill="currentColor" />
      <circle cx="12" cy="12" r="1.25" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.25" fill="currentColor" />
    </Icon>
  );
}
