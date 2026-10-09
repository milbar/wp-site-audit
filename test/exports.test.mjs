import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildQuote, logoInfo, brandHex } from '../lib/brand.mjs';
import { exportHtml } from '../lib/export-html.mjs';
import { exportProposals, exportEmails } from '../lib/export-docx.mjs';
import { exportXlsx } from '../lib/export-xlsx.mjs';
import { analyze } from '../lib/rules.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'default-settings.json'), 'utf8'));
// 1×1 px átlátszó PNG
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const site = (domain, extra = {}) => {
  const R = { domain, checkedAt: '2026-01-01T00:00:00Z', status: 'ok', reach: { status: 200, finalUrl: `https://${domain}/` }, wp: { isWp: true, version: '5.0', latest: '6.5', gap: { behind: true, major: 1, minor: 5 } }, plugins: [], theme: [], detected: { builder: [], seo: [], security: [], cache: [], cookie: [] }, server: {}, security: {}, seo: { title: 'Cím', titleLen: 3, desc: '', h1: 1, sitemap: { ok: true }, analytics: { ga4: [], ua: [], gtm: [] } }, gdprStatic: {}, ...extra };
  analyze(R, defaults);
  return { domain, state: 'done', result: R };
};
const run = (sites) => ({ id: 'r1', createdAt: '2026-01-01T00:00:00Z', options: { name: 'Teszt', lighthouse: false }, sites: Object.fromEntries(sites.map(s => [s.domain, s])) });
const docxText = async buf => { const z = await JSZip.loadAsync(buf); return (await z.file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); };

test('árajánlat számítása: óradíj nélkül nincs, óradíjjal nettó, ÁFA és bruttó', () => {
  const S = [{ domain: 'a.hu', totals: { kotelezo: 4, gdpr: 1, seo: 0.5, tartalom: 0 } }, { domain: 'b.hu', totals: { kotelezo: 2, gdpr: 0, seo: 0, tartalom: 1 } }];
  assert.equal(buildQuote(S, { hourlyRate: 0 }), null);
  const q = buildQuote(S, { hourlyRate: 10000, vatPercent: 27, currency: 'Ft' });
  assert.equal(q.total.hoursBase, 6); assert.equal(q.total.netBase, 60000); assert.equal(q.total.vatBase, 16200); assert.equal(q.total.grossBase, 76200);
  assert.equal(q.total.hoursOpt, 2.5); assert.equal(q.total.netOpt, 25000);
  assert.match(q.money(76200), /76\s?200 Ft/);
});

test('arculat: szín ellenőrzése, logó méretének beolvasása', () => {
  assert.equal(brandHex({ brandColor: '#ff0000' }), 'FF0000'); assert.equal(brandHex({ brandColor: 'piros' }), '1F3864'); assert.equal(brandHex({}), '1F3864');
  const l = logoInfo({ logo: 'data:image/png;base64,' + PNG });
  assert.equal(l.type, 'png'); assert.equal(l.height, 36); assert.ok(l.width >= 1);
  assert.equal(logoInfo({ logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }), null);
  assert.equal(logoInfo({ logo: '' }), null);
});

test('html-riport: árajánlat, arculati szín, logó; nyomtatási stílus', () => {
  const settings = { ...defaults, hourlyRate: 15000, brandColor: '#aa2200', logo: 'data:image/png;base64,' + PNG };
  const html = exportHtml(run([site('pelda.hu')]), { settings, print: true });
  assert.match(html, /Árajánlat \(tájékoztató\)/); assert.match(html, /--acc:#aa2200/); assert.match(html, /<img src="data:image\/png/); assert.match(html, /@media print/);
  const none = exportHtml(run([site('pelda.hu')]), { settings: { ...defaults } });
  assert.ok(!/Árajánlat \(tájékoztató\)/.test(none), 'óradíj nélkül nincs árajánlat');
});

test('html-riport: ellenséges oldalból származó szövegek escape-elve', () => {
  const evil = '<img src=x onerror=alert(1)>';
  const s = site('pelda.hu', { seo: { title: evil, titleLen: 5, desc: evil, h1: 1, sitemap: { ok: true }, analytics: { ga4: [], ua: [], gtm: [] } }, wp: { isWp: true, version: '5.0', latest: '6.5', siteName: evil, gap: { behind: true, major: 1, minor: 5 } }, plugins: [{ slug: 'x', name: evil, version: '1', latest: '2', outdated: true }] });
  const html = exportHtml(run([s]), { settings: defaults });
  assert.ok(!html.includes('<img src=x onerror'), 'nyers HTML nem kerülhet a riportba');
});

test('docx: árajánlat és az e-mail-sablonok elkészülnek; blokkolt oldalra IP-engedélyezési levél', async () => {
  const settings = { ...defaults, hourlyRate: 10000, logo: 'data:image/png;base64,' + PNG };
  const blocked = site('vedett.hu', { status: 'blocked', reach: { status: 200, blockedBy: 'One moment, please...' }, wp: { isWp: false } });
  const r = run([site('pelda.hu'), blocked]);
  const prop = await docxText(await exportProposals(r, { settings }));
  assert.match(prop, /Árajánlat \(tájékoztató\)/); assert.match(prop, /pelda\.hu/);
  const mail = await docxText(await exportEmails(r, { settings }));
  assert.match(mail, /engedélyezés kérése/); assert.match(mail, /MÉRŐ IP-CÍM/);
});

test('xlsx: elkészül, az összehasonlító és javaslat-munkalapok megjelennek, ha van adat', async () => {
  const s = site('pelda.hu');
  s.result.compare = { prevDate: '2025-12-01', summary: 'x', deltas: [{ key: 'geo', label: 'GEO-pont', prev: 50, cur: 70, delta: 20, better: true }], newFindings: [{ id: 'n', title: 'Új', sev: 'magas' }], resolvedFindings: [] };
  s.result.aiSuggest = { meta: [{ url: 'https://pelda.hu/a/', path: '/a/', title: { old: 'Régi', new: 'Új cím', len: 6, needed: true, ok: true }, desc: { old: '', new: '', len: 0, needed: false, ok: true } }], faq: [] };
  const buf = await exportXlsx(run([s]), { settings: defaults });
  const z = await JSZip.loadAsync(buf);
  const wb = await z.file('xl/workbook.xml').async('string');
  assert.match(wb, /Változás/); assert.match(wb, /Javasolt szövegek/);
});
