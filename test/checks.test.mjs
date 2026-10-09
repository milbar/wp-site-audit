import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { summarizeA11y } from '../lib/a11y.mjs';
import { collectLinks, linkCheck } from '../lib/links.mjs';
import { parseSpf, parseDmarc, mailCheck } from '../lib/dnsmail.mjs';
import { affecting, wpscanVulns, createVulnCache } from '../lib/vulns.mjs';
import { parseCrux, cruxLookup } from '../lib/crux.mjs';
import { createClient } from '../lib/http.mjs';
import { analyze } from '../lib/rules.mjs';
import { checksHtml } from '../public/checks-ui.mjs';
import { misspelled, spellAvailable } from '../lib/spell.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'default-settings.json'), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('axe-eredmény összegzése: rendezés súlyosság szerint, magyar nevek', () => {
  const r = summarizeA11y([
    { id: 'image-alt', impact: 'critical', help: 'Images must have alt', count: 3, samples: ['img.a'] },
    { id: 'color-contrast', impact: 'serious', help: 'x', count: 10, samples: [] },
    { id: 'ismeretlen-szabaly', impact: 'minor', help: 'Eredeti angol', count: 1, samples: [] },
  ]);
  assert.deepEqual(r.counts, { critical: 1, serious: 1, moderate: 0, minor: 1 });
  assert.equal(r.violations[0].id, 'image-alt'); assert.match(r.violations[0].helpHu, /alt/); assert.ok(r.violations[0].fixHu);
  assert.equal(r.violations.at(-1).helpHu, 'Eredeti angol', 'ismeretlen szabálynál az eredeti szöveg marad');
  assert.equal(r.nodes, 14);
});

