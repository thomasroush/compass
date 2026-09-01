/** Shown only while the initial Supabase session check is in flight, before it is known whether anyone is signed in. */
export function LoadingScreen() {
  return (
    <div className="auth-gate">
      <div className="auth-gate-panel">
        <div className="brand">Daily Compass</div>
        <p>Loading…</p>
      </div>
    </div>
  );
}
