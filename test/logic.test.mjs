import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rateTitle, rateDesc, rateH1, seoRow, seoVerdict } from '../public/seo-explain.mjs';
import { rate, lhRows, verdict } from '../public/lh-explain.mjs';
import { analyzePage, blockedBots } from '../lib/geo.mjs';
import { safeDecode, parseDomains } from '../lib/probe.mjs';
import { cmpVer, gap, createWporg } from '../lib/wporg.mjs';
import { speedPlan } from '../lib/speed-fixes.mjs';
import { buildSolutions } from '../lib/suggest.mjs';
import { cleanText } from '../lib/ai.mjs';

test('title / description értékelése a határok körül', () => {
  assert.equal(rateTitle(0), 'bad'); assert.equal(rateTitle(14), 'bad'); assert.equal(rateTitle(15), 'mid');
  assert.equal(rateTitle(30), 'good'); assert.equal(rateTitle(60), 'good'); assert.equal(rateTitle(61), 'mid'); assert.equal(rateTitle(76), 'bad');
  assert.equal(rateTitle(45, true), 'mid', 'az ismétlődő jó cím csak közepes');
  assert.equal(rateDesc(0), 'bad'); assert.equal(rateDesc(39), 'bad'); assert.equal(rateDesc(40), 'mid');
  assert.equal(rateDesc(70), 'good'); assert.equal(rateDesc(160), 'good'); assert.equal(rateDesc(161), 'mid'); assert.equal(rateDesc(201), 'bad');
  assert.equal(rateDesc(100, false, true), 'bad', 'a címmel azonos leírás rossz');
  assert.equal(rateH1(1), 'good'); assert.equal(rateH1(0), 'bad'); assert.equal(rateH1(2), 'mid');
});

test('Lighthouse-mérőszámok értékelése', () => {
  assert.equal(rate('perf', 90), 'good'); assert.equal(rate('perf', 50), 'mid'); assert.equal(rate('perf', 49), 'bad');
  assert.equal(rate('lcp', 2.5), 'good'); assert.equal(rate('lcp', 4), 'mid'); assert.equal(rate('lcp', 4.1), 'bad');
  assert.equal(rate('cls', 0.1), 'good'); assert.equal(rate('cls', 0.26), 'bad'); assert.equal(rate('tbt', 600), 'mid');
  assert.equal(rate('lcp', null), null);
});

test('oldalelemzés: title, description, címsorok, strukturált adat', () => {
  const html = `<!doctype html><html lang="hu"><head><title>Teszt oldal a méréshez és a pontozáshoz – Cég</title><meta name="description" content="Ez egy elég hosszú leírás, amely a teszthez készült és meghaladja a hetven karaktert."><link rel="canonical" href="/"><meta property="og:title" content="x"><meta property="og:description" content="y">
  <script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Cég","sameAs":["https://facebook.com/x"]},{"@type":"BreadcrumbList"}]}</script></head><body><main><h1>Főcím</h1><h2>Alcím?</h2><p>${'szó '.repeat(200)}</p><ul><li>a</li></ul></main></body></html>`;
  const p = analyzePage(html, 'https://example.com/');
  assert.equal(p.lang, 'hu'); assert.equal(p.h1, 1); assert.ok(p.words >= 200); assert.equal(p.canonical, true); assert.equal(p.og, true);
  assert.ok(p.ld.types.includes('Organization') && p.ld.types.includes('BreadcrumbList')); assert.equal(p.ld.invalid, 0); assert.equal(p.ld.sameAs, true);
  assert.ok(p.score >= 80, 'pontszám: ' + p.score);
  const row = seoRow({ ...p, titleLen: p.title.length, descLen: p.desc.length });
  assert.equal(row.title.rating, 'good'); assert.equal(row.desc.rating, 'good');
});

test('oldalelemzés: hibás JSON-LD és hiányzó elemek nem dobnak hibát', () => {
  const p = analyzePage('<html><head><script type="application/ld+json">{nem json</script></head><body></body></html>', 'https://example.com/');
  assert.equal(p.ld.invalid, 1); assert.equal(p.h1, 0); assert.equal(p.lang, '');
  assert.ok(p.issues.length > 0);
});

test('robots.txt: kifejezetten tiltott AI-botok felismerése', () => {
  assert.deepEqual(blockedBots('User-agent: GPTBot\nDisallow: /\n\nUser-agent: *\nAllow: /'), ['GPTBot']);
  assert.deepEqual(blockedBots('User-agent: ClaudeBot\nUser-agent: CCBot\nDisallow: /'), ['ClaudeBot', 'CCBot']);
  assert.deepEqual(blockedBots('User-agent: GPTBot\nDisallow: /privat/'), []);
  assert.deepEqual(blockedBots('User-agent: *\nDisallow: /'), ['* (minden bot)']);
  assert.deepEqual(blockedBots(''), []);
});

test('hibás %-kódolású hivatkozás nem dob hibát', () => {
  assert.equal(safeDecode('/akcio-100%'), '/akcio-100%');
  assert.equal(safeDecode('/%E0%A4%A'), '/%E0%A4%A');
  assert.equal(safeDecode('/a%20b'), '/a b');
});

