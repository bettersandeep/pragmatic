// pragmatic desktop: the board web app on the left, the user's own Claude Code CLI in a terminal panel on the right.
// The board view loads the pragmatic server with no preload and no Node access.
// Only the local panel and settings pages get the small API in preload.js.
const { app, BaseWindow, BrowserWindow, WebContentsView, Menu, ipcMain, shell, dialog, screen, utilityProcess } = require('electron');
const { parseEnv } = require('node:util');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const pty = require('node-pty');

const smokeDir = process.env.PRAGMATIC_SMOKE_DIR; // test run: open the panel, take screenshots, quit
if (smokeDir) app.setPath('userData', path.join(smokeDir, 'userdata')); // a fresh app: no saved settings, an empty database

// Google sign-in refuses browsers that say they are Electron.
app.userAgentFallback = app.userAgentFallback.replace(/ (pragmatic|Electron)\/\S+/g, '');

// Server choices in Settings; PRAGMATIC_SERVERS (comma separated) adds your team's.
const PRESETS = ['http://localhost:3100', 'http://localhost:5173', ...(process.env.PRAGMATIC_SERVERS ?? '').split(',').map((s) => s.trim()).filter(Boolean)];
const INSTALL = 'npm install -g @anthropic-ai/claude-code';
const settingsFile = path.join(app.getPath('userData'), 'settings.json');
// server: 'builtin' runs pragmatic inside the app (one person, no sign-in, data in the app's folder); 'remote' opens serverUrl.
// claude: false hides the Claude panel and menu, for people who use pragmatic without Claude Code.
const settings = { server: 'builtin', port: 3133, claude: true, serverUrl: PRESETS[0], cwd: os.homedir(), bounds: { width: 1440, height: 900 }, panelWidth: 560 };
// Settings from before the built-in server had only serverUrl: keep that server.
try { const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8')); Object.assign(settings, { server: saved.serverUrl ? 'remote' : 'builtin' }, saved); } catch {}
const saveSettings = () => {
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
};

let win, board, panel, settingsWin;
let panelOpen = false;
let term = null;
let termSize = null; // { cols, rows } once the panel has measured itself
let pendingPrefix = '';

const serverOrigin = () => (settings.server === 'builtin' ? `http://localhost:${settings.port}` : new URL(settings.serverUrl).origin);

// --- the built-in server -----------------------------------------------------------------------------
// The same pragmatic server, run by Electron's own Node (24, which runs its TypeScript directly).
// Packaged: a copy with its production modules in Resources/server (stage-server.mjs). From source: the repo itself.
let server = null, serverLog = [];
const serverDir = () => (app.isPackaged ? path.join(process.resourcesPath, 'server') : path.join(__dirname, '..'));
const dataDir = () => path.join(app.getPath('userData'), 'data');
// Optional settings for the built-in server (for example GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for Drive backup).
const envFile = () => path.join(app.getPath('userData'), 'pragmatic.env');
function startServer() {
  if (server) return Promise.resolve();
  let extra = {};
  try { extra = parseEnv(fs.readFileSync(envFile(), 'utf8')); } catch {}
  const log = fs.createWriteStream(path.join(app.getPath('userData'), 'server.log'), { flags: 'a' });
  server = utilityProcess.fork(path.join(serverDir(), 'server', 'main.ts'), [], {
    cwd: serverDir(), stdio: 'pipe', serviceName: 'pragmatic server',
    env: {
      ...process.env, ...extra, NODE_ENV: 'production', AUTH: 'local', HOST: '127.0.0.1', PORT: String(settings.port),
      BASE_URL: serverOrigin(), PRAGMATIC_DATA: dataDir(),
    },
  });
  serverLog = [];
  for (const s of [server.stdout, server.stderr]) s?.on('data', (d) => { log.write(d); serverLog = [...serverLog, String(d)].slice(-20); });
  server.on('exit', (code) => { server = null; if (code && win && !quitting) showOffline(serverOrigin(), `The built-in server stopped (exit ${code}).\n${serverLog.join('').slice(-600)}`); });
  // Ready once it answers /healthz (the first start creates its database, a few seconds).
  return (async () => {
    for (let i = 0; i < 150 && server; i++) {
      try { if ((await fetch(`${serverOrigin()}/healthz`)).ok) return; } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error(server ? 'The built-in server did not start in 30 seconds.' : 'The built-in server stopped.');
  })();
}
let quitting = false;
// Quit: the server writes what is still in memory (SIGTERM), then the app ends.
app.on('before-quit', (e) => {
  if (!server || quitting) return;
  quitting = true;
  e.preventDefault();
  const s = server, done = () => app.quit();
  s.once('exit', done);
  s.kill();
  setTimeout(done, 5000).unref();
});
const quote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const isWeb = (url) => /^https?:\/\//i.test(url);

function layout() {
  const { width, height } = win.getContentBounds();
  const pw = panelOpen ? Math.max(320, Math.min(settings.panelWidth, width - 480)) : 0;
  board.setBounds({ x: 0, y: 0, width: width - pw, height });
  panel.setBounds({ x: width - pw, y: 0, width: pw, height });
  panel.setVisible(panelOpen);
}

function togglePanel(open = !panelOpen) {
  panelOpen = open && settings.claude;
  layout();
  (panelOpen ? panel : board).webContents.focus();
  if (panelOpen && !panel.webContents.getURL()) panel.webContents.loadFile(path.join(__dirname, 'panel.html'));
}

// The user's login shell runs claude, so PATH from their profile applies. When claude exits, a normal shell stays.
const CLAUDE = `if command -v claude >/dev/null 2>&1; then claude; else printf '\\n  Claude Code is not installed. Install it here:\\n\\n    ${INSTALL}\\n\\n  Then type claude.\\n\\n'; fi; exec "$SHELL" -l`;

function startSession(prefix = '') {
  if (!termSize) { pendingPrefix = prefix; return; }
  if (term) term.kill();
  const cwd = fs.existsSync(settings.cwd) ? settings.cwd : os.homedir();
  const shellPath = process.env.SHELL || '/bin/zsh';
  // Drop variables from whatever started the app (npm, a parent Claude session); the login shell sets the user's own.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(npm_|CLAUDECODE|CLAUDE_CODE_)/.test(k)));
  Object.assign(env, { LANG: process.env.LANG || 'en_US.UTF-8', TERM_PROGRAM: 'pragmatic' });
  const t = pty.spawn(shellPath, ['-l', '-i', '-c', prefix + CLAUDE], { name: 'xterm-256color', cwd, env, ...termSize });
  term = t;
  panel.webContents.send('pty:info', { cwd: cwd.replace(os.homedir(), '~') });
  t.onData((d) => { if (term === t) panel.webContents.send('pty:data', d); });
  t.onExit(({ exitCode }) => {
    if (term !== t) return;
    term = null;
    if (!panel.webContents.isDestroyed()) panel.webContents.send('pty:exit', exitCode);
  });
}

async function confirmRestart(detail) {
  if (!term || smokeDir) return true;
  const { response } = await dialog.showMessageBox(win, {
    message: 'Restart the Claude session?', detail, buttons: ['Restart', 'Cancel'], defaultId: 0, cancelId: 1,
  });
  return response === 0;
}

async function restartSession(prefix = '', detail = 'The running Claude session in the panel stops.') {
  togglePanel(true);
  if (await confirmRestart(detail)) startSession(prefix);
}

async function chooseFolder() {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], defaultPath: settings.cwd });
  if (r.canceled) return;
  settings.cwd = r.filePaths[0];
  saveSettings();
  restartSession('', `Claude starts again in ${settings.cwd}.`);
}

