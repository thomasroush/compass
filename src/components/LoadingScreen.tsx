/** Shown only while the initial Supabase session check is in flight, before it is known whether anyone is signed in. */
export function LoadingScreen() {
  return (
    <div className="auth-gate">
      <div className="auth-gate-panel">
        <div className="brand">
          <img src="/gsd-logo-128.png" alt="GSD" className="brand-logo" />
        </div>
        <p>Loading…</p>
      </div>
    </div>
  );
}
