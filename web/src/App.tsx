import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import { copyText } from './clipboard.ts';
import { Inbox as InboxIcon } from 'lucide-react';
import { InboxPage } from './InboxPage.tsx';
import { api, ago, itemPath, meOnce, navigate, type Item, type Me, type PersonRow, type Token, type User } from './api.ts';
import { InvitePage, SignIn } from './SignIn.tsx';
import { useLocalMode, useMe } from './useMe.ts';
import { TemplateGallery } from './TemplateGallery.tsx';
// The board engine loads only when a board opens.
const Board = lazy(() => import('./BoardPage.tsx').then((m) => ({ default: m.Board })));
const Doc = lazy(() => import('./DocPage.tsx').then((m) => ({ default: m.Doc })));

const useTheme = () => {
  const q = matchMedia('(prefers-color-scheme: dark)');
  const [dark, setDark] = useState(q.matches);
  useEffect(() => {
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    q.addEventListener('change', on);
    return () => q.removeEventListener('change', on);
  }, []);
  return dark ? 'dark' : 'light';
};

const usePath = () => {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener('popstate', on);
    return () => removeEventListener('popstate', on);
  }, []);
  return path;
};

const Link = ({ to, className, children }: { to: string; className?: string; children: ReactNode }) => (
  <a href={to} className={className} onClick={(e) => { if (e.metaKey || e.ctrlKey) return; e.preventDefault(); navigate(to); }}>{children}</a>
);

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { meOnce().then(setMe); }, []);
  if (!me) return null;
  const invite = location.pathname.match(/^\/invite\/([\w-]+)/)?.[1];
  if (invite) return <InvitePage token={invite} />;
  if (!me.user) return <SignIn auth={me.auth} />;
  if (location.pathname === '/login') { navigate(new URLSearchParams(location.search).get('next') ?? '/'); return null; }
  return <Shell user={me.user} />;
}

function Shell({ user }: { user: User }) {
  const path = usePath();
  const theme = useTheme();
  const [items, setItems] = useState<Item[]>([]);
  const [current, setCurrent] = useState<Item | null>(null);
  const refresh = useCallback(() => api.items().then(setItems), []);
  // Unread inbox count: on start, on every page change, and every 30 seconds.
  const [unread, setUnread] = useState(0);
  const countUnread = useCallback(() => api.inbox().then((l) => {
    const n = l.filter((x) => !x.read_at).length;
    setUnread((old) => { if (n > old) refresh(); return n; }); // a new share may add a board to the sidebar
  }, () => {}), [refresh]);
  useEffect(() => { countUnread(); const t = setInterval(countUnread, 30_000); return () => clearInterval(t); }, [countUnread]);
  useEffect(() => { countUnread(); }, [path]);
  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const boardId = path.match(/^\/b\/([\w-]+)/)?.[1], docId = path.match(/^\/d\/([\w-]+)/)?.[1];
  useEffect(() => { if (!boardId && !docId) setCurrent(null); }, [boardId, docId]);
  useEffect(() => { document.title = current ? `${current.title} · pragmatic` : 'pragmatic'; }, [current]);

  const create = async (kind: Item['kind'], scope: Item['scope'], parent_id: string | null = null, template?: { id: string; title: string }) => {
    const item = await api.create({ kind, title: template?.title ?? (kind === 'board' ? 'Untitled board' : kind === 'doc' ? 'Untitled doc' : 'New folder'), scope, parent_id, template: template?.id });
    await refresh();
    if (kind !== 'folder') navigate(itemPath(item));
    return item;
  };

  return (
    <div className="shell">
      <Sidebar user={user} items={items} activeId={boardId ?? docId} path={path} unread={unread} onCreate={create} onChanged={refresh} />
      <main className="main">
        {docId ? (
          <Suspense fallback={<div className="empty"><div className="spinner" /></div>}>
            <Doc key={docId} id={docId} theme={theme} user={user} item={current} onItem={setCurrent}
              header={<TitleBar item={current} items={items} onRenamed={(i) => { setCurrent(i); refresh(); }} />} />
          </Suspense>
        ) : boardId ? (
          <Suspense fallback={<div className="empty"><div className="spinner" /></div>}>
            <Board key={boardId} id={boardId} theme={theme} user={user} onItem={setCurrent}
              header={<TitleBar item={current} items={items} onRenamed={(i) => { setCurrent(i); refresh(); }} />} />
          </Suspense>
        ) : path === '/trash' ? <Trash onChanged={refresh} />
          : path === '/settings' ? <Settings user={user} />
          : path === '/inbox' ? <InboxPage me={user} onRead={countUnread} />
          : <Recent onCreate={() => create('board', 'private')} />}
      </main>
    </div>
  );
}