async function connectClaude() {
  const url = `${serverOrigin()}/mcp`;
  const add = `claude mcp add --transport http -s user pragmatic ${url}`;
  const prefix = `printf '\\n$ ${add}\\n'; claude mcp remove -s user pragmatic >/dev/null 2>&1; `
    + `claude mcp add --transport http -s user pragmatic ${quote(url)} && `
    + `printf '\\nNext: in Claude, type /mcp, pick pragmatic and choose Authenticate.\\n\\n'; `;
  togglePanel(true);
  if (!(await confirmRestart('Connecting runs "claude mcp add" in the panel, then starts Claude again.'))) return;
  startSession(prefix);
  if (!smokeDir) dialog.showMessageBox(win, {
    message: 'pragmatic is added to Claude Code',
    detail: 'In the Claude panel, type /mcp, pick pragmatic and choose Authenticate. Your browser opens for the sign-in.',
  });
}

function openSettings() {
  if (settingsWin) return settingsWin.focus();
  settingsWin = new BrowserWindow({
    parent: win, modal: true, width: 520, height: 410, resizable: false, minimizable: false, maximizable: false,
    title: 'Settings', webPreferences: { preload: path.join(__dirname, 'preload.js'), sandbox: true, contextIsolation: true },
  });
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// Only the local pages may use these channels; the board never has the preload.
const fromPanel = (e) => panel && e.sender === panel.webContents;
const fromSettings = (e) => settingsWin && e.sender === settingsWin.webContents;
const sizeOf = (s) => ({ cols: Math.max(2, s?.cols | 0), rows: Math.max(2, s?.rows | 0) });
ipcMain.on('pty:ready', (e, size) => {
  if (!fromPanel(e)) return;
  termSize = sizeOf(size);
  if (!term) { startSession(pendingPrefix); pendingPrefix = ''; }
});
ipcMain.on('pty:write', (e, data) => { if (fromPanel(e) && term) term.write(String(data)); });
ipcMain.on('pty:resize', (e, size) => {
  if (!fromPanel(e)) return;
  termSize = sizeOf(size);
  if (term) term.resize(termSize.cols, termSize.rows);
});
ipcMain.on('pty:restart', (e) => { if (fromPanel(e)) startSession(); });
ipcMain.on('panel:choose-folder', (e) => { if (fromPanel(e)) chooseFolder(); });
ipcMain.on('open-link', (e, url) => { if ((fromPanel(e) || fromSettings(e)) && isWeb(url)) shell.openExternal(url); });
ipcMain.handle('settings:get', (e) => (fromSettings(e) ? { server: settings.server, serverUrl: settings.serverUrl, presets: PRESETS, claude: settings.claude } : null));
ipcMain.handle('settings:save', async (e, value) => {
  if (!fromSettings(e)) return 'Not allowed';
  const mode = value?.server === 'remote' ? 'remote' : 'builtin';
  let origin = settings.serverUrl;
  if (mode === 'remote') {
    try { origin = new URL(String(value.serverUrl).trim()).origin; } catch { return 'Enter a full URL, for example https://pragmatic.example.com'; }
    if (!isWeb(origin)) return 'The URL must start with http:// or https://';
  }
  if (Boolean(value.claude) !== settings.claude) {
    settings.claude = Boolean(value.claude);
    saveSettings();
    if (!settings.claude) { togglePanel(false); term?.kill(); term = null; }
    buildMenu();
  }
  if (mode !== settings.server || origin !== settings.serverUrl) {
    settings.server = mode;
    settings.serverUrl = origin;
    saveSettings();
    if (mode === 'remote' && server) server.kill();
    await openBoard();
  }
  settingsWin.close();
  return null;
});
ipcMain.on('settings:show-data', (e) => { if (fromSettings(e)) shell.openPath(app.getPath('userData')); });

function guard(contents) {
  // target=_blank and window.open: server pages stay in the board, all other web links go to the system browser.
  contents.setWindowOpenHandler(({ url }) => {
    if (contents === board.webContents && url.startsWith(serverOrigin() + '/')) board.webContents.loadURL(url);
    else if (isWeb(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
}

function savedBounds() {
  const b = settings.bounds;
  const onScreen = b.x !== undefined && screen.getAllDisplays().some(({ workArea: a }) =>
    b.x < a.x + a.width && b.x + b.width > a.x && b.y < a.y + a.height && b.y + b.height > a.y);
  return onScreen ? b : { width: b.width, height: b.height };
}

function createWindow() {
  win = new BaseWindow({ ...savedBounds(), minWidth: 800, minHeight: 500, title: 'pragmatic', backgroundColor: '#ffffff' });
  board = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  panel = new WebContentsView({
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  panel.setBackgroundColor('#17161c');
  win.contentView.addChildView(board);
  win.contentView.addChildView(panel);
  guard(board.webContents);
  guard(panel.webContents);
  panel.webContents.on('will-navigate', (e) => e.preventDefault());
  board.webContents.session.setPermissionRequestHandler((wc, _perm, cb, details) => {
    try { cb(new URL(details.requestingUrl).origin === serverOrigin()); } catch { cb(false); }
  });
  board.webContents.on('page-title-updated', (_e, title) => win.setTitle(title));
  board.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (isMain && code !== -3) showOffline(url, desc);
  });
  win.on('resize', layout);
  win.on('close', () => { settings.bounds = win.getNormalBounds(); saveSettings(); });
  win.on('closed', () => { if (term) term.kill(); term = null; });
  layout();
  openBoard().then(() => { if (smokeDir) smokeTest(); });
}

// The board: start the built-in server first when that is the choice (a short "starting" page meanwhile).
async function openBoard() {
  if (settings.server === 'builtin') {
    board.webContents.loadURL(`data:text/html,${encodeURIComponent(statusPage('Starting pragmatic…', 'The first start sets up its database; it takes a few seconds.'))}`);
    try { await startServer(); } catch (e) { return showOffline(serverOrigin(), `${e.message}\n${serverLog.join('').slice(-600)}`); }
  }
  await board.webContents.loadURL(serverOrigin()).catch(() => {});
}
const showOffline = (url, desc) => board.webContents.loadURL(`data:text/html,${encodeURIComponent(offlinePage(url, desc))}`);

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const statusPage = (title, text) => `<!doctype html><meta charset="utf-8"><title>pragmatic</title>
<body style="font:15px -apple-system,system-ui,sans-serif;color:#2b2a33;display:grid;place-items:center;height:90vh;margin:0">
<div style="max-width:440px;text-align:center"><h2 style="margin:0 0 8px">${esc(title)}</h2><p style="color:#6b6a75">${esc(text)}</p></div>`;
function offlinePage(url, desc) {
  return `<!doctype html><meta charset="utf-8"><title>pragmatic</title>
<body style="font:15px -apple-system,system-ui,sans-serif;color:#2b2a33;display:grid;place-items:center;height:90vh;margin:0">
<div style="max-width:440px;text-align:center"><h2 style="margin:0 0 8px">Cannot reach pragmatic</h2>
<p style="color:#6b6a75;margin:0 0 4px">${esc(url)}</p><p style="color:#6b6a75;margin:0 0 16px;white-space:pre-wrap;overflow-wrap:anywhere">${esc(String(desc).slice(-800))}</p>
<p>Press Cmd+R to try again. To change the server, open pragmatic &gt; Settings (Cmd+,).</p></div>`;
}

// After a failed load the board shows a data: page; reload goes back to the server.
const reloadBoard = () => {
  const wc = board.webContents;
  if (wc.getURL().startsWith('data:')) openBoard(); else wc.reload();
};
const zoom = (delta) => {
  const wc = board.webContents;
  wc.setZoomLevel(delta === 0 ? 0 : wc.getZoomLevel() + delta);
};
const focusedContents = () => (panel.webContents.isFocused() ? panel.webContents : board.webContents);

function buildMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu', submenu: [
      { role: 'about' }, { type: 'separator' },
      { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings }, { type: 'separator' },
      { role: 'services' }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' }, { role: 'quit' },
    ] },
    { role: 'editMenu' },
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: reloadBoard },
      { label: 'Force Reload', accelerator: 'Shift+CmdOrCtrl+R', click: () => board.webContents.reloadIgnoringCache() },
      { label: 'Toggle Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: () => focusedContents().toggleDevTools() },
      { type: 'separator' },
      { label: 'Actual Size', accelerator: 'CmdOrCtrl+0', click: () => zoom(0) },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => zoom(0.5) },
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => zoom(-0.5) },
      { type: 'separator' }, { role: 'togglefullscreen' },
    ] },
    ...(settings.claude ? [{ label: 'Claude', submenu: [
      { label: 'Claude Panel', accelerator: 'CmdOrCtrl+Shift+K', click: () => togglePanel() },
      { label: 'Connect Claude to pragmatic', click: connectClaude },
      { type: 'separator' },
      { label: 'Choose Folder…', click: chooseFolder },
      { label: 'Restart Session', click: () => restartSession() },
    ] }] : []),
    { role: 'windowMenu' },
  ]));
}