test('domainlista értelmezése', () => {
  assert.deepEqual(parseDomains('Example.com, https://foo.hu/x\n# megjegyzés\nfoo.hu bar'), ['example.com', 'foo.hu']);
});

test('verzió-összehasonlítás és elmaradás', () => {
  assert.ok(cmpVer('6.1.7', '6.2.1') < 0); assert.equal(cmpVer('1.0', '1.0.0'), 0); assert.ok(cmpVer('2.0', '1.9.9') > 0);
  assert.equal(gap('6.1.7', '6.2.1').behind, true); assert.equal(gap('6.2.1', '6.2.1').behind, false);
  assert.doesNotThrow(() => gap('6.1.7-beta', '6.2.1'));
});

test('wordpress.org-cache: az átmeneti hiba nem kerül gyorsítótárba, a valódi 404 igen', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'wporg-')), 'c.json');
  let mode = 'fail', calls = 0;
  const client = { tryGet: async () => { calls++; if (mode === 'fail') return { status: 0, body: '', error: 'timeout' }; if (mode === '429') return { status: 429, body: '' }; if (mode === '404') return { status: 404, body: '{"error":"Plugin not found."}' }; return { status: 200, body: '{"version":"2.0","name":"X"}' }; } };
  const w = createWporg(client, file);
  assert.equal(await w.plugin('x'), null, 'hibánál null');
  mode = '429'; assert.equal(await w.plugin('x'), null);
  mode = 'ok'; assert.deepEqual((await w.plugin('x')).version, '2.0', 'a hiba után újra lekéri, nem a hibát őrzi');
  const before = calls; await w.plugin('x'); assert.equal(calls, before, 'a sikeres válasz gyorsítótárban');
  mode = '404'; assert.deepEqual(await w.plugin('nincs'), { notOnWporg: true });
  const b2 = calls; await w.plugin('nincs'); assert.equal(calls, b2, 'a valódi 404 is gyorsítótárban');
});

test('sebesség-terv: a Lighthouse-tételekből konkrét lépések', () => {
  const R = { reach: { finalUrl: 'https://x.hu/' }, detected: { builder: ['Elementor'], cache: ['LiteSpeed Cache'] }, lighthouse: { device: 'mobile', perf: 40, lcp: 12, tbt: 700, cls: 0.3, totalKB: 9000, serverMs: 900, opportunities: [{ id: 'modern-image-formats', title: 'Képek', savingsMs: 6000 }, { id: 'ismeretlen-azonosito', title: 'x', savingsMs: 9000 }] } };
  const sp = speedPlan(R);
  const ids = sp.items.map(i => i.id);
  assert.ok(ids.includes('modern-image-formats')); assert.ok(!ids.includes('ismeretlen-azonosito'));
  assert.ok(ids.includes('server-response-time') && ids.includes('bootup-time') && ids.includes('total-byte-weight') && ids.includes('unsized-images'));
  assert.ok(sp.context.some(c => /LiteSpeed Cache/.test(c)) && sp.context.some(c => /Elementor/.test(c)));
  assert.match(verdict(lhRows(R)[0]), /lassú/);
});

test('megoldás-vázlatok: JSON-LD és llms.txt csak akkor, ha hiányoznak', () => {
  const geo = { findings: [{ id: 'geo-org' }, { id: 'geo-llms' }], facts: { siteName: 'Cég', description: 'Leírás', tel: '+3612345', sameAs: [] }, pages: [{ url: 'https://x.hu/', title: 'Kezdőlap', desc: 'Leírás' }] };
  const sol = buildSolutions({ reach: { finalUrl: 'https://x.hu/' }, geo }, 'x.hu');
  assert.equal(JSON.parse(sol.jsonld.json)['@type'], 'Organization'); assert.equal(JSON.parse(sol.jsonld.json).telephone, '+3612345');
  assert.match(sol.llms.text, /^# Cég/); assert.match(sol.llms.text, /\[Kezdőlap\]\(https:\/\/x\.hu\/\)/);
  const none = buildSolutions({ reach: { finalUrl: 'https://x.hu/' }, geo: { findings: [], facts: {}, pages: [] } }, 'x.hu');
  assert.equal(none.jsonld, null); assert.equal(none.llms, null);
});

test('MI-szöveg tisztítása: markdown eltávolítása, üres sorok megőrzése', () => {
  assert.equal(cleanText('## Cím\n\nÖsszkép: **fontos** `x`\n\n*   elem\n1.  Első'), 'Összkép: fontos x\n\n- elem\n1. Első');
  assert.equal(cleanText('<think>gondolat</think>Válasz'), 'Válasz');
});

test('seoVerdict: összegzés az oldalmintáról', () => {
  const t = seoVerdict([{ title: 'a'.repeat(45), titleLen: 45, desc: '', descLen: 0, h1: 1, canonical: true, words: 400, score: 90 }, { title: '', titleLen: 0, desc: '', descLen: 0, h1: 0, canonical: false, words: 50, score: 30 }]);
  assert.match(t, /meta description/); assert.match(t, /H1/);
});
