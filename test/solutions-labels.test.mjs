import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { solHtml } from '../public/solutions-ui.mjs';
import { exportProposals } from '../lib/export-docx.mjs';
import { analyze } from '../lib/rules.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'default-settings.json'), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const meta = [{ url: 'https://x.hu/a/', path: '/a/', spell: [], spellChecked: true,
  title: { old: 'Régi cím', new: 'Új, jobb cím az oldalhoz', len: 25, needed: true, ok: true },
  desc: { old: '', new: 'Új leírás, amely elég hosszú és hasznos a látogatónak, valamint nem ismétli a címet.', len: 85, needed: true, ok: true } }];

test('a javaslat-táblában a title és a description külön „Mező” oszlopban, jól látható címkével szerepel', () => {
  const h = solHtml({ aiSuggest: { meta, faq: [] } }, { esc });
  assert.match(h, /<th>Mező<\/th>/);
  assert.match(h, /<span class="ftag ftag-t">TITLE<\/span>/); assert.match(h, /<span class="ftag ftag-d">DESCRIPTION<\/span>/);
  assert.match(h, /oldalcím/); assert.match(h, /meta leírás/);
  // sorrend: az oldal, majd a mező, majd a jelenlegi és a javasolt
  const row = h.match(/<tr><td[^>]*>\/a\/<\/td><td>(.*?)<\/td><td>(.*?)<\/td><td>(.*?)<\/td><\/tr>/);
  assert.ok(row, 'a sor négy oszlopos'); assert.match(row[1], /TITLE/); assert.match(row[2], /Régi cím/); assert.match(row[3], /Új, jobb cím/);
});

test('docx: külön „Mező” oszlop TITLE / DESCRIPTION felirattal', async () => {
  const R = { domain: 'x.hu', checkedAt: 'x', status: 'ok', reach: { status: 200, finalUrl: 'https://x.hu/' }, wp: { isWp: true, version: '6.5', latest: '6.5' }, plugins: [], theme: [], detected: { builder: [], seo: [], security: [], cache: [], cookie: [] }, server: {}, security: {}, seo: { title: 'Cím hossza elfogadható cím', titleLen: 25, desc: 'x'.repeat(100), h1: 1, canonical: true, og: true, sitemap: { ok: true }, analytics: { ga4: ['G-1'], ua: [], gtm: [] } }, gdprStatic: {}, aiSuggest: { meta, faq: [], model: 'teszt' } };
  analyze(R, defaults);
  const run = { id: 'r', createdAt: '2026-01-01T00:00:00Z', options: { name: 'T' }, sites: { 'x.hu': { domain: 'x.hu', state: 'done', result: R } } };
  const buf = await exportProposals(run, { settings: defaults });
  const xml = (await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string')).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  assert.match(xml, /Mező/); assert.match(xml, /TITLE \(oldalcím\)/); assert.match(xml, /DESCRIPTION \(meta leírás\)/); assert.match(xml, /Új, jobb cím az oldalhoz/);
});
