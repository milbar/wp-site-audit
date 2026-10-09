// Ismert sebezhetőségek a WPScan adatbázisból (opcionális: WPSCAN_API_TOKEN környezeti változó kell hozzá).
// Az ingyenes csomag napi kérésszáma kicsi, ezért a találatokat 24 órán át gyorsítótárazzuk, és felmérésenként korlátozzuk a lekérdezések számát.
import fs from 'node:fs';
import path from 'node:path';
import { cmpVer } from './wporg.mjs';

const TOKEN = () => process.env.WPSCAN_API_TOKEN || '';
const TTL = 24 * 3600 * 1000;
export const wpscanEnabled = () => !!TOKEN();
// az ismert sebezhetőségek vizsgálata alapból be van kapcsolva (kulcs nélküli WPVulnerability); VULN_CHECK=0-val kikapcsolható
export const vulnsEnabled = () => process.env.VULN_CHECK !== '0';

export function createVulnCache(file) {
  let c = {}; try { c = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  return {
    get: k => (c[k] && Date.now() - c[k].t < TTL ? c[k].v : undefined),
    set: (k, v) => { c[k] = { t: Date.now(), v }; try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(c)); } catch {} },
  };
}

const sevOf = v => { const s = (v.cvss?.severity || '').toLowerCase(); return s === 'critical' ? 'kritikus' : s === 'high' ? 'magas' : s === 'medium' ? 'közepes' : s === 'low' ? 'alacsony' : 'magas'; };

// a telepített verziót érintő sebezhetőségek: a javított verzió nagyobb, mint a telepített (vagy nincs javítás)
export function affecting(vulns, version) {
  return (vulns || []).filter(v => !v.fixed_in || cmpVer(version, v.fixed_in) < 0).map(v => ({
    title: String(v.title || '').slice(0, 200), fixedIn: v.fixed_in || null, type: v.vuln_type || null, severity: sevOf(v), cvss: v.cvss?.score ?? null,
    cve: (v.references?.cve || []).slice(0, 3).map(x => 'CVE-' + x), url: v.id ? `https://wpscan.com/vulnerability/${v.id}` : null,
  }));
}

export async function wpscanVulns(client, R, { cache, maxRequests = +(process.env.WPSCAN_MAX_REQUESTS || 20) } = {}) {
  if (!TOKEN()) return null;
  const headers = { authorization: `Token token=${TOKEN()}` };
  let used = 0, limited = false, authErr = false;
  const lookup = async (kind, slug) => {
    const key = `${kind}:${slug}`;
    const hit = cache?.get(key); if (hit !== undefined) return hit;
    if (used >= maxRequests) { limited = true; return undefined; }
    used++;
    const r = await client.tryGet(`https://wpscan.com/api/v3/${kind}/${encodeURIComponent(slug)}`, { headers, timeout: 15000, maxRedirects: 1 });
    if (r.status === 401 || r.status === 403) { authErr = true; return undefined; }
    if (r.status === 429) { limited = true; return undefined; }
    if (r.status === 404) { cache?.set(key, []); return []; }
    if (r.status !== 200) return undefined;
    let j; try { j = JSON.parse(r.body); } catch { return undefined; }
    const v = j?.[slug]?.vulnerabilities || j?.[Object.keys(j || {})[0]]?.vulnerabilities || [];
    cache?.set(key, v); return v;
  };
  const items = [];
  if (R.wp?.version) {
    const v = await lookup('wordpresses', R.wp.version.replace(/\./g, ''));
    for (const a of affecting(v, R.wp.version)) items.push({ kind: 'core', slug: 'wordpress', name: 'WordPress', version: R.wp.version, ...a });
  }
  for (const p of (R.plugins || []).filter(x => x.version && !x.notOnWporg).slice(0, 25)) {
    const v = await lookup('plugins', p.slug);
    for (const a of affecting(v, p.version)) items.push({ kind: 'plugin', slug: p.slug, name: p.name, version: p.version, ...a });
  }
  for (const t of (R.theme || []).filter(x => x.version && !x.notOnWporg).slice(0, 2)) {
    const v = await lookup('themes', t.slug);
    for (const a of affecting(v, t.version)) items.push({ kind: 'theme', slug: t.slug, name: t.name, version: t.version, ...a });
  }
  if (authErr && !items.length) return { error: 'A WPScan API-kulcs érvénytelen vagy lejárt.' };
  return { source: 'WPScan', items, limited, requests: used };
}

// ================= WPVulnerability (wpvulnerability.net): kulcs és regisztráció nélkül, közösségi adatbázis (CVE, Patchstack, Wordfence források)
// Megjegyzés: a WordPress-magra az API a tesztelt verzióknál üres választ ad, ezért a core-t itt nem vizsgáljuk (a „nincs találat” félrevezető lenne);
// a core-hoz a WPScan (kulccsal) használható, egyébként az „elavult verzió” megállapítás marad.
const decodeEnt = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const CVSS_SEV = { critical: 'kritikus', high: 'magas', medium: 'közepes', low: 'alacsony' };

