import { AUTH, BASE_URL, PORT, RENDER_URL } from './config.ts';

// The Cookie header as a map. Browsers send every cookie of the host, also ones other apps on another port set,
// so a value that is not valid percent-encoding is kept as it is instead of failing the request.
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 1) continue;
    const raw = part.slice(eq + 1);
    try { out[part.slice(0, eq)] = decodeURIComponent(raw); } catch { out[part.slice(0, eq)] = raw; }
  }
  return out;
}

const hostOf = (url: string) => { try { return new URL(url).host; } catch { return ''; } };
const OWN_HOSTS = new Set([hostOf(BASE_URL), hostOf(RENDER_URL), `localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);

// AUTH=local has no sign-in, so a web page whose name re-resolves to 127.0.0.1 (DNS rebinding) would be this
// user. Such a page sends its own name as Host, so only this server's names pass. Sign-in modes need no check:
// a rebound page has no session cookie, and a reverse proxy may pass any Host.
export const hostAllowed = (host: string | undefined) => !AUTH.includes('local') || OWN_HOSTS.has(host ?? '');

// WebSockets have no CORS: a browser opens one from any site and sends the cookies. A browser always sends Origin,
// so it must be this server (the address in the request, BASE_URL or RENDER_URL). Other clients send none.
export const originAllowed = (origin: string | undefined, host: string | undefined) =>
  !origin || hostOf(origin) === host || OWN_HOSTS.has(hostOf(origin));
