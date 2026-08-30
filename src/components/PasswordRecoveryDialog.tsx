import { FormEvent, useState } from 'react';
import { useAuth } from '../store/useAuth';

export function PasswordRecoveryDialog() {
  const { isPasswordRecovery, updatePassword, cancelPasswordRecovery } = useAuth();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!isPasswordRecovery) return null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    const result = await updatePassword(password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSuccess(result.message);
    setPassword('');
    setConfirm('');
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="recovery-title">
        <h2 id="recovery-title">Set a new password</h2>
        {success ? (
          <>
            <p className="message" role="status">
              {success}
            </p>
            <div className="dialog-actions">
              <button type="button" onClick={cancelPasswordRecovery}>
                Continue
              </button>
            </div>
          </>
        ) : (
          <form className="stack-form" onSubmit={handleSubmit}>
            <p>Enter a new password for your account to finish resetting it.</p>
            {error && (
              <p className="message error" role="alert">
                {error}
              </p>
            )}
            <div className="field">
              <label htmlFor="recovery-password">New password</label>
              <input
                id="recovery-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="recovery-password-confirm">Confirm new password</label>
              <input
                id="recovery-password-confirm"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
            <div className="dialog-actions">
              <button type="button" className="secondary" onClick={cancelPasswordRecovery}>
                Cancel
              </button>
              <button type="submit" disabled={submitting}>
                {submitting ? 'Saving…' : 'Set password'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