function TitleBar({ item, items, onRenamed }: { item: Item | null; items: Item[]; onRenamed: (i: Item) => void }) {
  const [title, setTitle] = useState('');
  useEffect(() => setTitle(item?.title ?? ''), [item]);
  if (!item) return null;
  const trail: Item[] = [];
  for (let p = items.find((i) => i.id === item.parent_id); p; p = items.find((i) => i.id === p!.parent_id)) trail.unshift(p);
  const commit = async () => {
    const t = title.trim();
    if (!t || t === item.title) return setTitle(item.title);
    onRenamed(await api.update(item.id, { title: t }));
  };
  return (
    <div className="crumbs">
      <span className="crumb">{item.scope === 'team' ? 'Team' : 'Private'}</span>
      {trail.map((f) => <span key={f.id} className="crumb">{f.title}</span>)}
      <input className="title-input" value={title} aria-label="Board title" onChange={(e) => setTitle(e.target.value)}
        onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
    </div>
  );
}

type CreateFn = (kind: Item['kind'], scope: Item['scope'], parent?: string | null, template?: { id: string; title: string }) => Promise<Item>;

function Sidebar({ user, items, activeId, path, unread, onCreate, onChanged }: {
  user: User; items: Item[]; activeId?: string; path: string; unread: number; onCreate: CreateFn; onChanged: () => void;
}) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Item[] | null>(null);
  useEffect(() => {
    if (!q.trim()) return setResults(null);
    const t = setTimeout(() => api.search(q).then(setResults), 200);
    return () => clearTimeout(t);
  }, [q]);

  // Others' private boards shared with me sit in their own section; their folders are not mine to see.
  const shared = items.filter((i) => i.scope === 'private' && i.owner_id !== user.id);
  const [sharedOpen, setSharedOpen] = useState(true);
  const [starred, setStarred] = useState<Awaited<ReturnType<typeof api.stars>>>([]);
  useEffect(() => {
    const load = () => api.stars().then(setStarred, () => {});
    load();
    addEventListener('pragmatic:stars', load);
    return () => removeEventListener('pragmatic:stars', load);
  }, [items]);
  const own = items.filter((i) => !shared.includes(i));
  const local = useLocalMode();
  return (
    <aside className="sidebar">
      <Link to="/" className="brand">
        <img className="logo-mark" src="/favicon.svg" alt="" />
        <span>pragmatic</span>
      </Link>
      <input className="search" type="search" placeholder="Search boards" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search boards" />
      {results ? (
        <nav className="tree">
          {results.length ? results.map((r) => (
            <Link key={r.id} to={r.kind === 'folder' ? '/' : itemPath(r)} className="row"><BoardIcon kind={r.kind} /><span className="label">{r.title}</span></Link>
          )) : <p className="muted pad">No match</p>}
        </nav>
      ) : (
        <nav className="tree">
          <Link to="/inbox" className={`row ${path === '/inbox' ? 'active' : ''}`}><InboxIcon size={16} className="icon" /><span className="label">Inbox</span>{unread > 0 && <span className="badge" aria-label={`${unread} unread`}>{unread}</span>}</Link>
          <Link to="/" className={`row ${path === '/' ? 'active' : ''}`}><ClockIcon /><span className="label">Recent</span></Link>
          {starred.length > 0 && (
            <div className="section">
              <div className="section-head"><span className="section-toggle">Starred</span></div>
              {starred.map((s) => (
                <Link key={`${s.item_id}:${s.object_id}`} to={s.object_id ? `/b/${s.item_id}?task=${s.object_id}` : itemPath({ id: s.item_id, kind: s.kind })} className={`row ${!s.object_id && activeId === s.item_id ? 'active' : ''}`}>
                  {s.object_id ? <CardIcon /> : <BoardIcon kind={s.kind} />}<span className="label">{s.card_title ?? s.title}</span>
                </Link>
              ))}
            </div>
          )}
          {/* One person (AUTH=local): no team space. */}
          {(local ? ['private'] as const : ['private', 'team'] as const).map((scope) => (
            <Section key={scope} scope={scope} items={own} activeId={activeId} onCreate={onCreate} onChanged={onChanged} />
          ))}
          {shared.length > 0 && (
            <div className="section">
              <div className="section-head"><button className="section-toggle" onClick={() => setSharedOpen(!sharedOpen)} aria-expanded={sharedOpen}><Caret open={sharedOpen} />Shared with me</button></div>
              {sharedOpen && shared.map((i) => <Link key={i.id} to={itemPath(i)} className={`row ${activeId === i.id ? 'active' : ''}`}><BoardIcon kind={i.kind} /><span className="label">{i.title}</span></Link>)}
            </div>
          )}
        </nav>
      )}
      <div className="sidebar-foot">
        <Link to="/trash" className={`row ${path === '/trash' ? 'active' : ''}`}><TrashIcon /><span className="label">Trash</span></Link>
        <Link to="/settings" className={`row ${path === '/settings' ? 'active' : ''}`}><GearIcon /><span className="label">Settings & Claude</span></Link>
        <div className="me">
          {user.picture ? <img src={user.picture} alt="" referrerPolicy="no-referrer" /> : <span className="avatar">{user.name[0]?.toUpperCase()}</span>}
          <span className="label" title={user.email}>{user.name}</span>
          {!local && <button className="icon-btn" title="Sign out" aria-label="Sign out" onClick={async () => { await api.logout(); location.assign('/'); }}><LogoutIcon /></button>}
        </div>
      </div>
    </aside>
  );
}