test('linkek: gyűjtés (belső / külső, kihagyott sémák) és ellenőrzés helyi szerverrel', async () => {
  const srv = http.createServer((q, r) => {
    if (q.url === '/ok') { r.end('ok'); return; }
    if (q.url === '/hianyzik') { r.writeHead(404).end(); return; }
    if (q.url === '/hiba') { r.writeHead(500).end(); return; }
    if (q.url === '/tiltott') { r.writeHead(403).end(); return; }
    if (q.url === '/a') { r.writeHead(301, { location: '/b' }).end(); return; }
    if (q.url === '/b') { r.writeHead(301, { location: '/c' }).end(); return; }
    if (q.url === '/c') { r.writeHead(301, { location: '/d' }).end(); return; }
    if (q.url === '/d') { r.writeHead(301, { location: '/ok' }).end(); return; }
    r.writeHead(404).end();
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const pages = [{ url: base + '/', links: [['/ok', ''], ['/hianyzik', ''], ['/hiba', ''], ['/a', ''], ['mailto:x@y.hu', ''], ['tel:+36', ''], ['#horgony', ''], ['javascript:void(0)', ''], ['/wp-admin/x', ''], ['/ok#reszlet', ''], ['/tiltott', '']] }];
    const set = collectLinks(pages, base + '/');
    assert.deepEqual(set.internal.map(x => new URL(x.url).pathname).sort(), ['/a', '/hianyzik', '/hiba', '/ok', '/tiltott']);
    assert.equal(set.external.length, 0);
    const r = await linkCheck(createClient({ delayMs: 0 }), set);
    assert.deepEqual(r.brokenInternal.map(x => new URL(x.url).pathname).sort(), ['/hianyzik', '/hiba']);
    assert.equal(r.redirectChains.length, 1); assert.ok(r.redirectChains[0].hops >= 3);
    assert.equal(r.restricted, 1, 'a 403 nem törött link');
  } finally { srv.close(); }
});

test('SPF és DMARC értelmezése', () => {
  assert.equal(parseSpf('v=spf1 include:_spf.google.com ~all').policy, '~all');
  assert.equal(parseSpf('v=spf1 a mx -all').policy, '-all');
  assert.equal(parseSpf('v=spf1 +all').policy, '+all');
  assert.equal(parseSpf('v=spf1 a mx').policy, null);
  assert.equal(parseSpf('v=spf1 include:a include:b include:c a mx').lookups, 5);
  assert.deepEqual(parseDmarc('v=DMARC1; p=Reject; pct=50; rua=mailto:r@x.hu'), { record: 'v=DMARC1; p=Reject; pct=50; rua=mailto:r@x.hu', policy: 'reject', pct: 50, rua: 'mailto:r@x.hu' });
  assert.equal(parseDmarc(undefined), null);
});

test('e-mail hitelesítés: hiányzó SPF és DMARC jelzése csak MX esetén', async () => {
  const mk = (txtMap, mx) => ({ resolveMx: async () => mx, resolveTxt: async n => { if (txtMap[n]) return txtMap[n].map(x => [x]); const e = new Error('nincs'); e.code = 'ENODATA'; throw e; } });
  const noMx = await mailCheck('x.hu', mk({}, []));
  assert.equal(noMx.hasMx, false); assert.equal(noMx.issues.length, 0, 'MX nélkül nincs e-mail hiba');
  const bare = await mailCheck('x.hu', mk({}, [{ exchange: 'mx.x.hu', priority: 10 }]));
  assert.deepEqual(bare.issues.map(i => i.id).sort(), ['dmarc-missing', 'spf-missing']);
  const good = await mailCheck('x.hu', mk({ 'x.hu': ['v=spf1 -all'], '_dmarc.x.hu': ['v=DMARC1; p=reject'], 'google._domainkey.x.hu': ['v=DKIM1; k=rsa; p=ABC'] }, [{ exchange: 'mx.x.hu', priority: 10 }]));
  assert.equal(good.issues.length, 0); assert.deepEqual(good.dkim, ['google']);
  const weak = await mailCheck('x.hu', mk({ 'x.hu': ['v=spf1 +all'], '_dmarc.x.hu': ['v=DMARC1; p=none'] }, [{ exchange: 'mx', priority: 1 }]));
  assert.ok(weak.issues.some(i => i.id === 'spf-weak') && weak.issues.some(i => i.id === 'dmarc-none'));
});

test('sebezhetőségek: csak a telepített verziót érintők, token nélkül nem fut', async () => {
  const v = [{ id: 1, title: 'Régi hiba', fixed_in: '2.0', vuln_type: 'XSS', cvss: { severity: 'high', score: 7.1 }, references: { cve: ['2024-1'] } }, { id: 2, title: 'Javítatlan', fixed_in: null }, { id: 3, title: 'Már javított', fixed_in: '1.0' }];
  const a = affecting(v, '1.5');
  assert.deepEqual(a.map(x => x.title), ['Régi hiba', 'Javítatlan']);
  assert.equal(a[0].severity, 'magas'); assert.deepEqual(a[0].cve, ['CVE-2024-1']);
  delete process.env.WPSCAN_API_TOKEN;
  assert.equal(await wpscanVulns({}, { plugins: [] }), null);
  process.env.WPSCAN_API_TOKEN = 'teszt';
  try {
    const cacheFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vc-')), 'c.json');
    let calls = 0;
    const client = { tryGet: async url => { calls++; if (/plugins\/hibas/.test(url)) return { status: 200, body: JSON.stringify({ hibas: { vulnerabilities: v } }) }; return { status: 404, body: '' }; } };
    const R = { wp: { version: '6.5' }, plugins: [{ slug: 'hibas', name: 'Hibás', version: '1.5' }, { slug: 'tiszta', name: 'Tiszta', version: '3.0' }], theme: [] };
    const out = await wpscanVulns(client, R, { cache: createVulnCache(cacheFile) });
    assert.equal(out.items.length, 2); assert.equal(out.items[0].slug, 'hibas');
    const before = calls; await wpscanVulns(client, R, { cache: createVulnCache(cacheFile) }); assert.equal(calls, before, 'a második futás gyorsítótárból dolgozik');
    const lim = await wpscanVulns({ tryGet: async () => ({ status: 429, body: '' }) }, R, {});
    assert.equal(lim.limited, true); assert.equal(lim.items.length, 0);
    const bad = await wpscanVulns({ tryGet: async () => ({ status: 401, body: '' }) }, R, {});
    assert.match(bad.error, /API-kulcs/);
  } finally { delete process.env.WPSCAN_API_TOKEN; }
});

test('CrUX: válasz értelmezése, kulcs nélkül nem fut, hibák kezelése', async () => {
  const j = { record: { metrics: { largest_contentful_paint: { percentiles: { p75: 3200 }, histogram: [{ density: 0.6 }, { density: 0.25 }, { density: 0.15 }] }, cumulative_layout_shift: { percentiles: { p75: '0.08' }, histogram: [{ density: 0.9 }, { density: 0.05 }, { density: 0.05 }] }, interaction_to_next_paint: { percentiles: { p75: 180 } } } } };
  const p = parseCrux(j);
  assert.equal(p.lcp.p75, 3200); assert.equal(p.lcp.good, 60); assert.equal(p.cls.p75, 0.08); assert.equal(p.inp.p75, 180);
  assert.equal(parseCrux({}), null);
  delete process.env.GOOGLE_API_KEY;
  assert.equal(await cruxLookup({}, 'https://x.hu'), null);
  process.env.GOOGLE_API_KEY = 'teszt';
  try {
    assert.match((await cruxLookup({ postJson: async () => ({ status: 403, body: '' }) }, 'https://x.hu')).error, /API-kulcs/);
    const r = await cruxLookup({ postJson: async (u, b) => (b.formFactor === 'PHONE' ? { status: 200, body: JSON.stringify(j) } : { status: 404, body: '' }) }, 'https://x.hu');
    assert.equal(r.phone.lcp.p75, 3200); assert.match(r.desktop.error, /nincs elég/i);
  } finally { delete process.env.GOOGLE_API_KEY; }
});

test('szabályok: az új mérésekből megállapítás és óraszám lesz', () => {
  const R = { domain: 'x.hu', status: 'ok', reach: { status: 200 }, wp: { isWp: true, version: '6.5', latest: '6.5' }, plugins: [], theme: [], detected: { builder: [], seo: [], security: [], cache: [], cookie: [] }, server: {}, security: {}, seo: { title: 'Cím hossza elfogadható cím', titleLen: 25, desc: 'x'.repeat(100), h1: 1, canonical: true, og: true, sitemap: { ok: true }, analytics: { ga4: ['G-1'], ua: [], gtm: [] } }, gdprStatic: {},
    a11y: { counts: { critical: 1, serious: 2, moderate: 0, minor: 0 }, total: 3, nodes: 9, violations: [{ id: 'image-alt', impact: 'critical', helpHu: 'Képek alt nélkül', fixHu: 'Adj alt szöveget.', count: 5, samples: [] }] },
    links: { checked: 10, brokenInternal: [{ url: 'https://x.hu/a', status: 404 }], brokenExternal: [], redirectChains: [], restricted: 0 },
    mail: { hasMx: true, issues: [{ id: 'spf-missing', sev: 'közepes', title: 'Nincs SPF-rekord', detail: 'd', fix: 'f' }, { id: 'dmarc-none', sev: 'alacsony', title: 'DMARC csak figyel', detail: 'd', fix: 'f' }] },
    domainExp: { expires: '2026-12-01', daysLeft: 20, registrar: 'Reg' },
    vulns: { items: [{ kind: 'plugin', slug: 'p', name: 'P', version: '1', title: 'RCE', severity: 'kritikus', fixedIn: '2', cve: ['CVE-1'] }] } };
  analyze(R, defaults);
  const f = id => R.findings.find(x => x.id === id || x.id.startsWith(id));
  assert.equal(f('a11y').sev, 'magas'); assert.equal(f('a11y').hours, defaults.hours.a11yFix);
  assert.equal(f('links-internal').group, 'tartalom');
  assert.equal(f('mail-spf-missing').hours, defaults.hours.mailFix); assert.equal(f('mail-dmarc-none').hours, defaults.hours.mailTune); assert.equal(f('mail-spf-missing').group, 'domain');
  assert.equal(f('domain-expiry').sev, 'magas');
  assert.equal(f('vuln-p').sev, 'kritikus'); assert.equal(f('vuln-p').group, 'kotelezo');
  assert.ok(R.totals.tartalom >= defaults.hours.a11yFix + defaults.hours.linkFix + defaults.hours.mailFix, 'a domain-csoport a tartalom-összegbe is beszámít');
});

test('a további mérések HTML-je escape-el', () => {
  const R = { a11y: { counts: { critical: 1, serious: 0, moderate: 0, minor: 0 }, total: 1, nodes: 1, violations: [{ id: 'x', impact: 'critical', helpHu: '<script>alert(1)</script>', fixHu: '"><img src=x>', count: 1, samples: ['<b>'] }] }, links: { checked: 1, internalTotal: 1, externalTotal: 0, brokenInternal: [{ url: 'https://x.hu/"><svg onload=1>', status: 404, from: '<i>' }], brokenExternal: [], redirectChains: [], restricted: 0 } };
  const h = checksHtml(R, { esc });
  assert.ok(!h.includes('<script>') && !h.includes('<img') && !h.includes('<svg'), 'nyers HTML nem maradhat');
  assert.equal(checksHtml({}, { esc }), '');
});

test('helyesírás-ellenőrzés: ha a Hunspell elérhető, felismeri a nem létező szót', async (t) => {
  if (!(await spellAvailable())) return t.skip('a Hunspell és a magyar szótár nincs telepítve ezen a gépen (a Docker-képben igen)');
  const bad = await misspelled('Élményök és tapasztalmakat');
  assert.ok(bad.includes('Élményök') && bad.includes('tapasztalmakat'));
  assert.deepEqual(await misspelled('A kellemes idősotthon biztonságos környezetet nyújt.'), []);
});
