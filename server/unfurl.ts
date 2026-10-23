import { lookup as dnsLookup } from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import { BadRequest } from './store.ts';

// Private, loopback, link-local and metadata ranges: never fetched, so a link cannot probe the internal network.
// IPv6 is normalised first (WHATWG URL), so IPv4-mapped forms in hex (::ffff:7f00:1) are caught too.
export function privateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v6 = new URL(`http://[${ip}]`).hostname.slice(1, -1).toLowerCase();
    const mapped = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mapped) { const [h, l] = mapped.slice(1).map((x) => parseInt(x, 16)); return privateAddress(`${h >> 8}.${h & 255}.${l >> 8}.${l & 255}`); }
    return /^(::1?$|f[cd]|fe[89ab])/.test(v6);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// Resolve, refuse if any answer is private, and connect to the checked answer: the socket does not resolve again,
// so a name whose answer changes between the check and the connection (DNS rebinding) cannot reach inside.
const safeLookup = ((host: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => dnsLookup(host, { ...opts, all: true }, (err, addrs) => {
  if (err) return cb(err);
  if (!addrs.length || addrs.some((x) => privateAddress(x.address))) return cb(new Error(`${host} is a private address`));
  if (opts.all) cb(null, addrs); else cb(null, addrs[0].address, addrs[0].family);
})) as unknown as LookupFunction;

type Page = { status: number; location?: string; type: string; body: string };
function get(url: URL): Promise<Page> {
  return new Promise((ok, fail) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) && privateAddress(host)) return fail(new Error(`${host} is a private address`)); // no lookup for an IP
    const req = (url.protocol === 'https:' ? https : http).get(url, { lookup: safeLookup, timeout: 4000, headers: { 'user-agent': 'pragmatic-link-preview/1.0' } }, (res) => {
      const page = { status: res.statusCode ?? 0, location: res.headers.location, type: res.headers['content-type'] ?? '', body: '' };
      if (page.status >= 300 && page.status < 400) { res.resume(); return ok(page); }
      res.setEncoding('utf8');
      res.on('data', (c: string) => { page.body += c; if (page.body.length > 200_000) res.destroy(); });
      res.on('close', () => ok(page));
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', fail);
  });
}

const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();

// Page title for a link card. Falls back to the host name; never throws for unreachable pages.
export async function unfurl(raw: string): Promise<{ url: string; title: string; site: string }> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new BadRequest('Not a valid URL'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new BadRequest('Only http and https links');
  const site = url.hostname.replace(/^www\./, '');
  const fallback = { url: url.toString(), title: site, site };
  try {
    // Follow up to 4 redirects by hand; every hop goes through the same address check.
    let page: Page | null = null, at = url;
    for (let hop = 0; hop < 5; hop++) {
      if (at.protocol !== 'https:' && at.protocol !== 'http:') return fallback;
      page = await get(at);
      if (!page.location || page.status < 300 || page.status >= 400) break;
      at = new URL(page.location, at);
      page = null;
    }
    if (!page || page.status < 200 || page.status >= 300 || !page.type.includes('text/html')) return fallback;
    const html = page.body.slice(0, 200_000);
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1];
    const title = og ?? html.match(/<title[^>]*>([^<]{1,300})<\/title>/i)?.[1];
    return { ...fallback, title: title ? decode(title).slice(0, 200) : site };
  } catch { return fallback; }
}