function Section({ scope, items, activeId, onCreate, onChanged }: {
  scope: Item['scope']; items: Item[]; activeId?: string; onCreate: CreateFn; onChanged: () => void;
}) {
  const [open, setOpen] = useState(true);
  const roots = items.filter((i) => i.scope === scope && !i.parent_id);
  return (
    <div className="section">
      <div className="section-head">
        <button className="section-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Caret open={open} />{scope === 'team' ? 'Team' : 'Private'}
        </button>
        <AddMenu onPick={(k, t) => onCreate(k, scope, null, t)} label={`Add to ${scope}`} />
      </div>
      {open && (roots.length
        ? roots.map((i) => <TreeRow key={i.id} item={i} items={items} depth={0} activeId={activeId} onCreate={onCreate} onChanged={onChanged} />)
        : <p className="muted pad">Nothing here yet</p>)}
    </div>
  );
}

function TreeRow({ item, items, depth, activeId, onCreate, onChanged }: {
  item: Item; items: Item[]; depth: number; activeId?: string; onCreate: CreateFn; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const kids = items.filter((i) => i.parent_id === item.id);
  const rename = async () => {
    const t = prompt('Rename', item.title);
    if (t?.trim()) { await api.update(item.id, { title: t }); onChanged(); }
  };
  const trash = async () => {
    await api.trashItem(item.id);
    onChanged();
    if (activeId === item.id) navigate('/');
  };
  const indent = { paddingLeft: 8 + depth * 14 };
  const actions = (
    <span className="row-actions">
      {item.kind === 'folder' && <AddMenu onPick={async (k, t) => { setOpen(true); await onCreate(k, item.scope, item.id, t); }} label={`Add to ${item.title}`} />}
      <button className="icon-btn" title="Rename" aria-label={`Rename ${item.title}`} onClick={rename}><PencilIcon /></button>
      <button className="icon-btn" title="Move to trash" aria-label={`Move ${item.title} to trash`} onClick={trash}><TrashIcon /></button>
    </span>
  );
  if (item.kind !== 'folder') {
    return (
      <div className={`row ${activeId === item.id ? 'active' : ''}`} style={indent}>
        <Link to={itemPath(item)} className="row-link"><BoardIcon kind={item.kind} /><span className="label">{item.title}</span></Link>
        {actions}
      </div>
    );
  }
  return (
    <>
      <div className="row" style={indent}>
        <button className="row-link" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Caret open={open} /><BoardIcon kind="folder" /><span className="label">{item.title}</span>
        </button>
        {actions}
      </div>
      {open && (kids.length
        ? kids.map((k) => <TreeRow key={k.id} item={k} items={items} depth={depth + 1} activeId={activeId} onCreate={onCreate} onChanged={onChanged} />)
        : <p className="muted pad" style={{ paddingLeft: 30 + depth * 14 }}>Empty folder</p>)}
    </>
  );
}

function AddMenu({ onPick, label }: { onPick: (k: Item['kind'], template?: { id: string; title: string }) => void; label: string }) {
  const [open, setOpen] = useState(false);
  const [gallery, setGallery] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    addEventListener('click', close);
    return () => removeEventListener('click', close);
  }, [open]);
  return (
    <span className="menu-wrap">
      <button className="icon-btn" title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); setOpen(!open); }}>+</button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={() => onPick('board')}>New board</button>
          <button role="menuitem" onClick={() => onPick('doc')}>New doc</button>
          <button role="menuitem" onClick={() => setGallery(true)}>From template…</button>
          <button role="menuitem" onClick={() => onPick('folder')}>New folder</button>
        </div>
      )}
      {gallery && <TemplateGallery title="New board from a template" onClose={() => setGallery(false)} onPick={(t) => { setGallery(false); onPick('board', t); }} />}
    </span>
  );
}

