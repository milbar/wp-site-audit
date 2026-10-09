import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listSitemapUrls, pickSitemapUrls } from '../lib/sitemap.mjs';
import { aggregateA11y, summarizeA11y } from '../lib/a11y.mjs';
import { runBrowserJob } from '../lib/browser-job.mjs';
import { analyze } from '../lib/rules.mjs';
import { checksHtml } from '../public/checks-ui.mjs';
import { cleanSchedule } from '../lib/scheduler.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'default-settings.json'), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const urlset = (...paths) => `<?xml version="1.0"?><urlset>${paths.map(p => `<url><loc>https://x.hu${p}</loc></url>`).join('')}</urlset>`;
const index = (...subs) => `<sitemapindex>${subs.map(s => `<sitemap><loc>https://x.hu/${s}.xml</loc></sitemap>`).join('')}</sitemapindex>`;
const mockClient = files => ({ tryGet: async u => (files[u] ? { status: 200, body: files[u] } : { status: 404, body: '' }) });

test('teljes sitemap: az összes oldal beolvasása több gyermek-sitemapből, a főoldal, a fájlok és a más hoszt nélkül', async () => {
  const c = mockClient({
    'https://x.hu/sitemap_index.xml': index('page-sitemap', 'post-sitemap', 'category-sitemap'),
    'https://x.hu/page-sitemap.xml': urlset('/', '/rolunk/', '/kapcsolat/', '/kep.jpg'),
    'https://x.hu/post-sitemap.xml': urlset('/a/', '/b/', '/c/', '/rolunk/'),
  });
  const r = await listSitemapUrls(c, 'x.hu', { homeUrl: 'https://x.hu/', max: 100 });
  assert.deepEqual([...r.urls].sort(), ['https://x.hu/a/', 'https://x.hu/b/', 'https://x.hu/c/', 'https://x.hu/kapcsolat/', 'https://x.hu/rolunk/']);
  assert.equal(r.total, 5); assert.equal(r.truncated, false);
  const cut = await listSitemapUrls(c, 'x.hu', { homeUrl: 'https://x.hu/', max: 3 });
  assert.equal(cut.urls.length, 3); assert.equal(cut.total, 5); assert.equal(cut.truncated, true);
  assert.equal(new Set(cut.urls.map(u => u.includes('/a/') || u.includes('/b/') || u.includes('/c/'))).size, 2, 'a típusok váltogatva kerülnek be (nem csak az első sitemapből)');
  assert.deepEqual((await listSitemapUrls(mockClient({}), 'x.hu', { max: 10 })), { urls: [], total: 0, truncated: false });
  assert.equal((await pickSitemapUrls(c, 'x.hu', { homeUrl: 'https://x.hu/', limit: 2 })).length, 2, 'a meglévő, korlátos választás változatlan');
});

test('összesítés: szabályonként érintett oldalak és elemek, a legrosszabb elöl, hibás oldalak külön', () => {
  const pg = (url, vs) => ({ url, ...summarizeA11y(vs) });
  const v = (id, impact, count, tags) => ({ id, impact, help: id, count, tags, samples: [] });
  const pages = [
    pg('https://x.hu/1', [v('color-contrast', 'serious', 4, ['wcag2aa', 'wcag143']), v('image-alt', 'critical', 2, ['wcag2a', 'wcag111'])]),
    pg('https://x.hu/2', [v('color-contrast', 'serious', 6, ['wcag2aa', 'wcag143'])]),
    pg('https://x.hu/3', []), { url: 'https://x.hu/4', error: 'nem töltődött be' },
  ];
  const a = aggregateA11y(pages, { total: 10, truncated: true });
  assert.equal(a.checked, 3); assert.equal(a.failed, 1); assert.equal(a.total, 10); assert.equal(a.truncated, true);
  assert.equal(a.pagesWithSevere, 2); assert.deepEqual(a.counts, { critical: 1, serious: 2, moderate: 0, minor: 0 });
  assert.equal(a.rules[0].id, 'image-alt', 'a kritikus az első');
  const cc = a.rules.find(r => r.id === 'color-contrast'); assert.equal(cc.pages, 2); assert.equal(cc.elements, 10); assert.deepEqual(cc.wcag, ['1.4.3']);
  assert.equal(a.pages.length, 4); assert.equal(a.pages[3].error, 'nem töltődött be'); assert.deepEqual(a.pages[0].rules, ['image-alt', 'color-contrast'].sort((x, y) => (x === 'image-alt' ? -1 : 1)));
  assert.equal(a.pages[0].violations, undefined, 'az oldalankénti részletek nem tárolódnak');
});