// az adott verzió beleesik-e a rekord érintett tartományába (min: ge/gt, max: le/lt)
export function inRange(op, version) {
  if (!op || !version) return false;
  const { min_version: mn, min_operator: mno, max_version: mx, max_operator: mxo } = op;
  if (!mn && !mx) return false; // tartomány nélküli rekordot nem tekintünk találatnak
  if (mn && (mno === 'gt' ? cmpVer(version, mn) <= 0 : cmpVer(version, mn) < 0)) return false;
  if (mx && (mxo === 'le' ? cmpVer(version, mx) > 0 : cmpVer(version, mx) >= 0)) return false;
  return true;
}

export function wpvulnAffecting(vulns, version) {
  const seen = new Set(), out = [];
  for (const v of vulns || []) {
    if (!inRange(v.operator, version)) continue;
    const src = v.source || [];
    const cve = src.find(s => /^CVE-/i.test(s.id));
    const key = cve?.id || v.uuid || v.name; if (seen.has(key)) continue; seen.add(key);
    const sev = CVSS_SEV[String(v.impact?.cvss3?.severity || v.impact?.cvss?.severity || '').toLowerCase()] || 'közepes';
    const best = cve || src[0];
    const unfixed = v.operator.unfixed === '1' || v.operator.unfixed === 1;
    out.push({
      title: decodeEnt(String(best?.description || best?.name || v.name || '').replace(/^\[[a-z]{2}\]\s*/i, '')).slice(0, 220),
      severity: sev, cvss: v.impact?.cvss3?.score ? +v.impact.cvss3.score : null,
      cve: src.filter(s => /^CVE-/i.test(s.id)).map(s => s.id).slice(0, 3),
      // „< X” esetén X-ben javították; „<= X” esetén az X utáni verzióban; „unfixed”: nincs javítás
      fixedIn: !unfixed && v.operator.max_operator === 'lt' ? v.operator.max_version : null,
      fixedAfter: !unfixed && v.operator.max_operator === 'le' ? v.operator.max_version : null,
      unfixed, url: best?.link || null, type: null,
    });
  }
  const rank = { kritikus: 0, magas: 1, 'közepes': 2, alacsony: 3 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (b.cvss || 0) - (a.cvss || 0)).slice(0, 6);
}

export async function wpvulnVulns(client, R, { cache, maxComponents = 45 } = {}) {
  const items = []; let ok = 0, failed = 0, requests = 0;
  const lookup = async (kind, slug) => {
    const key = `wpv:${kind}:${slug}`;
    const hit = cache?.get(key); if (hit !== undefined) { ok++; return hit; }
    requests++;
    const r = await client.tryGet(`https://www.wpvulnerability.net/${kind}/${encodeURIComponent(slug)}/`, { timeout: 15000, maxRedirects: 1 });
    let j = null; try { j = JSON.parse(r.body); } catch {}
    if (r.status !== 200 || !j || j.error) { failed++; return undefined; }
    const v = Array.isArray(j.data?.vulnerability) ? j.data.vulnerability : [];
    cache?.set(key, v); ok++; return v;
  };
  const comps = [
    ...(R.plugins || []).filter(p => p.version).map(p => ({ kind: 'plugin', slug: p.slug, name: p.name, version: p.version })),
    ...(R.theme || []).filter(t => t.version).slice(0, 3).map(t => ({ kind: 'theme', slug: t.slug, name: t.name, version: t.version })),
  ].slice(0, maxComponents);
  for (const c of comps) {
    const v = await lookup(c.kind, c.slug);
    if (v) for (const a of wpvulnAffecting(v, c.version)) items.push({ kind: c.kind, slug: c.slug, name: c.name, version: c.version, ...a, source: 'WPVulnerability' });
  }
  if (comps.length && ok === 0) return { error: 'A WPVulnerability jelenleg nem érhető el, az ismert sebezhetőségek nem ellenőrizhetők.' };
  return { source: 'WPVulnerability', items, limited: failed > 0, requests };
}

// ================= összevont ellenőrzés: WPVulnerability mindig (plugin, téma), a WPScan kulccsal kiegészíti (core is)
export async function collectVulns(client, R, { cache } = {}) {
  const main = await wpvulnVulns(client, R, { cache });
  let extra = null;
  if (wpscanEnabled()) { try { extra = await wpscanVulns(client, R, { cache }); } catch (e) { extra = { error: e.message }; } }
  if (!extra) return main;
  if (extra.error) return main.error ? extra : { ...main, note: 'WPScan: ' + extra.error };
  if (main.error) return extra;
  // egyesítés: azonos CVE vagy azonos komponens+cím csak egyszer szerepel
  const keyOf = x => ((x.cve?.[0] || `${x.slug}|${x.title}`) + '|' + x.slug).toLowerCase();
  const seen = new Set(main.items.map(keyOf)); const items = [...main.items];
  for (const x of extra.items) if (!seen.has(keyOf(x))) { seen.add(keyOf(x)); items.push({ ...x, source: 'WPScan' }); }
  return { source: 'WPVulnerability + WPScan', items, limited: main.limited || extra.limited, requests: main.requests + extra.requests };
}