async function smokeTest() {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (view, name) => {
    const file = path.join(smokeDir, `desktop-${name}.png`);
    fs.writeFileSync(file, (await view.webContents.capturePage()).toPNG());
    console.log('smoke: wrote', file);
  };
  ipcMain.on('pty:ready', () => console.log('smoke: panel ready', JSON.stringify(termSize)));
  board.webContents.once('did-finish-load', () => console.log('smoke: board loaded', board.webContents.getURL()));
  try {
    app.focus({ steal: true }); // a window in the background does not paint, so capturePage fails
    await wait(3000);
    togglePanel(true);
    if (process.env.PRAGMATIC_SMOKE_CONNECT) await connectClaude();
    await wait(4000);
    let bytes = 0;
    term?.onData((d) => { bytes += d.length; });
    await wait(Number(process.env.PRAGMATIC_SMOKE_WAIT || 8000));
    console.log('smoke: pty pid', term?.pid, 'bytes after start', bytes);
    const probe = '`pragmatic=${typeof window.pragmatic} require=${typeof require} process=${typeof process} ua=${navigator.userAgent}`';
    console.log('smoke: board sees', await board.webContents.executeJavaScript(probe));
    await shot(board, 'board');
    await shot(panel, 'panel');
    win.setSize(1100, 760);
    await wait(1500);
    console.log('smoke: after resize', JSON.stringify(termSize));
    await shot(panel, 'panel-small');
    openSettings();
    await wait(1500);
    await shot(settingsWin, 'settings');
  } catch (e) {
    console.log('smoke: FAIL', e.message);
    process.exitCode = 1;
  }
  app.quit();
}

app.whenReady().then(() => { buildMenu(); createWindow(); });
app.on('window-all-closed', () => app.quit());
