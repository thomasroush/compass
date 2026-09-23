import { useRef, useState } from 'react';
import { AccountPanel } from './AccountPanel';

type AuthMode = 'signIn' | 'signUp';

/**
 * The public home page (Part 3 of the cross-device sync work): shown at
 * every URL whenever Supabase is configured and nobody is signed in — see
 * `AuthGate` in `App.tsx`. Replaces the old bare `LoginScreen` with an actual
 * marketing home page, while still routing straight into `AccountPanel`
 * (unchanged) for the real sign-in/sign-up/forgot-password behavior. No
 * projects, tasks, notes, navigation, or other local data is rendered here.
 */
export function LandingPage() {
  const [authMode, setAuthMode] = useState<AuthMode>('signIn');
  const authSectionRef = useRef<HTMLDivElement>(null);

  function openAuth(mode: AuthMode) {
    setAuthMode(mode);
    if (typeof authSectionRef.current?.scrollIntoView === 'function') {
      authSectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  return (
    <div className="landing">
      <header className="landing-header">
        <img src="/gsd-logo-128.png" alt="GSD" className="brand-logo" />
        <div className="landing-header-actions">
          <button type="button" className="secondary" onClick={() => openAuth('signIn')}>
            Log in
          </button>
          <button type="button" onClick={() => openAuth('signUp')}>
            Create account
          </button>
        </div>
      </header>

      <main className="landing-main">
        <section className="landing-hero">
          <h1>GSD (Get S$$T Done)</h1>
          <p className="landing-lead">
            GSD brings your goals, projects, tasks, and daily work into one clear place. Decide
            what matters, see what needs attention today, and keep moving. It&rsquo;s your map for
            what comes next&mdash;and a place to turn plans into wins.
          </p>
          <div className="landing-cta">
            <button type="button" onClick={() => openAuth('signUp')}>
              Create account
            </button>
            <button type="button" className="secondary" onClick={() => openAuth('signIn')}>
              Log in
            </button>
          </div>
        </section>

        <section className="section landing-features">
          <p>
            <strong>Goals</strong> give you direction. <strong>Targets</strong> show your
            progress. <strong>Projects</strong> organize the work. <strong>Tasks</strong> move it
            forward. Capture what&rsquo;s on your mind in <strong>Quick Notes</strong>, keep
            important dates on your <strong>Calendar</strong>, and export your work to AI when you
            want a fresh perspective.
          </p>
          <p>
            Start with what&rsquo;s in front of you. Add structure as you need it. Start today,
            get s$$t done, and build momentum toward the life you want.
          </p>
        </section>

        <section
          className="landing-auth"
          ref={authSectionRef}
          aria-label="Sign in or create an account"
        >
          <AccountPanel key={authMode} initialMode={authMode} />
        </section>
      </main>
    </div>
  );
}
