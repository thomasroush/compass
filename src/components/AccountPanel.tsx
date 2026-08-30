import { FormEvent, useState } from 'react';
import { useAuth } from '../store/useAuth';

type Mode = 'signIn' | 'signUp' | 'forgot';

const MODE_COPY: Record<Mode, { heading: string; submit: string }> = {
  signIn: { heading: 'Sign in', submit: 'Sign in' },
  signUp: { heading: 'Create an account', submit: 'Create account' },
  forgot: { heading: 'Reset your password', submit: 'Send reset link' },
};

export function AccountPanel() {
  const auth = useAuth();
  const [mode, setMode] = useState<Mode>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  function switchMode(next: Mode) {
    setError('');
    setSuccess('');
    setPassword('');
    setMode(next);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSubmitting(true);
    const result =
      mode === 'signIn'
        ? await auth.signIn(email, password)
        : mode === 'signUp'
          ? await auth.signUp(email, password)
          : await auth.requestPasswordReset(email);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSuccess(result.message);
    setPassword('');
  }

  async function handleSignOut() {
    setError('');
    setSuccess('');
    const result = await auth.signOut();
    if (!result.ok) setError(result.message);
  }

  if (!auth.isSupabaseConfigured) {
    return (
      <section className="section settings-section">
        <h2>Account</h2>
        <p>
          Cloud account access is unavailable because this app is not connected to Supabase.
          Daily Compass continues to work fully in this browser using local storage.
        </p>
      </section>
    );
  }

  if (auth.status === 'loading') {
    return (
      <section className="section settings-section">
        <h2>Account</h2>
        <p>Checking your session…</p>
      </section>
    );
  }

  if (auth.user) {
    return (
      <section className="section settings-section">
        <h2>Account</h2>
        <p>
          Signed in as <strong>{auth.user.email}</strong>.
        </p>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        <button type="button" className="secondary" onClick={handleSignOut}>
          Sign out
        </button>
      </section>
    );
  }

  return (
    <section className="section settings-section">
      <h2>{MODE_COPY[mode].heading}</h2>
      <p className="section-help">
        Signing in is optional. Daily Compass works fully offline in this browser without an
        account.
      </p>

      {success && (
        <p className="message" role="status">
          {success}
        </p>
      )}
      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}

      <form className="stack-form" onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="account-email">Email</label>
          <input
            id="account-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            required
          />
        </div>
        {mode !== 'forgot' && (
          <div className="field">
            <label htmlFor="account-password">Password</label>
            <input
              id="account-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
              minLength={mode === 'signUp' ? 6 : undefined}
              required
            />
          </div>
        )}
        <div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Please wait…' : MODE_COPY[mode].submit}
          </button>
        </div>
      </form>

      <div className="settings-actions">
        {mode !== 'signIn' && (
          <button type="button" className="secondary" onClick={() => switchMode('signIn')}>
            Back to sign in
          </button>
        )}
        {mode !== 'signUp' && (
          <button type="button" className="secondary" onClick={() => switchMode('signUp')}>
            Create an account
          </button>
        )}
        {mode !== 'forgot' && (
          <button type="button" className="secondary" onClick={() => switchMode('forgot')}>
            Forgot password?
          </button>
        )}
      </div>
    </section>
  );
}
