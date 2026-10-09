import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarizeMessages, hintFor, w3cAvailable, validateFiles } from '../lib/w3c.mjs';
import { summarizeA11y } from '../lib/a11y.mjs';
import { analyze } from '../lib/rules.mjs';
import { checksHtml } from '../public/checks-ui.mjs';
import { compareResults } from '../lib/compare.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const defaults = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'default-settings.json'), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('W3C: az üzenetek csoportosítása, hiba és figyelmeztetés szétválasztása, magyar magyarázat', () => {
  const m = [
    { type: 'error', message: 'Duplicate ID “menu”.', firstLine: 5, extract: '<li id="menu">' }, { type: 'error', message: 'Duplicate ID “logo”.', firstLine: 9 },
    { type: 'error', message: 'Stray end tag “div”.', firstLine: 40 }, { type: 'error', message: 'Attribute “foo” not allowed on element “div” at this point.' },
    { type: 'info', subType: 'warning', message: 'The “type” attribute for the “script” element is unnecessary.' }, { type: 'info', message: 'Csak tájékoztatás' },
  ];
  const s = summarizeMessages(m);
  assert.equal(s.errors, 4); assert.equal(s.warnings, 1);
  assert.equal(s.top[0].count, 2, 'a két „Duplicate ID” egy csoport'); assert.match(s.top[0].hint, /Ismétlődő id/);
  assert.equal(s.top[0].type, 'error'); assert.equal(s.top.at(-1).type, 'warning', 'a hibák a figyelmeztetések előtt');
  assert.match(hintFor('Attribute “x” not allowed on element “y”'), /nem engedélyezett/); assert.equal(hintFor('ismeretlen üzenet'), '');
  assert.deepEqual(summarizeMessages([]), { errors: 0, warnings: 0, top: [] });
});

