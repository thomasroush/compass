import { AccountPanel } from './AccountPanel';

/**
 * The login gate (Part 2 of the cross-device sync work): shown instead of
 * the application whenever Supabase is configured and nobody is signed in.
 * Reuses `AccountPanel` unchanged for the actual sign-in/sign-up/forgot-
 * password forms and their existing tested behavior — this component only
 * provides the full-page, signed-out-only shell around it. No projects,
 * tasks, notes, navigation, or other local data is rendered here.
 */
export function LoginScreen() {
  return (
    <div className="auth-gate">
      <div className="auth-gate-panel">
        <div className="brand">Daily Compass</div>
        <AccountPanel />
      </div>
    </div>
  );
}
