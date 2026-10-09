// WordPress.org API: aktuális core-, plugin- és téma-verziók (24 órás fájl-cache)
// Csak a valódi válaszokat gyorsítótárazzuk: egy átmeneti hiba (időtúllépés, 429, 5xx) nem ragadhat be egy napra.
import fs from 'node:fs';
import path from 'node:path';

const TTL = 24 * 3600 * 1000;
export function createWporg(client, cacheFile) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  const save = () => { try { fs.mkdirSync(path.dirname(cacheFile), { recursive: true }); fs.writeFileSync(cacheFile, JSON.stringify(cache)); } catch {} };
  const inflight = new Map();
  // fn: értéket ad vissza (gyorsítótárba kerül), vagy undefined-ot (átmeneti hiba: nem kerül gyorsítótárba, a hívó null-t kap)
  async function cached(key, fn) {
    const c = cache[key];
    if (c && Date.now() - c.t < TTL) return c.v;
    if (inflight.has(key)) return inflight.get(key);
    const p = (async () => {
      let v; try { v = await fn(); } catch { v = undefined; }
      if (v === undefined) return c ? c.v : null; // hiba esetén a lejárt, de meglévő adat még mindig jobb, mint a semmi
      cache[key] = { t: Date.now(), v }; save(); return v;
    })();
    inflight.set(key, p);
    try { return await p; } finally { inflight.delete(key); }
  }
  async function json(url) {
    const r = await client.tryGet(url, { timeout: 15000 });
    let data = null; try { data = JSON.parse(r.body); } catch {}
    return { status: r.status, data };
  }
  return {
    core: () => cached('v2:core', async () => { const { status, data } = await json('https://api.wordpress.org/core/version-check/1.7/'); return status === 200 && data?.offers?.[0]?.current ? data.offers[0].current : undefined; }),
    plugin: slug => cached('v2:p:' + slug, async () => {
      const { status, data } = await json(`https://api.wordpress.org/plugins/info/1.2/?action=plugin_information&request[slug]=${encodeURIComponent(slug)}&request[fields][sections]=0`);
      if (status === 200 && data?.version) return { version: data.version, name: data.name, requiresPhp: data.requires_php || null, lastUpdated: data.last_updated || null };
      if (status === 404 || (status === 200 && data?.error)) return { notOnWporg: true }; // tényleg nincs a tárban (pl. prémium bővítmény)
      return undefined;
    }),
    theme: slug => cached('v2:t:' + slug, async () => {
      const { status, data } = await json(`https://api.wordpress.org/themes/info/1.2/?action=theme_information&request[slug]=${encodeURIComponent(slug)}`);
      if (status === 200 && data?.version) return { version: data.version, name: data.name };
      if (status === 404 || (status === 200 && data?.error)) return { notOnWporg: true };
      return undefined;
    }),
  };
}

// PHP támogatási vége (security support end) – php.net/supported-versions
export const PHP_EOL = { '5': '2018-12-31', '7.0': '2019-01-10', '7.1': '2019-12-01', '7.2': '2020-11-30', '7.3': '2021-12-06', '7.4': '2022-11-28', '8.0': '2023-11-26', '8.1': '2025-12-31', '8.2': '2026-12-31', '8.3': '2027-12-31', '8.4': '2028-12-31', '8.5': '2029-12-31' };
export function phpStatus(ver) {
  if (!ver) return null;
  const m = ver.match(/^(\d+)\.(\d+)/); if (!m) return null;
  const key = m[1] === '5' ? '5' : `${m[1]}.${m[2]}`;
  const eol = PHP_EOL[key]; if (!eol) return { ver, eol: null, isEol: false };
  const days = Math.floor((new Date(eol) - Date.now()) / 86400000);
  return { ver, eol, isEol: days < 0, daysLeft: days };
}

// verzió-összehasonlítás
export function cmpVer(a, b) {
  const pa = String(a).split(/[.-]/).map(x => parseInt(x, 10) || 0), pb = String(b).split(/[.-]/).map(x => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const d = (pa[i] || 0) - (pb[i] || 0); if (d) return d; }
  return 0;
}
// mennyire elmaradott: { behind: bool, majorGap: major-eltérés (x.y szinten mérve a WP/Elementor logikája szerint) }
export function gap(installed, latest) {
  if (!installed || !latest) return null;
  const a = installed.split('.').map(x => parseInt(x, 10) || 0), b = latest.split('.').map(x => parseInt(x, 10) || 0);
  const behind = cmpVer(installed, latest) < 0;
  const major = (b[0] || 0) - (a[0] || 0);
  const minor = major === 0 ? (b[1] || 0) - (a[1] || 0) : (b[1] || 0) + 10 * major; // durva becslés major váltásnál
  return { behind, major, minor };
}
