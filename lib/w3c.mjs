// W3C HTML-validálás a hivatalos Nu Html Checkerrel (vnu.jar, Java kell hozzá; a Docker-képben benne van).
// A főoldalt és néhány sitemapből választott oldalt tölti le, helyben validálja: semmi nem megy ki harmadik félhez.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pickSitemapUrls } from './sitemap.mjs';
import { isChallenge } from './challenge.mjs';

const require = createRequire(import.meta.url);
const JAVA = process.env.JAVA_BIN || 'java';
let availability = null;

const jarPath = () => { try { return String(require('vnu-jar')); } catch { return null; } };

export function w3cAvailable() {
  if (availability) return availability;
  availability = new Promise(ok => {
    const jar = jarPath(); if (!jar || !fs.existsSync(jar)) return ok(false);
    let p; try { p = spawn(JAVA, ['-version'], { stdio: 'ignore' }); } catch { return ok(false); }
    p.on('error', () => ok(false)); p.on('close', code => ok(code === 0));
  });
  return availability;
}

// A gyakori hibák magyar magyarázata (az eredeti angol üzenet mellett jelenik meg)
const HINTS = [
  [/Duplicate ID/i, 'Ismétlődő id: egy oldalon minden id legyen egyedi.'],
  [/Stray end tag/i, 'Felesleges záró tag: nincs hozzá nyitó elem.'],
  [/End tag .* seen, but there were open elements|Unclosed element/i, 'Lezáratlan elem: hiányzik egy záró tag.'],
  [/Element .* not allowed as child of/i, 'Szabálytalan elemágyazás (olyan elem került egy másikba, ahová nem szabad).'],
  [/Attribute .* not allowed on element/i, 'Az attribútum nem engedélyezett ezen az elemen.'],
  [/(img|image).*must have an .alt. attribute|must have an .alt. attribute/i, 'A képnek alt attribútum kell (üres is lehet, ha díszkép).'],
  [/Bad value .* for attribute/i, 'Érvénytelen attribútumérték.'],
  [/Consider adding a .lang. attribute/i, 'Hiányzik a lang attribútum a html elemről.'],
  [/The .type. attribute for the .script. element is unnecessary|The .type. attribute for the .style. element is not needed/i, 'Felesleges type attribútum (nem hiba, csak fölösleges).'],
  [/Empty heading/i, 'Üres címsor.'],
  [/obsolete|is not supported/i, 'Elavult (obsolete) HTML-elem vagy attribútum.'],
  [/Section lacks heading/i, 'A section elemnek nincs címsora.'],
  [/Trailing slash on void elements/i, 'Felesleges „/” az önzáró elemeken (nem hiba).'],
  [/Unclosed .* tag|Unexpected end tag/i, 'Hibás tag-szerkezet.'],
  [/charset|encoding/i, 'Karakterkódolás-probléma.'],
  [/CSS:|Property .* doesn't exist/i, 'Érvénytelen CSS az oldalba ágyazva.'],
];
export const hintFor = msg => (HINTS.find(([rx]) => rx.test(msg)) || [])[1] || '';

// az üzenetek összevonása (az idézett nevek eltávolításával): ugyanaz a hiba sokszor ismétlődik
const norm = m => m.replace(/[“"”‘’'][^“"”‘’']*[“"”‘’']/g, '„…”').replace(/\s+/g, ' ').trim();

export function summarizeMessages(messages) {
  const groups = new Map(); let errors = 0, warnings = 0;
  for (const m of messages) {
    const isErr = m.type === 'error';
    const isWarn = m.type === 'info' && m.subType === 'warning';
    if (!isErr && !isWarn) continue;
    if (isErr) errors++; else warnings++;
    const k = (isErr ? 'E' : 'W') + '|' + norm(m.message);
    const g = groups.get(k) || { type: isErr ? 'error' : 'warning', message: m.message, count: 0, line: m.firstLine || m.lastLine || null, extract: String(m.extract || '').replace(/\s+/g, ' ').slice(0, 140) };
    g.count++; groups.set(k, g);
  }
  const top = [...groups.values()].sort((a, b) => (a.type === b.type ? 0 : a.type === 'error' ? -1 : 1) || b.count - a.count).slice(0, 8)
    .map(g => ({ ...g, message: g.message.slice(0, 220), hint: hintFor(g.message) }));
  return { errors, warnings, top };
}

// fájlokban lévő HTML-ek validálása egyetlen Java-futással
export async function validateFiles(files, { timeoutMs = 90000 } = {}) {
  const jar = jarPath();
  return new Promise((ok, bad) => {
    const args = ['-Xmx384m', '-Xss1024k', '-jar', jar, '--format', 'json', '--stdout', '--skip-non-html', ...files.map(f => f.file)];
    let out = '', done = false;
    let p; try { p = spawn(JAVA, args, { stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { return bad(e); }
    const t = setTimeout(() => { if (!done) { done = true; try { p.kill(); } catch {} bad(new Error('A W3C-validálás időtúllépés miatt megszakadt')); } }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.on('error', e => { if (!done) { done = true; clearTimeout(t); bad(e); } });
    p.on('close', () => {
      if (done) return; done = true; clearTimeout(t);
      let j; try { j = JSON.parse(out); } catch { return bad(new Error('A validátor kimenete nem értelmezhető')); }
      const byFile = new Map(files.map(f => [path.basename(f.file), []]));
      for (const m of j.messages || []) { const b = path.basename(decodeURIComponent(String(m.url || '').replace(/^file:/, ''))); if (byFile.has(b)) byFile.get(b).push(m); }
      ok(files.map(f => ({ url: f.url, ...summarizeMessages(byFile.get(path.basename(f.file)) || []) })));
    });
  });
}

// mintaoldalak: főoldal + a GEO-bejárás oldalai (vagy a sitemapből választott oldalak)
export async function collectSamples(client, R, domain, n = 5) {
  const home = R.reach?.finalUrl || `https://${domain}/`;
  let urls = (R.geo?.pages || []).filter(p => !p.failed && p.url !== home).map(p => p.url);
  if (!urls.length) { try { urls = await pickSitemapUrls(client, new URL(home).hostname, { sitemapUrl: R.seo?.sitemap?.ok ? R.seo.sitemap.url : null, homeUrl: home, limit: n - 1 }); } catch { urls = []; } }
  const out = [];
  for (const u of [home, ...urls.slice(0, n - 1)]) {
    const r = await client.tryGet(u, { maxBytes: 1_500_000, timeout: 15000, maxRedirects: 4, headers: { accept: 'text/html' } });
    if (r.status === 200 && /html/i.test(r.headers?.['content-type'] || 'html') && !isChallenge(r) && r.body) out.push({ url: u, html: r.body });
  }
  return out;
}

export async function w3cCheck(client, R, domain, { n = 5 } = {}) {
  if (!(await w3cAvailable())) return { skipped: 'A Java vagy a validátor nem érhető el ezen a gépen.' };
  const samples = await collectSamples(client, R, domain, n);
  if (!samples.length) return { error: 'Nem sikerült mintaoldalt letölteni a validáláshoz.' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-w3c-'));
  try {
    const files = samples.map((s, i) => { const file = path.join(dir, `p${i}-${crypto.randomBytes(3).toString('hex')}.html`); fs.writeFileSync(file, s.html); return { url: s.url, file }; });
    const pages = await validateFiles(files);
    const totals = { errors: pages.reduce((a, p) => a + p.errors, 0), warnings: pages.reduce((a, p) => a + p.warnings, 0), pages: pages.length };
    return { validator: 'W3C Nu Html Checker', pages, totals };
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