function Recent({ onCreate }: { onCreate: () => void }) {
  const [boards, setBoards] = useState<Item[] | null>(null);
  useEffect(() => { api.recent().then(setBoards); }, []);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Recent</h1>
        <button className="btn primary" onClick={onCreate}>New board</button>
      </header>
      {boards && !boards.length && <p className="muted">No boards yet. Create one, or ask Claude to draw one for you.</p>}
      <div className="cards">
        {boards?.map((b) => (
          <Link key={b.id} to={itemPath(b)} className="card">
            <div className="card-thumb">{b.thumbnail ? <img src={b.thumbnail} alt="" /> : <BoardIcon kind={b.kind} />}</div>
            <div className="card-title">{b.title}</div>
            <div className="card-meta">{b.scope === 'team' ? 'Team' : 'Private'} · {ago(b.updated_at)}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Trash({ onChanged }: { onChanged: () => void }) {
  const [items, setItems] = useState<Item[] | null>(null);
  const load = () => api.trash().then(setItems);
  useEffect(() => { load(); }, []);
  return (
    <div className="page">
      <header className="page-head"><h1>Trash</h1></header>
      {items && !items.length && <p className="muted">Trash is empty.</p>}
      <ul className="list">
        {items?.map((i) => (
          <li key={i.id}>
            <BoardIcon kind={i.kind} /><span className="label">{i.title}</span>
            <span className="muted">{ago(i.deleted_at!)}</span>
            <button className="btn ghost" onClick={async () => { await api.restore(i.id); load(); onChanged(); }}>Restore</button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Settings({ user }: { user: User }) {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [apps, setApps] = useState<Awaited<ReturnType<typeof api.apps>>>([]);
  const load = () => { api.tokens().then(setTokens); api.apps().then(setApps); };
  useEffect(() => { load(); }, []);
  const mcpUrl = `${location.origin}/mcp`;
  const connect = `claude mcp add --transport http pragmatic ${mcpUrl}`;
  const command = `claude mcp add --transport http pragmatic ${location.origin}/mcp --header "Authorization: Bearer ${fresh ?? '<token>'}"`;
  return (
    <div className="page narrow">
      <header className="page-head"><h1>Settings</h1></header>
      <section className="panel">
        <h2>Account</h2>
        <p>{user.name} · <span className="muted">{user.email}</span></p>
      </section>
      <DriveSettings />
      <PeopleSettings me={user} />
      <section className="panel">
        <h2>Connect Claude</h2>
        <p className="muted">
          Give Claude Code, Claude Desktop or any other MCP client access to pragmatic. It can then draw boards from your
          prompts, rebuild screenshots as editable diagrams, and import diagrams from Whimsical, Mermaid or Excalidraw.
          The client signs in to pragmatic as you (a browser page asks you to allow it); pragmatic never sees your Claude login.
        </p>
        <h3>Claude Desktop</h3>
        <ol className="steps">
          <li><a className="btn primary" href="/pragmatic.mcpb" download>Download the extension</a> and open the file. Claude Desktop asks you to install it.</li>
          <li>When it asks for the pragmatic MCP address, paste:
            <pre className="code">{mcpUrl}</pre>
            <button className="btn ghost" onClick={() => copyText(mcpUrl)}>Copy address</button>
          </li>
          <li>Start a new chat. On the first pragmatic request a browser page asks you to allow access.</li>
        </ol>
        <h3>Claude Code</h3>
        <ol className="steps">
          <li>Run this command in your terminal:
            <pre className="code">{connect}</pre>
            <button className="btn ghost" onClick={() => copyText(connect)}>Copy command</button>
          </li>
          <li>In Claude Code, run <code>/mcp</code>, pick pragmatic and choose Authenticate. A browser page asks you to allow it.</li>
        </ol>
        <p className="muted try">Then ask for example: “Draw our login flow as a flowchart on a new pragmatic board”, or paste a screenshot and say “Rebuild this in pragmatic”.</p>
        {apps.length > 0 && (
          <>
            <h3>Connected apps</h3>
            <ul className="list">
              {apps.map((a) => (
                <li key={a.id}>
                  <span className="label">{a.name}</span>
                  <span className="muted">connected {ago(a.connected_at)} · {a.last_used_at ? `used ${ago(a.last_used_at)}` : 'not used yet'}</span>
                  <button className="btn ghost danger" onClick={async () => { await api.disconnectApp(a.id); load(); }}>Disconnect</button>
                </li>
              ))}
            </ul>
          </>
        )}
        <details className="token-way">
          <summary>Clients without OAuth: use a token</summary>
        <ol className="steps">
          <li>
            Create a token.{' '}
            <button className="btn primary" onClick={async () => { const t = await api.createToken('Claude'); setFresh(t.token); setCopied(false); load(); }}>Create token</button>
          </li>
          <li>Run this command in your terminal:
            <pre className="code">{command}</pre>
            <button className="btn ghost" disabled={!fresh} onClick={async () => { await copyText(command); setCopied(true); }}>{copied ? 'Copied' : 'Copy command'}</button>
            {fresh && <p className="warn">Copy it now. The token is not shown again.</p>}
          </li>
        </ol>
        </details>
        {tokens.length > 0 && (
          <ul className="list">
            {tokens.map((t) => (
              <li key={t.id}>
                <span className="label">{t.name}</span>
                <span className="muted">created {ago(t.created_at)} · {t.last_used_at ? `used ${ago(t.last_used_at)}` : 'not used yet'}</span>
                <button className="btn ghost danger" onClick={async () => { await api.deleteToken(t.id); load(); }}>Revoke</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// Admins: who can use this install. Invite (a link to pass on, with passwords), make admin, remove access.
function PeopleSettings({ me }: { me: User }) {
  const info = useMe();
  const [list, setList] = useState<PersonRow[]>([]), [email, setEmail] = useState(''), [link, setLink] = useState<{ email: string; url: string } | null>(null), [error, setError] = useState('');
  const load = () => api.people().then(setList, (e) => setError(e.message));
  useEffect(() => { if (info?.admin) load(); }, [info?.admin]);
  if (!info?.admin || info.auth.modes.includes('local')) return null;
  const passwords = info.auth.modes.includes('password');
  const act = (p: Promise<unknown>) => p.then(load, (e) => setError(e.message));
  const show = (who: string, url?: string) => { if (url) { setLink({ email: who, url }); copyText(url).catch(() => {}); } };
  return (
    <section className="panel">
      <h2>People</h2>
      <p className="muted">
        {passwords ? 'Invite someone with a link (it is copied for you; it works for 7 days). Send it to them yourself: pragmatic sends no email.'
          : `People sign in with ${info.auth.modes.includes('oidc') ? info.auth.oidc : 'Google'}; add an email here to share with them before their first sign-in.`}
      </p>
      <form className="people-add" onSubmit={(e) => { e.preventDefault(); const who = email.trim(); if (!who) return; act(api.addPerson(who).then((r) => { show(who, r.invite_link); setEmail(''); })); }}>
        <input type="email" required placeholder="name@company.com" aria-label="Email to invite" value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="btn primary">{passwords ? 'Invite' : 'Add'}</button>
      </form>
      {link && <p className="invite-link">Invite link for {link.email} (copied): <code>{link.url}</code></p>}
      {error && <p className="error">{error}</p>}
      <ul className="list">
        {list.map((p) => (
          <li key={p.id} className={p.disabled_at ? 'muted' : ''}>
            <span className="label">{p.name}{p.is_admin && <span className="pill">Admin</span>}{p.disabled_at && <span className="pill">No access</span>}</span>
            <span className="muted">{p.email} · {p.last_sign_in ? `signed in ${ago(p.last_sign_in)}` : passwords && !p.has_password ? 'invited' : 'not signed in yet'}</span>
            {p.id !== me.id && (
              <span className="people-actions">
                {passwords && !p.disabled_at && <button className="btn ghost" onClick={() => act(api.inviteLink(p.id).then((r) => show(p.email, r.invite_link)))}>{p.has_password ? 'Reset password' : 'Invite link'}</button>}
                {!p.disabled_at && <button className="btn ghost" onClick={() => act(api.updatePerson(p.id, { is_admin: !p.is_admin }))}>{p.is_admin ? 'Remove admin' : 'Make admin'}</button>}
                <button className={`btn ghost ${p.disabled_at ? '' : 'danger'}`} onClick={() => act(api.updatePerson(p.id, { disabled: !p.disabled_at }))}>{p.disabled_at ? 'Give access' : 'Remove access'}</button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function DriveSettings() {
  const [d, setD] = useState<{ connected: boolean; available: boolean } | null>(null);
  const local = useLocalMode();
  useEffect(() => { api.drive().then(setD); }, []);
  if (!d) return null;
  return (
    <section className="panel">
      <h2>Google Drive</h2>
      <p className="muted">
        pragmatic keeps a copy of each board you own (a picture and the full data) in a <strong>pragmatic</strong> folder in your
        own Drive, updated at most every 10 minutes while it changes. It can only see files it made there.
        {local && ' It is a backup of this machine\'s boards.'}
      </p>
      {!d.available ? <p className="muted">Drive copies need a Google OAuth client on this server: set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see the README).</p>
        : d.connected
          ? <p>Connected. <button className="btn ghost danger" onClick={async () => { await api.forgetDrive(); setD({ ...d, connected: false }); }}>Stop copying</button></p>
          : <a className="btn primary" href="/auth/drive?next=%2Fsettings">Connect Google Drive</a>}
    </section>
  );
}

const BoardIcon = ({ kind }: { kind: Item['kind'] }) => kind === 'doc' ? (
  <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 2.5h6.5L15.5 6.5V17a.5.5 0 0 1-.5.5H5a.5.5 0 0 1-.5-.5V3a.5.5 0 0 1 .5-.5z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M7 9.5h6M7 12.5h6M7 6.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
) : kind === 'folder' ? (
  <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 5.5a1.5 1.5 0 0 1 1.5-1.5h3.6l1.6 1.8H16a1.5 1.5 0 0 1 1.5 1.5v7.2A1.5 1.5 0 0 1 16 16H4a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
) : (
  <svg className="icon board-icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="3.5" width="15" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><rect x="5.5" y="7" width="4" height="3" rx=".8" fill="currentColor" /><rect x="11" y="10.5" width="3.5" height="3" rx=".8" fill="currentColor" /><path d="M9.5 8.5h1.75v2" fill="none" stroke="currentColor" strokeWidth="1.2" /></svg>
);
const CardIcon = () => <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><rect x="2.5" y="5" width="15" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M5.5 8.5h6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
const ClockIcon = () => <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 6v4l2.5 2" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
const TrashIcon = () => <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 6h12M8 6V4.5h4V6M5.5 6l.8 10h7.4l.8-10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
const GearIcon = () => <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.4" /><path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.7 4.7l1.4 1.4M13.9 13.9l1.4 1.4M4.7 15.3l1.4-1.4M13.9 6.1l1.4-1.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>;
const PencilIcon = () => <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M13.5 3.5l3 3-9 9H4.5v-3z" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /></svg>;
const LogoutIcon = () => <svg className="icon" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 4H5a1.5 1.5 0 0 0-1.5 1.5v9A1.5 1.5 0 0 0 5 16h3M12 6.5 15.5 10 12 13.5M15.5 10H8" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const Caret = ({ open }: { open: boolean }) => <svg className={`caret ${open ? 'open' : ''}`} viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>;
