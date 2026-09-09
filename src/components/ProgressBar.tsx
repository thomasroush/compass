interface ProgressBarProps {
  /** 0-100, or `null` for a Goal/Target with nothing to measure yet. */
  progress: number | null;
  label?: string;
}

/**
 * The one shared progress-display primitive for Goals/Targets — no such
 * component existed before this feature. Plain divs, no library, matching
 * the rest of this app's minimalist CSS style.
 */
export function ProgressBar({ progress, label = 'Progress' }: ProgressBarProps) {
  if (progress === null) {
    return <p className="meta-text progress-empty">No targets yet</p>;
  }

  const rounded = Math.round(progress);

  return (
    <div className="progress-bar-wrap">
      <div
        className="progress-bar"
        role="progressbar"
        aria-label={label}
        aria-valuenow={rounded}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="progress-bar-fill" style={{ width: `${rounded}%` }} />
      </div>
      <span className="progress-bar-label">{rounded}%</span>
    </div>
  );
}
