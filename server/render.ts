import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, endSession } from './auth.ts';
import { RENDER_URL } from './config.ts';

// PNGs of boards for Drive copies and export_board: a headless Chrome opens the board in render mode and runs
// the app's own exporter, so the picture matches the screen. One page at a time.
// ponytail: one local Chrome; a render pool or worker if many boards copy at once
const CHROME = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'chromium');

let chrome: Promise<{ proc: ChildProcess; url: string }> | null = null;
function browser() {
  return (chrome ??= new Promise((ok, fail) => {
    const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${mkdtempSync(join(tmpdir(), 'pragmatic-render-'))}`,
      '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio', '--disable-dev-shm-usage',
      // Containers usually cannot give Chromium its own sandbox; the renderer only opens our own pages.
      ...(process.env.CHROME_NO_SANDBOX === '1' ? ['--no-sandbox'] : [])], { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.unref();
    const timer = setTimeout(() => fail(new Error('Chrome did not start')), 15_000);
    proc.stderr!.on('data', (b: Buffer) => {
      const m = b.toString().match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); ok({ proc, url: m[1] }); }
    });
    proc.on('exit', () => { chrome = null; });
    proc.on('error', (e) => { clearTimeout(timer); chrome = null; fail(e); });
  }));
}
process.on('exit', () => { chrome?.then((c) => c.proc.kill()).catch(() => {}); });

// A tiny Chrome DevTools Protocol client over the browser socket (flattened sessions).
// Every call ends: Chrome going away fails the calls in flight, and a call that hangs fails after CALL_TIMEOUT and
// stops that Chrome (the next render starts a new one). Otherwise one stuck render would block the queue for good.
const CALL_TIMEOUT = 30_000;
async function cdp() {
  const ws = new WebSocket((await browser()).url);
  await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail; });
  let id = 0;
  type Reply = { result?: any; error?: { message: string } };
  const pend = new Map<number, (m: Reply) => void>();
  ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); pend.get(m.id)?.(m); pend.delete(m.id); };
  ws.onclose = () => { for (const f of pend.values()) f({ error: { message: 'Chrome closed the connection' } }); pend.clear(); };
  const send = (method: string, params: object = {}, sessionId?: string) => new Promise<any>((ok, fail) => {
    if (ws.readyState !== WebSocket.OPEN) return fail(new Error(`${method}: Chrome is not connected`));
    const n = ++id, timer = setTimeout(() => {
      pend.delete(n);
      fail(new Error(`${method}: Chrome did not answer in ${CALL_TIMEOUT / 1000} seconds`));
      chrome?.then((c) => c.proc.kill()).catch(() => {});
    }, CALL_TIMEOUT);
    pend.set(n, (m) => { clearTimeout(timer); if (m.error) fail(new Error(`${method}: ${m.error.message}`)); else ok(m.result); });
    ws.send(JSON.stringify({ id: n, method, params, sessionId }));
  });
  return { send, close: () => ws.close() };
}

let queue: Promise<unknown> = Promise.resolve();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// The whole board as a PNG (light theme), seen as `userId` sees it. Returns null for an empty board.
type RenderOpts = { theme?: 'light' | 'dark'; ids?: string[]; background?: boolean };
export function renderBoardPng(boardId: string, userId: string, scale = 2, opts: RenderOpts = {}): Promise<Buffer | null> {
  const job = queue.then(async () => {
    const c = await cdp(), sid = await createSession(userId, 2 * 60e3);
    const { browserContextId } = await c.send('Target.createBrowserContext', { disposeOnDetach: true });
    try {
      const { targetId } = await c.send('Target.createTarget', { url: 'about:blank', browserContextId });
      const { sessionId: s } = await c.send('Target.attachToTarget', { targetId, flatten: true });
      const host = new URL(RENDER_URL).hostname;
      await c.send('Network.setCookie', { name: 'sid', value: sid, domain: host, path: '/', httpOnly: true, browserContextId }, s);
      await c.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: opts.theme === 'dark' ? 'dark' : 'light' }] }, s);
      await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false }, s);
      await c.send('Page.navigate', { url: `${RENDER_URL}/b/${boardId}?render=1` }, s);
      const ev = async (expression: string) => (await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s)).result?.value;
      for (let i = 0; i < 100 && !(await ev('window.__pragmaticReady === true')); i++) await sleep(200);
      if (!(await ev('window.__pragmaticReady === true'))) throw new Error('The board did not load for rendering');
      const args = JSON.stringify({ ids: (opts.ids ?? []).filter((i) => /^[\w-]+$/.test(i)), background: opts.background !== false });
      const url = await ev(`window.__pragmaticRender(${Number(scale) || 2}, ${args})`) as string | null;
      return url ? Buffer.from(url.slice(url.indexOf(',') + 1), 'base64') : null;
    } finally {
      await endSession(sid).catch(() => {});
      await c.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
      c.close();
    }
  });
  queue = job.catch(() => {});
  return job;
}
