import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePage } from '../lib/pa11y.mjs';
import { aggregateA11y } from '../lib/a11y.mjs';
import { findChrome } from '../lib/browser.mjs';
import { pa11yScan } from '../lib/pa11y.mjs';
import http from 'node:http';

const ax = (code, impact, selector = 'a.x') => ({ code, type: 'error', runner: 'axe', selector, message: code + ' (https://dequeuniversity.com/...)', runnerExtras: { impact, help: 'Angol súgó: ' + code, helpUrl: 'https://x' } });
const hc = (code, selector = 'div') => ({ code, type: 'error', runner: 'htmlcs', selector, message: 'Ez az elem nem felel meg. Javaslat: …', runnerExtras: {} });

test('pa11y-ci eredmény egységesítése: axe súlyossággal és WCAG-kritériummal, HTMLCS súlyosság nélkül, magyar nevekkel', () => {
  const p = normalizePage('https://x.hu/', [
    ax('color-contrast', 'serious'), ax('color-contrast', 'serious', 'p.y'), ax('image-alt', 'critical'),
    hc('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail'), hc('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail', 'span'), hc('WCAG2AA.Principle4.Guideline4_1.4_1_1.F77'), hc('WCAG2A.Principle1.Guideline1_1.1_1_1.H37'),
    { code: 'ismeretlen', runner: 'valami', message: 'x' },
  ]);
  assert.equal(p.error, undefined);
  assert.deepEqual(p.counts, { critical: 1, serious: 1, moderate: 3, minor: 0 }, 'az axe súlyossága szerint; a HTMLCS-észrevételek „közepes”-ként, így nem számítanak súlyosnak');
  const by = Object.fromEntries(p.violations.map(v => [v.id, v]));
  assert.equal(by['color-contrast'].count, 2); assert.deepEqual(by['color-contrast'].wcag, ['1.4.3']); assert.equal(by['color-contrast'].level, 'AA'); assert.equal(by['color-contrast'].engine, 'axe');
  assert.deepEqual(by['image-alt'].wcag, ['1.1.1']);
  const h = by['htmlcs:1.4.3:G18']; assert.equal(h.engine, 'HTMLCS'); assert.equal(h.count, 2); assert.equal(h.impact, 'moderate'); assert.match(h.helpHu, /színkontraszt/); assert.deepEqual(h.wcag, ['1.4.3']);
  assert.match(by['htmlcs:4.1.1:F77'].helpHu, /Ismétlődő azonosító/); assert.equal(by['htmlcs:1.1.1:H37'].level, 'A');
});

test('pa11y-ci: hibás oldal (kivétel) oldalszintű hibaként, üres lista = nincs hiba', () => {
  assert.deepEqual(normalizePage('https://x.hu/', [Object.assign(new Error('Navigation timeout\nrészletek'), {})]).error, 'Navigation timeout');
  const ok = normalizePage('https://x.hu/', []); assert.equal(ok.error, undefined); assert.deepEqual(ok.counts, { critical: 0, serious: 0, moderate: 0, minor: 0 });
});

test('összesítés: a motor szabályonként megmarad, a HTMLCS nem növeli a súlyos oldalak számát', () => {
  const a = aggregateA11y([normalizePage('https://x.hu/1', [hc('WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail')]), normalizePage('https://x.hu/2', [ax('image-alt', 'critical')])], { total: 2 });
  assert.equal(a.pagesWithSevere, 1); assert.equal(a.runner, 'pa11y-ci');
  assert.deepEqual(Object.fromEntries(a.rules.map(r => [r.id, r.engine])), { 'image-alt': 'axe', 'htmlcs:1.4.3:G18': 'HTMLCS' });
});

test('pa11y-ci élesben: valódi oldalak ellenőrzése a helyi Chrome-mal (csak ha van Chrome)', async (t) => {
  const chromePath = findChrome(); if (!chromePath) return t.skip('nincs Chrome ezen a gépen');
  const srv = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(q.url === '/jo' ? '<!doctype html><html lang="hu"><head><title>Rendben</title></head><body><main><h1>Cím</h1><p style="color:#000;background:#fff">Szöveg</p></main></body></html>' : '<!doctype html><html><head><title>x</title></head><body><img src="x.png"><a href="/x"></a><div id="a"></div><div id="a"></div></body></html>'); });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const pages = await pa11yScan([base + '/jo', base + '/rossz'], { chromePath, guarded: false, concurrency: 2 });
    const [jo, rossz] = pages;
    assert.equal(jo.error, undefined); assert.equal(jo.counts.critical + jo.counts.serious, 0, 'a rendes oldalon nincs súlyos hiba');
    assert.ok(rossz.counts.critical + rossz.counts.serious > 0, 'a hibás oldalon súlyos hiba van (alt nélküli kép, név nélküli link)');
    assert.ok(rossz.violations.some(v => v.engine === 'HTMLCS'), 'a második motor is talál észrevételt');
  } finally { srv.close(); }
});

test('bot-védelmi oldal nem lehet „hibátlan”: hibás oldalként jelenik meg, az átmeneti védelem az újrapróbálás után mérhető', async (t) => {
  const chromePath = findChrome(); if (!chromePath) return t.skip('nincs Chrome ezen a gépen');
  let n = 0;
  const srv = http.createServer((q, r) => {
    r.setHeader('content-type', 'text/html');
    if (q.url === '/mindig') return r.end('<!doctype html><html lang="en"><head><title>One moment, please...</title></head><body>Checking your browser</body></html>');
    if (q.url === '/atmeneti' && n++ === 0) return r.end('<!doctype html><html lang="en"><head><title>Just a moment...</title></head><body>x</body></html>');
    r.end('<!doctype html><html><head><title>Valódi oldal</title></head><body><img src="x.png"></body></html>');
  });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const [mindig, atmeneti] = await pa11yScan([base + '/mindig', base + '/atmeneti'], { chromePath, guarded: false, concurrency: 1, retryWaitMs: 200 });
    assert.match(mindig.error, /bot-védelmi oldal/); assert.equal(mindig.counts, undefined, 'nem kap hamis „0 hiba” eredményt');
    assert.equal(atmeneti.error, undefined, 'az újrapróbálás után a valódi oldal mérhető'); assert.ok(atmeneti.counts.critical + atmeneti.counts.serious > 0);
  } finally { srv.close(); }
});
