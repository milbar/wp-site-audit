// HTTP-réteg: időkorlát, kézi átirányítás-követés, hibás tanúsítvány tűrése, SSRF-védelem (szerver módban)
import { Agent, fetch as ufetch } from 'undici';
import dns from 'node:dns';
import dnsp from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36 wp-site-audit/1.0';

// Nem nyilvános címtartományok (IPv4 és IPv6). Az IPv4-be ágyazott IPv6 címeket (::ffff:a.b.c.d) teljes egészében tiltjuk.
const BLOCK = new net.BlockList();
for (const [a, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) BLOCK.addSubnet(a, bits, 'ipv4');
for (const [a, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) BLOCK.addSubnet(a, bits, 'ipv6');
export function isPrivate(ip) {
  const v = net.isIP(ip); if (!v) return true; // ismeretlen formátum: biztonságból tiltjuk
  if (v === 6) {
    // IPv4-be ágyazott cím (::ffff:a.b.c.d vagy ::ffff:7f00:1): a beágyazott IPv4 címet vizsgáljuk
    const l = ip.toLowerCase();
    const dotted = l.match(/^(?:0:0:0:0:0:ffff:|::ffff:)(\d+\.\d+\.\d+\.\d+)$/);
    if (dotted) return isPrivate(dotted[1]);
    const hex = l.match(/^(?:0:0:0:0:0:ffff:|::ffff:)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (hex) { const a = parseInt(hex[1], 16), b = parseInt(hex[2], 16); return isPrivate(`${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`); }
  }
  try { return BLOCK.check(ip, v === 6 ? 'ipv6' : 'ipv4'); } catch { return true; }
}

// Kapcsolódáskor ellenőrző névfeloldás: a ténylegesen használt IP-t vizsgáljuk (DNS-rebinding ellen), nem külön előzetes feloldást
export function guardedLookup(hostname, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  dns.lookup(hostname, { ...opts, all: true }, (err, addrs) => {
    if (err) return cb(err);
    if (addrs.some(a => isPrivate(a.address))) return cb(new Error('Privát / belső cím nem vizsgálható'));
    if (opts.all) return cb(null, addrs);
    cb(null, addrs[0].address, addrs[0].family);
  });
}

const mkAgent = (guarded) => new Agent({ connect: { rejectUnauthorized: false, ...(guarded ? { lookup: guardedLookup } : {}) }, headersTimeout: 20000, bodyTimeout: 20000 });
const plainAgent = mkAgent(false), guardedAgent = mkAgent(true);

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// delayMs: legalább ennyi idő telik el két, ugyanarra a hosztra menő kérés indítása között (bot-védelem / rate-limit elkerülése)
export function createClient({ blockPrivate = false, timeoutMs = 15000, delayMs = +(process.env.REQUEST_DELAY_MS ?? 500) } = {}) {
  const nextSlot = new Map();
  async function throttle(host) {
    if (!delayMs) return;
    const now = Date.now();
    const at = Math.max(now, nextSlot.get(host) || 0);
    nextSlot.set(host, at + delayMs + Math.random() * delayMs * 0.4);
    if (nextSlot.size > 2000) for (const [h, t] of nextSlot) if (t < now) nextSlot.delete(h);
    if (at > now) await sleep(at - now);
  }
  // korai, gyors elutasítás (az IP-literálokat és a névfeloldást előre ellenőrzi); a végső védelem a kapcsolódáskori lookup
  async function guard(host) {
    if (!blockPrivate) return;
    const addrs = net.isIP(host) ? [{ address: host }] : await dnsp.lookup(host, { all: true });
    if (addrs.some(a => isPrivate(a.address))) throw new Error('Privát / belső cím nem vizsgálható');
  }

  // egy kérés, átirányítás nélkül
  async function raw(url, { method = 'GET', headers = {}, maxBytes = 3_000_000, timeout = timeoutMs } = {}) {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) throw new Error('Csak http és https cím vizsgálható');
    await guard(u.hostname);
    await throttle(u.hostname);
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    const t0 = performance.now();
    try {
      const res = await ufetch(url, { method, redirect: 'manual', signal: ctrl.signal, dispatcher: blockPrivate ? guardedAgent : plainAgent, headers: { 'user-agent': UA, 'accept-language': 'hu-HU,hu;q=0.9,en;q=0.7', accept: '*/*', ...headers } });
      const ttfb = performance.now() - t0;
      let body = '', bytes = 0, truncated = false;
      if (method !== 'HEAD' && res.body) {
        const chunks = [];
        for await (const c of res.body) {
          bytes += c.length;
          if (bytes > maxBytes) { truncated = true; break; }
          chunks.push(c);
        }
        if (truncated) { try { await res.body.cancel(); } catch {} } // a megszakított letöltés ne tartsa nyitva a kapcsolatot
        body = Buffer.concat(chunks).toString('utf8');
      }
      const h = {}; res.headers.forEach((v, k) => { h[k] = v; });
      return { url, status: res.status, headers: h, body, bytes, truncated, ttfb: Math.round(ttfb), ms: Math.round(performance.now() - t0) };
    } finally { clearTimeout(t); }
  }

  // átirányítás-követés láncrögzítéssel
  async function get(url, opts = {}) {
    const chain = [];
    let cur = url;
    for (let i = 0; i < (opts.maxRedirects ?? 8); i++) {
      const r = await raw(cur, opts);
      chain.push({ url: cur, status: r.status });
      if (r.status >= 300 && r.status < 400 && r.headers.location) { cur = new URL(r.headers.location, cur).href; continue; }
      return { ...r, finalUrl: cur, chain };
    }
    throw new Error('Túl sok átirányítás');
  }

  // biztonságos változat: hibát nem dob, null-t ad
  async function tryGet(url, opts) { try { return await get(url, opts); } catch (e) { return { error: e.message || String(e), status: 0, body: '', headers: {} }; } }
  async function tryRaw(url, opts) { try { return await raw(url, opts); } catch (e) { return { error: e.message || String(e), status: 0, body: '', headers: {} }; } }
  // JSON küldése (webhook, API-hívás): ugyanazzal a védelemmel, átirányítás nélkül, hibát nem dob
  async function postJson(url, body, headers = {}, { timeout = 15000 } = {}) {
    try {
      const u = new URL(url);
      if (!/^https?:$/.test(u.protocol)) throw new Error('Csak http és https cím engedett');
      await guard(u.hostname);
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
      try {
        const res = await ufetch(url, { method: 'POST', redirect: 'manual', signal: ctrl.signal, dispatcher: blockPrivate ? guardedAgent : plainAgent, headers: { 'user-agent': UA, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
        const text = (await res.text()).slice(0, 200000);
        return { status: res.status, body: text };
      } finally { clearTimeout(t); }
    } catch (e) { return { status: 0, body: '', error: e.message || String(e) }; }
  }
  // TLS-tanúsítvány lekérdezése ugyanazzal a védelemmel
  const cert = host => certInfo(host, 443, 10000, blockPrivate ? guardedLookup : undefined);
  return { raw, get, tryGet, tryRaw, postJson, guard, cert, blockPrivate };
}

// TLS-tanúsítvány adatai
export function certInfo(host, port = 443, timeout = 10000, lookup) {
  return new Promise(resolve => {
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout, ...(lookup ? { lookup } : {}) }, () => {
      const c = s.getPeerCertificate();
      const out = { authorized: s.authorized, error: s.authorizationError ? String(s.authorizationError) : null, issuer: c?.issuer?.O || c?.issuer?.CN || '', validTo: c?.valid_to ? new Date(c.valid_to).toISOString() : null, subjectAlt: c?.subjectaltname || '' };
      if (out.validTo) out.daysLeft = Math.floor((new Date(out.validTo) - Date.now()) / 86400000);
      s.end(); resolve(out);
    });
    s.on('error', e => resolve({ authorized: false, error: e.code || e.message }));
    s.on('timeout', () => { s.destroy(); resolve({ authorized: false, error: 'TIMEOUT' }); });
  });
}

// pool: legfeljebb n párhuzamos feladat
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); } }));
  return out;
}