test('W3C: valódi validátor (csak ha a Java elérhető, pl. a Docker-képben)', async (t) => {
  if (!(await w3cAvailable())) return t.skip('a Java nincs telepítve ezen a gépen');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3c-t-'));
  const bad = path.join(dir, 'rossz.html'), good = path.join(dir, 'jo.html');
  fs.writeFileSync(bad, '<!doctype html><html><head><title>x</title></head><body><div id="a"></div><div id="a"></div></div><img src="x.png"></body></html>');
  fs.writeFileSync(good, '<!doctype html><html lang="hu"><head><meta charset="utf-8"><title>Rendben</title></head><body><main><h1>Cím</h1><p>Szöveg</p></main></body></html>');
  const r = await validateFiles([{ url: 'https://x.hu/rossz', file: bad }, { url: 'https://x.hu/jo', file: good }]);
  const byUrl = Object.fromEntries(r.map(p => [p.url, p]));
  assert.ok(byUrl['https://x.hu/rossz'].errors >= 2, 'ismétlődő id + felesleges záró tag + hiányzó alt');
  assert.equal(byUrl['https://x.hu/jo'].errors, 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('WCAG: a kritériumszámok és a szint kinyerése az axe-címkékből', () => {
  const r = summarizeA11y([
    { id: 'color-contrast', impact: 'serious', help: 'x', count: 5, tags: ['cat.color', 'wcag2aa', 'wcag143'], samples: [] },
    { id: 'image-alt', impact: 'critical', help: 'x', count: 2, tags: ['cat.text-alternatives', 'wcag2a', 'wcag111'], samples: [] },
    { id: 'target-size', impact: 'serious', help: 'x', count: 3, tags: ['cat.sensory-and-visual-cues', 'wcag22aa', 'wcag258'], samples: [] },
    { id: 'reflow-x', impact: 'moderate', help: 'x', count: 1, tags: ['wcag2aa', 'wcag21aa', 'wcag1410'], samples: [] },
    { id: 'region', impact: 'moderate', help: 'Ajánlott', count: 4, tags: ['cat.keyboard', 'best-practice'], samples: [] },
  ]);
  const by = Object.fromEntries(r.violations.map(v => [v.id, v]));
  assert.deepEqual(by['color-contrast'].wcag, ['1.4.3']); assert.equal(by['color-contrast'].level, 'AA');
  assert.deepEqual(by['image-alt'].wcag, ['1.1.1']); assert.equal(by['image-alt'].level, 'A');
  assert.deepEqual(by['target-size'].wcag, ['2.5.8']); assert.equal(by['target-size'].level, 'AA', 'WCAG 2.2');
  assert.deepEqual(by['reflow-x'].wcag, ['1.4.10'], 'kétjegyű harmadik szám is');
  assert.deepEqual(by['region'].wcag, []); assert.equal(by['region'].level, null, 'ajánlott gyakorlat, nem WCAG-kritérium');
  assert.equal(by['color-contrast'].tags, undefined, 'a nyers címkék nem kerülnek tárolásra');
});

test('WCAG és W3C: megállapítás, óraszám, összehasonlítás, escape-elt megjelenítés', () => {
  const a11y = summarizeA11y([{ id: 'image-alt', impact: 'critical', help: 'x', count: 2, tags: ['wcag2a', 'wcag111'], samples: ['<b>x'] }]);
  const R = { domain: 'x.hu', status: 'ok', reach: { status: 200 }, wp: { isWp: true, version: '6.5', latest: '6.5' }, plugins: [], theme: [], detected: { builder: [], seo: [], security: [], cache: [], cookie: [] }, server: {}, security: {}, seo: { title: 'Cím hossza elfogadható cím', titleLen: 25, desc: 'x'.repeat(100), h1: 1, canonical: true, og: true, sitemap: { ok: true }, analytics: { ga4: ['G-1'], ua: [], gtm: [] } }, gdprStatic: {}, a11y,
    a11yPages: [{ url: 'https://x.hu/a/', counts: { critical: 0, serious: 1, moderate: 0, minor: 0 }, violations: [] }, { url: 'https://x.hu/b/', error: 'Az oldal nem töltődött be' }],
    w3c: { validator: 'W3C Nu Html Checker', totals: { errors: 30, warnings: 2, pages: 3 }, pages: [{ url: 'https://x.hu/', errors: 12, warnings: 1, top: [{ type: 'error', count: 9, message: '<img onerror=1> Duplicate ID “a”.', hint: 'Ismétlődő id: egy oldalon minden id legyen egyedi.' }] }] } };
  analyze(R, defaults);
  const a = R.findings.find(f => f.id === 'a11y'); assert.match(a.detail, /WCAG 1\.1\.1/);
  const w = R.findings.find(f => f.id === 'w3c'); assert.equal(w.sev, 'közepes', '10 hiba / oldal fölött közepes'); assert.equal(w.hours, defaults.hours.w3cFix); assert.equal(w.group, 'tartalom');
  assert.match(w.title, /30 hiba/);
  const h = checksHtml(R, { esc });
  assert.match(h, /WCAG 2\.2 AA/); assert.match(h, /1\.1\.1/); assert.match(h, /W3C HTML-validálás/); assert.match(h, /aloldalak/);
  assert.ok(!h.includes('<img onerror') && !h.includes('<b>x'), 'nyers HTML nem maradhat');
  const prev = { ...R, w3c: { totals: { errors: 50, warnings: 0, pages: 3 }, pages: [] } };
  const cmp = compareResults(R, prev);
  const d = cmp.deltas.find(x => x.key === 'w3c'); assert.equal(d.delta, -20); assert.equal(d.better, true);
  R.w3c = { skipped: 'nincs Java' }; analyze(R, defaults); assert.ok(!R.findings.some(f => f.id === 'w3c'), 'kihagyott validálásból nem lesz megállapítás');
  assert.ok(!checksHtml({ w3c: { skipped: 'nincs Java' } }, { esc }).includes('W3C'));
});
