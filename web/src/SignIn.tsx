import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { KeyRound } from 'lucide-react';
import { api, type AuthInfo } from './api.ts';

// Where to go after signing in (the MCP consent page and deep links send ?next=); paths on this site only.
const nextPath = () => {
  const n = new URLSearchParams(location.search).get('next');
  return n && /^\/(?!\/)/.test(n) ? n : location.pathname.startsWith('/login') || location.pathname.startsWith('/invite') ? '/' : location.pathname + location.search;
};
const go = () => location.assign(nextPath());

function Card({ children }: { children: ReactNode }) {
  return (
    <main className="login">
      <div className="login-card">
        <img className="logo-mark big" src="/favicon.svg" alt="" />
        <h1>pragmatic</h1>
        {children}
      </div>
    </main>
  );
}

// Every sign-in mode the server has on (AUTH): the first admin on a new install, passwords, single sign-on, Google.
export function SignIn({ auth }: { auth: AuthInfo }) {
  const [email, setEmail] = useState(''), [name, setName] = useState(''), [password, setPassword] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const next = encodeURIComponent(nextPath());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    (auth.setup ? api.setup({ email, name, password }) : api.login({ email, password })).then(go, (err) => { setError(err.message); setBusy(false); });
  };
  const password_ = auth.modes.includes('password');
  return (
    <Card>
      <p className="muted">{auth.setup ? 'Create the first account. It becomes the admin, who invites everyone else.' : 'Diagrams, flowcharts and mind maps for the team.'}</p>
      {auth.modes.includes('oidc') && <a className="btn primary wide" href={`/auth/oidc?next=${next}`}><KeyRound size={16} /> Continue with {auth.oidc}</a>}
      {auth.modes.includes('google') && <a className={`btn ${auth.modes.includes('oidc') ? 'ghost' : 'primary'} wide`} href={`/auth/google?next=${next}`}><GoogleIcon /> Continue with Google</a>}
      {password_ && (
        <form className="login-form" onSubmit={submit}>
          {(auth.modes.includes('oidc') || auth.modes.includes('google')) && <div className="login-or"><span>or</span></div>}
          <input type="email" autoComplete="email" required placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          {auth.setup && <input autoComplete="name" placeholder="Your name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
          <input type="password" autoComplete={auth.setup ? 'new-password' : 'current-password'} required minLength={auth.setup ? 10 : undefined}
            placeholder={auth.setup ? 'Password (10 characters or more)' : 'Password'} aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button className="btn primary wide" disabled={busy}>{auth.setup ? 'Create admin account' : 'Sign in'}</button>
          {!auth.setup && <p className="muted small">No account, or forgot the password? Ask an admin for an invite link.</p>}
        </form>
      )}
      {error && <p className="error">{error}</p>}
      {auth.dev && <a className="btn ghost wide" href={`/auth/dev?next=${next}`}>Local dev login</a>}
    </Card>
  );
}

// /invite/<token>: set a name and password (a new account), or a new password (a reset an admin sent).
export function InvitePage({ token }: { token: string }) {
  const [info, setInfo] = useState<{ email: string; name: string; reset: boolean } | null>(null);
  const [name, setName] = useState(''), [password, setPassword] = useState(''), [again, setAgain] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  useEffect(() => { api.invite(token).then((i) => { setInfo(i); setName(i.name); }, (e) => setError(e.message)); }, [token]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (password !== again) return setError('The two passwords are not the same');
    setBusy(true);
    api.acceptInvite(token, { name, password }).then(() => location.assign('/'), (err) => { setError(err.message); setBusy(false); });
  };
  return (
    <Card>
      {info ? (
        <form className="login-form" onSubmit={submit}>
          <p className="muted">{info.reset ? 'Set a new password for' : 'Set up your account for'} <strong>{info.email}</strong>.</p>
          {!info.reset && <input autoComplete="name" required placeholder="Your name" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} />}
          <input type="password" autoComplete="new-password" required minLength={10} placeholder="Password (10 characters or more)" aria-label="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <input type="password" autoComplete="new-password" required placeholder="Password again" aria-label="Password again" value={again} onChange={(e) => setAgain(e.target.value)} />
          <button className="btn primary wide" disabled={busy}>{info.reset ? 'Set password' : 'Create account'}</button>
        </form>
      ) : !error && <div className="spinner" />}
      {error && <p className="error">{error}</p>}
    </Card>
  );
}

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>
);