test('kötegelt böngészős feladat: csak a megadott oldalak, hibát nem dob, lépéseket jelez', async () => {
  // a Chrome nélkül futtatható út: üres lista
  const steps = [];
  const out = await runBrowserJob({}, { domain: 'x.hu', url: 'https://x.hu/', status: 'ok', options: { a11yBatch: true }, a11yUrls: [] }, { onStep: s => steps.push(s) });
  assert.deepEqual(out, { a11yPages: [] });
  const stopped = await runBrowserJob({}, { domain: 'x.hu', url: 'https://x.hu/', status: 'ok', options: { a11yBatch: true }, a11yUrls: ['https://x.hu/a/'] }, { shouldStop: () => true });
  assert.deepEqual(stopped.a11yPages, [], 'leállításkor nem indít új oldalt');
  const failing = await runBrowserJob({ browser: null }, { domain: 'x.hu', url: 'https://x.hu/', status: 'ok', options: { a11yBatch: true }, a11yUrls: ['https://x.hu/a/', 'https://x.hu/b/'] }, { onStep: s => steps.push(s) });
  assert.equal(failing.a11yPages.length, 2); assert.ok(failing.a11yPages.every(p => p.error), 'a hiba oldalanként rögzül, a feladat nem bukik el');
  assert.ok(steps.includes('Akadálymentesség: 2 / 2'));
});

test('megállapítás, megjelenítés (escape-elve) és az ütemezés beállításai', () => {
  const all = aggregateA11y([{ url: 'https://x.hu/<b>', counts: { critical: 1, serious: 1, moderate: 0, minor: 0 }, violations: [{ id: 'image-alt', impact: 'critical', helpHu: '<script>x</script> Képek', fixHu: 'alt', count: 3, wcag: ['1.1.1'], level: 'A' }] }, { url: 'https://x.hu/ok/', counts: { critical: 0, serious: 0, moderate: 0, minor: 0 }, violations: [] }], { total: 2 });
  const R = { domain: 'x.hu', status: 'ok', reach: { status: 200 }, wp: { isWp: true, version: '6.5', latest: '6.5' }, plugins: [], theme: [], detected: { builder: [], seo: [], security: [], cache: [], cookie: [] }, server: {}, security: {}, seo: { title: 'Cím hossza elfogadható cím', titleLen: 25, desc: 'x'.repeat(100), h1: 1, canonical: true, og: true, sitemap: { ok: true }, analytics: { ga4: ['G-1'], ua: [], gtm: [] } }, gdprStatic: {}, a11yAll: all };
  analyze(R, defaults);
  const f = R.findings.find(x => x.id === 'a11y-site');
  assert.equal(f.sev, 'magas'); assert.match(f.title, /1 \/ 2 vizsgált oldalon/); assert.equal(f.hours, defaults.hours.a11ySite); assert.equal(f.group, 'tartalom');
  const h = checksHtml(R, { esc });
  assert.match(h, /a teljes sitemap/); assert.match(h, /1 \/ 2/); assert.match(h, /Minden vizsgált oldal \(2\)/);
  assert.ok(!h.includes('<script>') && !h.includes('/<b>'), 'nyers HTML nem maradhat');
  assert.match(checksHtml({ a11yAllNote: 'A sitemap nem olvasható' }, { esc }), /sitemap nem olvasható/);
  const s = cleanSchedule({ options: { a11y: true, a11yAll: 1, a11yMax: 9999 } });
  assert.equal(s.options.a11yAll, true); assert.equal(s.options.a11yMax, 300, 'a felső korlát 300');
  assert.equal(cleanSchedule({ options: { a11yMax: 1 } }).options.a11yMax, 5);
});
