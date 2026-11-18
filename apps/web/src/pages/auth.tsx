import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../supabase';
import { useApp } from '../context';

const LoginSide = () => (
  <aside className="login-side" aria-label="CGBS Sales Command Center">
    <img className="login-banner-image" src="/assets/cgbs-sales-login-banner.png" alt="Canopus GBS Sales Command Center: track leads, log calls, manage follow-ups, and view reports." />
  </aside>
);

export function SignInPage({ initialError = '' }: { initialError?: string }) {
  const navigate = useNavigate();
  const { refresh, toast } = useApp();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [loading, setLoading] = useState(false);

  if (!supabase) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" />
          <span className="eyebrow">CGBS SALES</span>
          <h1>Authentication not configured.</h1>
          <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable sign in.</p>
        </section>
        <LoginSide />
      </main>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { data, error: signInError } = await supabase!.auth.signInWithPassword({ email, password });
      if (signInError) throw new Error(signInError.message);
      if (!data.session?.access_token || !data.user) throw new Error('Supabase did not return a valid sign-in session. Please try again.');
      const identity = await refresh();
      if (!identity) throw new Error('Your sign-in could not be validated by the CRM API. Please try again.');
      toast('Signed in successfully.');
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <section className="login-card">
        <img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" />
        <span className="eyebrow">CGBS SALES</span>
        <h1>Good work starts with a clear next step.</h1>
        <p>Keep your leads, calls and pipeline moving from one calm workspace.</p>
        <form onSubmit={(e) => void handleSubmit(e)} style={{ width: '100%' }}>
          <div className="modal-form" style={{ marginBottom: 16 }}>
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                placeholder="you@example.com"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                placeholder="••••••••"
              />
            </label>
          </div>
          {error && <div className="inline-error" style={{ marginBottom: 12 }}>{error}</div>}
          <button
            type="submit"
            className="button button-primary button-wide"
            disabled={loading}
          >
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <small style={{ marginTop: 14, textAlign: 'center', width: '100%' }}>
          <a href="/forgot-password" style={{ color: '#6b8237' }}>Forgot password?</a>
          {'  ·  '}
          <a href="/signup" style={{ color: '#6b8237' }}>Don't have an account? Sign up</a>
        </small>
      </section>
      <LoginSide />
    </main>
  );
}

export function SignUpPage() {
  const navigate = useNavigate();
  const { refresh, toast } = useApp();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (!supabase) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" />
          <span className="eyebrow">CGBS SALES</span>
          <h1>Authentication not configured.</h1>
          <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to enable sign up.</p>
        </section>
        <LoginSide />
      </main>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase!.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (signUpError) throw new Error(signUpError.message);
      if (data.session) {
        if (!data.session.access_token || !data.user) throw new Error('Supabase returned an incomplete registration session. Please sign in again.');
        const identity = await refresh();
        if (!identity) throw new Error('Your new account could not be validated by the CRM API. Please try signing in.');
        toast('Account created successfully. You are now signed in.');
        navigate('/', { replace: true });
      } else {
        setError('Supabase did not issue a session. Disable Confirm email in the Supabase Authentication settings to enable direct sign-up.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <section className="login-card">
        <img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" />
        <span className="eyebrow">CGBS SALES</span>
        <h1>Create your account.</h1>
        <p>Create your CGBS Sales account. New accounts start with the Sales Executive role.</p>
        <form onSubmit={(e) => void handleSubmit(e)} style={{ width: '100%' }}>
            <div className="modal-form" style={{ marginBottom: 16 }}>
              <label>
                Full name
                <input
                  type="text"
                  autoComplete="name"
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  required
                  placeholder="Your full name"
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                />
              </label>
              <label>
                Confirm password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  placeholder="••••••••"
                />
              </label>
            </div>
            {error && <div className="inline-error" style={{ marginBottom: 12 }}>{error}</div>}
            <button
              type="submit"
              className="button button-primary button-wide"
              disabled={loading}
            >
              {loading ? 'Creating account…' : 'Create account'}
            </button>
        </form>
        <small style={{ marginTop: 14, textAlign: 'center', width: '100%' }}>
          Already have an account?{' '}
          <a href="/" style={{ color: '#6b8237' }}>Sign in</a>
        </small>
      </section>
      <LoginSide />
    </main>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  if (!supabase) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" />
          <span className="eyebrow">CGBS SALES</span>
          <h1>Authentication not configured.</h1>
          <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use password reset.</p>
        </section>
        <LoginSide />
      </main>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const { error: resetError } = await supabase!.auth.resetPasswordForEmail(email, {
        redirectTo: window.location.origin + '/reset-password',
      });
      if (resetError) throw new Error(resetError.message);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset request failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <section className="login-card">
        <img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" />
        <span className="eyebrow">CGBS SALES</span>
        <h1>Reset your password.</h1>
        <p>Enter your email and we'll send a reset link if an account exists.</p>
        {sent ? (
          <div className="inline-error" style={{ background: '#edf5da', borderColor: '#d4e9b6', color: '#4a6b2c' }}>
            If that email exists, a reset link has been sent.
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} style={{ width: '100%' }}>
            <div className="modal-form" style={{ marginBottom: 16 }}>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  placeholder="you@example.com"
                />
              </label>
            </div>
            {error && <div className="inline-error" style={{ marginBottom: 12 }}>{error}</div>}
            <button
              type="submit"
              className="button button-primary button-wide"
              disabled={loading}
            >
              {loading ? 'Sending…' : 'Send reset link'}
            </button>
          </form>
        )}
        <small style={{ marginTop: 14, textAlign: 'center', width: '100%' }}>
          <a href="/" style={{ color: '#6b8237' }}>Back to sign in</a>
        </small>
      </section>
      <LoginSide />
    </main>
  );
}

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Supabase auto-picks the token from URL hash on getSession()
    void supabase?.auth.getSession().then(() => setSessionReady(true));
  }, []);

  if (!supabase) {
    return (
      <main className="login-screen">
        <section className="login-card">
          <img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" />
          <span className="eyebrow">CGBS SALES</span>
          <h1>Authentication not configured.</h1>
          <p>Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to use password reset.</p>
        </section>
        <LoginSide />
      </main>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (newPassword !== confirm) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { error: updateError } = await supabase!.auth.updateUser({ password: newPassword });
      if (updateError) throw new Error(updateError.message);
      navigate('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password update failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="login-screen">
      <section className="login-card">
        <img className="login-brand-logo" src="/assets/canopus-global-business-services-g.png" alt="Canopus Global Business Services G logo" />
        <span className="eyebrow">CGBS SALES</span>
        <h1>Set a new password.</h1>
        <p>Choose a strong password for your CGBS Sales account.</p>
        {!sessionReady ? (
          <div className="loading-screen" style={{ minHeight: 'unset', padding: '16px 0' }}>
            <span className="spinner" /> Verifying reset link…
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} style={{ width: '100%' }}>
            <div className="modal-form" style={{ marginBottom: 16 }}>
              <label>
                New password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  required
                  placeholder="••••••••"
                />
              </label>
              <label>
                Confirm new password
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required
                  placeholder="••••••••"
                />
              </label>
            </div>
            {error && <div className="inline-error" style={{ marginBottom: 12 }}>{error}</div>}
            <button
              type="submit"
              className="button button-primary button-wide"
              disabled={loading}
            >
              {loading ? 'Updating…' : 'Set new password'}
            </button>
          </form>
        )}
      </section>
      <LoginSide />
    </main>
  );
}
