import fs from 'node:fs';
import path from 'node:path';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, HeadingLevel, LevelFormat, BorderStyle, Footer, PageNumber, PageBreak, ImageRun } from 'docx';
import { summarize, sortSites, fmtH, STATUS_HU } from './summary.mjs';
import { GROUPS } from './rules.mjs';
import { brandHex, logoInfo, buildQuote } from './brand.mjs';
import * as LHX from '../public/lh-explain.mjs';
import * as SX from '../public/seo-explain.mjs';
import { solDocx } from './solutions-docx.mjs';
import { checksDocx } from './checks-docx.mjs';

const FONT = 'Arial', W = 9638;
let BRAND = '1F3864'; // az exportok elején az arculati színre állítjuk
const SEVC = { kritikus: 'F8CBAD', magas: 'FCE4D6', 'közepes': 'FFF2CC', alacsony: 'E2EFDA', info: 'EDEDED' };
const border = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
const borders = { top: border, bottom: border, left: border, right: border };
const runsOf = (t, o = {}) => String(t ?? '').split(/(\{\{[^}]+\}\})/).filter(Boolean).map(x => /^\{\{/.test(x)
  ? new TextRun({ text: x, font: FONT, size: o.size || 21, bold: true, color: '7F6000', shading: { type: ShadingType.CLEAR, fill: 'FFF2CC', color: 'auto' } })
  : new TextRun({ text: x, font: FONT, size: 21, ...o }));
const p = (t, o = {}) => new Paragraph({ spacing: { after: 120, line: 290 }, ...(o.para || {}), children: runsOf(t, o.run) });
const runs = (arr, o = {}) => new Paragraph({ spacing: { after: 120, line: 290 }, ...o, children: arr.flatMap(a => typeof a === 'string' ? runsOf(a) : runsOf(a.text, a)) });
const h1 = t => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 140 }, children: [new TextRun({ text: t, font: FONT, size: 28, bold: true, color: BRAND })] });
const h2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 220, after: 100 }, children: [new TextRun({ text: t, font: FONT, size: 24, bold: true, color: BRAND })] });
const bullet = t => new Paragraph({ numbering: { reference: 'b', level: 0 }, spacing: { after: 60, line: 280 }, children: Array.isArray(t) ? t.flatMap(a => typeof a === 'string' ? runsOf(a) : runsOf(a.text, a)) : runsOf(t) });
const num = t => new Paragraph({ numbering: { reference: 'n', level: 0 }, spacing: { after: 60, line: 280 }, children: runsOf(t) });
const cell = (content, w, o = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA }, borders, margins: { top: 50, bottom: 50, left: 90, right: 90 },
  shading: o.fill ? { type: ShadingType.CLEAR, fill: o.fill, color: 'auto' } : undefined, columnSpan: o.span,
  children: (Array.isArray(content) ? content : [content]).map(c => c instanceof Paragraph ? c : new Paragraph({ alignment: o.align || AlignmentType.LEFT, children: runsOf(c, { size: o.size || 17, bold: !!o.bold, color: o.color }) })),
});
const table = (cols, header, rows) => new Table({ width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: cols,
  rows: [new TableRow({ tableHeader: true, children: header.map((h, i) => cell(h, cols[i], { fill: BRAND, bold: true, color: 'FFFFFF' })) }), ...rows.map(r => new TableRow({ children: r }))] });
const makeDoc = (title, children, footer) => new Document({
  creator: 'wp-site-audit', title, styles: { default: { document: { run: { font: FONT, size: 21 } } } },
  numbering: { config: [
    { reference: 'b', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } } } }] },
    { reference: 'n', levels: [{ level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 300 } } } }] }] },
  sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
    footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: footer + '  ·  ', font: FONT, size: 16, color: '808080' }), new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 16, color: '808080' })] })] }) },
    children }] });
const header = (title, sub, meta) => [
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: title, font: FONT, size: 40, bold: true, color: BRAND })] }),
  new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text: sub, font: FONT, size: 24, color: '404040' })] }),
  new Paragraph({ spacing: { after: 240 }, border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: BRAND, space: 4 } }, children: [new TextRun({ text: meta, font: FONT, size: 18, color: '595959' })] }),
];
const logoPara = settings => { const l = logoInfo(settings); return l ? [new Paragraph({ spacing: { after: 120 }, children: [new ImageRun({ type: l.type, data: l.buf, transformation: { width: l.width, height: l.height } })] })] : []; };
const huDate = iso => { const d = new Date(iso); return `${d.getFullYear()}. ${['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'][d.getMonth()]} ${d.getDate()}.`; };

function cmpDocx(R) {
  const c = R.compare; if (!c) return [];
  const f = v => (typeof v === 'number' ? String(+v.toFixed(2)).replace('.', ',') : String(v ?? '–'));
  const cols = [3600, 1500, 1500, 3038];
  const out = [new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: `Változás az előző felméréshez képest (${String(c.prevDate || '').slice(0, 10)})`, font: FONT, size: 20, bold: true, color: BRAND })] }), p(c.summary, { run: { size: 18, color: '404040' } })];
  if (c.deltas.length) out.push(table(cols, ['Mutató', 'Előző', 'Mostani', 'Változás'], c.deltas.map(d => [cell(d.label, cols[0], { size: 15 }), cell(f(d.prev), cols[1], { size: 15, align: AlignmentType.CENTER }), cell(f(d.cur), cols[2], { size: 15, align: AlignmentType.CENTER }), cell(d.delta === 0 ? 'változatlan' : d.text ? 'megváltozott' : (d.delta > 0 ? '+' : '') + f(d.delta), cols[3], { size: 15, align: AlignmentType.CENTER, fill: d.better === true ? 'E2EFDA' : d.better === false ? 'F8CBAD' : undefined })])));
  if (c.resolvedFindings.length) { out.push(p('Megoldódott hibák:', { run: { size: 17, bold: true } })); c.resolvedFindings.forEach(x => out.push(bullet(x.title))); }
  if (c.newFindings.length) { out.push(p('Új hibák:', { run: { size: 17, bold: true } })); c.newFindings.forEach(x => out.push(bullet(`${x.title} (${x.sev})`))); }
  return out;
}
const RATEC = { good: 'E2EFDA', mid: 'FFF2CC', bad: 'F8CBAD' };
const pathLabel = u => { try { const x = new URL(u); return x.pathname === '/' ? 'Főoldal' : x.pathname; } catch { return u; } };
const short = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
const twoLine = (a, b, w, fill) => cell([new Paragraph({ children: runsOf(a, { size: 15, bold: true }) }), new Paragraph({ children: runsOf(b, { size: 13, color: '595959' }) })], w, { fill });
function lhDocx(R) {
  const rows = LHX.lhRows(R); if (!rows.length) return [];
  const cols = [1650, 800, 900, 900, 900, 800, 800, 800, 600, 488];
  const out = [new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: 'Lighthouse: sebesség és minőség', font: FONT, size: 20, bold: true, color: BRAND })] })];
  out.push(table(cols, ['Oldal', 'Profil', ...LHX.COLS.map(c => c.label)], rows.map(r => { const c = LHX.cells(r); return c
    ? [cell(short(r.page, 26), cols[0], { size: 15 }), cell(LHX.deviceHu(r.device), cols[1], { size: 15 }), ...c.map((x, i) => cell(x.text, cols[i + 2], { fill: RATEC[x.rating], align: AlignmentType.CENTER, size: 15 }))]
    : [cell(short(r.page, 26), cols[0], { size: 15 }), cell(LHX.deviceHu(r.device), cols[1], { size: 15 }), cell(r.x.error, W - cols[0] - cols[1], { span: 8, size: 15 })]; })));
  rows.filter(r => r.home).map(LHX.verdict).filter(Boolean).forEach(t => out.push(p(t, { run: { size: 18, color: '404040' }, para: { spacing: { before: 80, after: 60 } } })));
  return out;
}
function seoDocx(R) {
  const g = R.geo; if (!g || g.error || !g.pages?.length) return [];
  const rows = g.pages.map(SX.seoRow);
  const cols = [1900, 1850, 1850, 560, 900, 700, 1878];
  const out = [new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: `SEO és GEO oldalanként (${g.pagesChecked} oldal, GEO: ${g.score}/100 – ${g.label})`, font: FONT, size: 20, bold: true, color: BRAND })] })];
  const v = SX.seoVerdict(g.pages); if (v) out.push(p(v, { run: { size: 18, color: '404040' } }));
  out.push(table(cols, ['Oldal', 'Title', 'Description', 'H1', 'Canonical', 'Szavak', 'GEO-pont'], rows.map(r => r.failed ? [cell(short(pathLabel(r.url), 34), cols[0], { size: 15 }), cell(r.note, W - cols[0], { span: 6, size: 15 })] : [
    cell(short(pathLabel(r.url), 34), cols[0], { size: 15 }),
    twoLine(r.title.len + ' kar.', r.title.note, cols[1], RATEC[r.title.rating]),
    twoLine(r.desc.len ? r.desc.len + ' kar.' : 'nincs', r.desc.note, cols[2], RATEC[r.desc.rating]),
    cell(String(r.h1.n), cols[3], { fill: RATEC[r.h1.rating], align: AlignmentType.CENTER, size: 15 }),
    cell(r.canonical.ok ? 'van' : 'nincs', cols[4], { fill: RATEC[r.canonical.rating], align: AlignmentType.CENTER, size: 15 }),
    cell(String(r.words.n), cols[5], { fill: RATEC[r.words.rating], align: AlignmentType.CENTER, size: 15 }),
    cell(String(r.score), cols[6], { fill: r.score >= 80 ? RATEC.good : r.score >= 50 ? RATEC.mid : RATEC.bad, align: AlignmentType.CENTER, size: 15 })])));
  return out;
}
const explDocx = (title, rows) => [h2(title), ...rows.flatMap(([n, w, g]) => [new Paragraph({ spacing: { before: 80, after: 20 }, children: runsOf(n, { size: 18, bold: true }) }), p(`${w} ${g}`, { run: { size: 17, color: '404040' }, para: { spacing: { after: 40 } } })])];

// ================= JAVÍTÁSI JAVASLATOK =================
export async function exportProposals(run, { settings, shotDir }) {
  BRAND = brandHex(settings);
  const showH = settings.showHours !== false;
  const sites = sortSites(run.sites).filter(s => s.result);
  const S = sites.map(summarize);
  const C = [];
  const author = [settings.author?.name, settings.author?.company].filter(Boolean).join(', ');
  logoPara(settings).forEach(x => C.push(x));
  header('Javítási javaslatok', run.options?.name || `${sites.length} weboldal felmérése`, `${author ? 'Készítette: ' + author + '  ·  ' : ''}Felmérés: ${huDate(run.createdAt)}  ·  Tájékoztató jellegű, bejelentkezés nélküli felmérés`).forEach(x => C.push(x));

  C.push(h1('1. Összefoglaló'));
  const cnt = k => S.filter(s => s.statusKey === k).length;
  C.push(p(`${sites.length} domain vizsgálata: ${cnt('ok')} éles, ${cnt('maintenance')} karbantartás módban, ${cnt('redirect')} átirányító, ${cnt('down') + cnt('error')} nem működő${cnt('not-wp') ? `, ${cnt('not-wp')} nem WordPress` : ''}. A felmérés publikus forrásokból készült (forráskód, HTTP-válaszok, WordPress REST API, ismert útvonalak${run.options?.gdpr ? ', böngészős süti-mérés' : ''}${run.options?.lighthouse ? ', Lighthouse' : ''}); a pontos állapot a hozzáférések átvétele után pontosítható.`));
  const hacked = S.filter(s => s.hacked);
  if (hacked.length) C.push(runs([{ text: 'Kiemelt kockázat: ', bold: true, color: 'C00000' }, `${hacked.length} oldalon feltörésre utaló jelek (spam bejegyzések): ${hacked.map(s => s.domain).join(', ')}. Ezeknél a jelszavak cseréje és az incidenskezelés sürgős.`]));
  const cols = showH ? [2700, 1500, 900, 900, 1200, 800, 800, 838] : [3400, 1700, 1100, 1100, 2338];
  const hdr = showH ? ['Domain', 'Állapot', 'Kritikus', 'Magas', 'Rendbetétel (óra)', 'GDPR (óra)', 'SEO (óra)', 'Tartalom (óra)'] : ['Domain', 'Állapot', 'Kritikus', 'Magas', 'GDPR'];
  const rows = S.map(s => [cell(s.domain, cols[0], { bold: true, fill: s.hacked ? 'F8CBAD' : s.critical ? 'FCE4D6' : null }), cell(s.status, cols[1]), cell(String(s.critical || ''), cols[2], { align: AlignmentType.CENTER }), cell(String(s.high || ''), cols[3], { align: AlignmentType.CENTER }),
    ...(showH ? [cell(fmtH(s.totals.kotelezo || 0), cols[4], { align: AlignmentType.CENTER }), cell(fmtH(s.totals.gdpr || 0), cols[5], { align: AlignmentType.CENTER }), cell(fmtH(s.totals.seo || 0), cols[6], { align: AlignmentType.CENTER }), cell(fmtH(s.totals.tartalom || 0), cols[7], { align: AlignmentType.CENTER })] : [cell(s.gdpr, cols[4])])]);
  if (showH) { const t = k => fmtH(S.reduce((a, s) => a + (s.totals[k] || 0), 0)); rows.push([cell('ÖSSZESEN', cols[0], { bold: true, fill: 'EDEDED' }), cell('', cols[1], { fill: 'EDEDED' }), cell(String(S.reduce((a, s) => a + s.critical, 0)), cols[2], { fill: 'EDEDED', align: AlignmentType.CENTER, bold: true }), cell(String(S.reduce((a, s) => a + s.high, 0)), cols[3], { fill: 'EDEDED', align: AlignmentType.CENTER, bold: true }), ...['kotelezo', 'gdpr', 'seo', 'tartalom'].map((k, i) => cell(t(k), cols[4 + i], { fill: 'EDEDED', align: AlignmentType.CENTER, bold: true }))]); }
  C.push(table(cols, hdr, rows));
  if (showH) C.push(p('Az óraszámok becslések. A „Rendbetétel” a javasolt alap munkákat tartalmazza (onboarding, teljes frissítés, hibajavítások); a GDPR, SEO és tartalmi tételek opcionálisak.', { run: { size: 18, color: '595959' } }));

  { // árajánlat (csak ha van megadva óradíj)
    const q = buildQuote(S, settings);
    if (q) {
      C.push(h2('Árajánlat (tájékoztató)'));
      const cols = showH ? [2800, 1300, 1900, 1300, 2338] : [4200, 2719, 2719];
      const rows = q.rows.map(r => showH
        ? [cell(r.domain, cols[0]), cell(fmtH(r.hoursBase), cols[1], { align: AlignmentType.CENTER }), cell(q.money(r.netBase), cols[2], { align: AlignmentType.RIGHT }), cell(fmtH(r.hoursOpt), cols[3], { align: AlignmentType.CENTER }), cell(q.money(r.netOpt), cols[4], { align: AlignmentType.RIGHT })]
        : [cell(r.domain, cols[0]), cell(q.money(r.netBase), cols[1], { align: AlignmentType.RIGHT }), cell(q.money(r.netOpt), cols[2], { align: AlignmentType.RIGHT })]);
      rows.push(showH
        ? [cell('Összesen (nettó)', cols[0], { bold: true, fill: 'D9E1F2' }), cell(fmtH(q.total.hoursBase), cols[1], { bold: true, fill: 'D9E1F2', align: AlignmentType.CENTER }), cell(q.money(q.total.netBase), cols[2], { bold: true, fill: 'D9E1F2', align: AlignmentType.RIGHT }), cell(fmtH(q.total.hoursOpt), cols[3], { bold: true, fill: 'D9E1F2', align: AlignmentType.CENTER }), cell(q.money(q.total.netOpt), cols[4], { bold: true, fill: 'D9E1F2', align: AlignmentType.RIGHT })]
        : [cell('Összesen (nettó)', cols[0], { bold: true, fill: 'D9E1F2' }), cell(q.money(q.total.netBase), cols[1], { bold: true, fill: 'D9E1F2', align: AlignmentType.RIGHT }), cell(q.money(q.total.netOpt), cols[2], { bold: true, fill: 'D9E1F2', align: AlignmentType.RIGHT })]);
      C.push(table(cols, showH ? ['Weboldal', 'Rendbetétel (óra)', 'Rendbetétel (nettó)', 'Opcionális (óra)', 'Opcionális (nettó)'] : ['Weboldal', 'Rendbetétel (nettó)', 'Opcionális (nettó)'], rows));
      C.push(p(`Óradíj: ${q.money(q.rate)} + ${q.vat}% ÁFA. A rendbetétel bruttó összege: ${q.money(q.total.grossBase)} (ebből ÁFA: ${q.money(q.total.vatBase)}); az opcionális tételek bruttó összege: ${q.money(q.total.grossOpt)}. Az árak a becsült óraszámokból számolt, tájékoztató jellegű összegek; a végleges díjat a munka megkezdése előtt rögzítjük.`, { run: { size: 17, color: '404040' } }));
    }
  }
  C.push(h1('2. Munkamenet'));
  ['Minden frissítés és javítás az éles oldal másolatán, staging-környezetben készül, és csak tesztelés után kerül élesbe.',
   'Élesítés előtt teljes mentés készül (fájlok és adatbázis); hiba esetén az előző állapot visszaállítható.',
   'Kivétel a biztonsági incidens azonnali lépései (illetéktelen fiókok letiltása, jelszócsere, nyilvános naplófájl eltávolítása), amelyek mentés után közvetlenül élesben történnek.',
   'Tartalmat (szövegek, képek, menük, jogi oldalak) automatikusan nem módosítunk; a tartalmi javítások opcionálisak.'].forEach(t => C.push(bullet(t)));

  C.push(new Paragraph({ children: [new PageBreak()] }));
  C.push(h1('3. Oldalanként'));
  for (const [i, s] of sites.entries()) {
    const R = s.result, sm = S[i];
    C.push(h2(`${s.domain}  ·  ${sm.status}`));
    const facts = [sm.wp !== '–' && `WordPress ${sm.wp}`, sm.builder && `Builder: ${sm.builder}`, sm.theme && `Téma: ${sm.theme}`, sm.php && `PHP ${sm.php}`, sm.plugins && `Pluginok: ${sm.plugins}`, sm.tier && `Becsült méret: ${sm.tier}`, sm.gdpr && `GDPR: ${sm.gdpr}`, sm.geo && `GEO: ${sm.geo.score}/100 (${sm.geo.label}; ${sm.geo.pagesChecked} oldal)`].filter(Boolean);
    C.push(p(facts.join('  ·  '), { run: { size: 18, color: '404040' } }));
    if (sm.aiSummary) { C.push(p(`MI-összefoglaló (${sm.aiSummary.model}, tájékoztató jellegű):`, { run: { size: 18, bold: true, color: '404040' } })); sm.aiSummary.text.split(/\n+/).forEach(line => C.push(p(line, { run: { size: 18, color: '404040' } }))); }
    const shot = R.screenshot && shotDir && path.join(shotDir, R.screenshot);
    if (shot && fs.existsSync(shot)) C.push(new Paragraph({ spacing: { after: 120 }, children: [new ImageRun({ type: 'jpg', data: fs.readFileSync(shot), transformation: { width: 300, height: 189 } })] }));
    cmpDocx(R).forEach(x => C.push(x)); seoDocx(R).forEach(x => C.push(x)); lhDocx(R).forEach(x => C.push(x)); checksDocx(R, { p, bullet, table, cell, Paragraph, TextRun, AlignmentType, FONT, W, brand: BRAND }).forEach(x => C.push(x)); solDocx(R, { brand: BRAND, p, bullet, table, cell, runsOf, Paragraph, TextRun, AlignmentType, W, FONT }).forEach(x => C.push(x)); C.push(p(''));
    const fc = showH ? [1100, 3900, 3838, 800] : [1100, 4300, 4238];
    const groups = ['kotelezo', 'gdpr', 'seo', 'tartalom', 'domain', 'info'];
    const trs = [];
    for (const g of groups) {
      const fs_ = (R.findings || []).filter(f => f.group === g); if (!fs_.length) continue;
      const gh = fs_.reduce((a, f) => a + (f.hours || 0), 0);
      trs.push([cell(GROUPS[g] + (showH && gh ? `  –  ${fmtH(gh)} óra` : ''), W, { span: fc.length, bold: true, fill: 'D9E1F2' })]);
      for (const f of fs_) trs.push([cell(f.base ? 'alap' : f.sev, fc[0], { fill: f.base ? 'F2F2F2' : SEVC[f.sev] }), cell([new Paragraph({ children: runsOf(f.title, { size: 17, bold: true }) }), ...(f.detail ? [new Paragraph({ children: runsOf(f.detail, { size: 15, color: '595959' }) })] : [])], fc[1]), cell(f.fix || '', fc[2]), ...(showH ? [cell(f.noEstimate ? 'n. b.' : fmtH(f.hours || 0) || '–', fc[3], { align: AlignmentType.CENTER })] : [])]);
    }
    if (trs.length) C.push(table(fc, showH ? ['Súlyosság', 'Megállapítás', 'Javaslat', 'Óra'] : ['Súlyosság', 'Megállapítás', 'Javaslat'], trs));
    C.push(p(''));
  }

  if (S.some(s => s.lh || s.lhPages.length)) { explDocx('Mit jelentenek a Lighthouse-értékek?', LHX.EXPLAIN).forEach(x => C.push(x)); C.push(p(LHX.LEGEND, { run: { size: 16, color: '595959' } })); }
  if (S.some(s => s.geo)) explDocx('Mit jelentenek az SEO / GEO oldalankénti értékek?', SX.SEO_EXPLAIN).forEach(x => C.push(x));
  C.push(h1('4. Módszertan és korlátok'));
  ['A felmérés bejelentkezés nélkül készült: a pontos plugin-lista, a PHP-verzió (ha a szerver elrejti), a mentések és a jogosultságok csak hozzáféréssel ellenőrizhetők.',
   'A plugin-verziók a betöltött fájlok verziójelöléséből és a readme.txt-ből származnak, ezért becsültek; a legújabb verziók a WordPress.org nyilvános adataiból valók (prémium bővítményeknél nem elérhető).',
   'A spam-szűrés kulcsszavas keresés a nyilvános bejegyzésekben; a „≥” jelölés alsó becslés.',
   run.options?.gdpr ? 'A süti-mérés első látogatóként, interakció nélkül történt: azt rögzíti, mi tölt be a hozzájárulás előtt. Nem minősül jogi tanácsadásnak.' : 'Böngészős süti-mérés nem futott; a GDPR-megállapítások a forráskódon alapulnak.',
   run.options?.lighthouse ? `A Lighthouse a főoldalra${run.options.pages ? ` és legfeljebb ${run.options.pages} sitemapből választott aloldalra` : ''} futott (${{ desktop: 'asztali', both: 'mobil és asztali' }[run.options.device] || 'mobil'} profil); az értékek futásonként ±5–10 ponttal szórhatnak.` : 'Lighthouse-mérés nem futott.'].forEach(t => C.push(bullet(t)));
  return Packer.toBuffer(makeDoc('Javítási javaslatok', C, 'Javítási javaslatok'));
}

// ================= SABLON E-MAILEK =================
const PLAIN = (f, R) => ({
  hacked: `illetéktelenek ${R.spam?.confirmed || 'több'} reklámbejegyzést helyeztek el az oldalon`,
  'core-behind': `a WordPress-rendszer több verzióval elmaradt (${R.wp?.version} → ${R.wp?.latest})`,
  'elementor-behind': 'az oldalszerkesztő bővítmény (Elementor) több főverzióval elmaradt',
  'woo-behind': 'a webshop-motor (WooCommerce) több verzióval elmaradt',
  'plugins-outdated': f.title.replace(/plugin elavult/, 'kiegészítő bővítmény elavult'),
  'php-eol': 'a tárhely PHP-verziója már nem kap biztonsági javítást',
  'debug-log': 'egy hibanapló-fájl nyilvánosan letölthető az oldalról',
  git: 'a weboldal forráskódja nyilvánosan letölthető',
  'ssl-expired': 'lejárt az oldal biztonsági tanúsítványa, a böngészők figyelmeztetést mutatnak',
  'ssl-invalid': 'az oldal biztonsági tanúsítványa hibás, a böngészők figyelmeztetést mutatnak',
  'ssl-soon': 'hamarosan lejár az oldal biztonsági tanúsítványa',
  hardening: 'a belépéshez használt felhasználónevek kívülről kideríthetők',
  'no-security': 'nincs telepítve biztonsági bővítmény',
  'page-weight': 'az oldal nehéz, mobilon lassan töltődik be',
  'lh-poor': 'az oldal mobilon lassan töltődik be',
  'no-cache': 'a szerver lassan válaszol',
  noindex: 'az oldal jelenleg nem jelenik meg a Google találatai között',
  'robots-block': 'a keresők ki vannak tiltva az oldalról',
  'gdpr-no-cmp': 'a látogatottságmérés a látogató hozzájárulása nélkül fut, nincs süti-kezelő',
  'gdpr-wall': 'a süti-sávon nem lehet elutasítani a sütiket',
  'gdpr-preconsent': 'a mérőkódok a látogató hozzájárulása előtt elindulnak',
  'gdpr-no-reject': 'a süti-sávon nincs egyenrangú elutasítási lehetőség',
  'ga-ua': 'a látogatottságmérés 2023 óta nem gyűjt adatot (megszűnt Google-szolgáltatás)',
  'ga-none': 'nincs látogatottságmérés',
  'seo-plugin': 'hiányoznak a keresőoptimalizálás alapbeállításai',
  sitemap: 'nem működik az oldaltérkép a Google számára',
  'risky-': 'egy kockázatos kiegészítő bővítmény van telepítve',
}[f.id.startsWith('risky-') ? 'risky-' : f.id] || null);

export async function exportEmails(run, { settings }) {
  BRAND = brandHex(settings);
  const sites = sortSites(run.sites).filter(s => s.result && s.result.status !== 'redirect' && (s.result.wp?.isWp || ['down', 'error', 'blocked'].includes(s.result.status)));
  const a = settings.author || {};
  const org = settings.senderOrg || '{{CÉG NEVE}}';
  const sig = () => [p('Üdvözlettel:'), p(a.name || '{{KÜLDŐ NEVE}}'), p(org), p(`${a.phone || '{{TELEFON}}'}  ·  ${a.email || '{{E-MAIL}}'}`)];
  const C = [];
  logoPara(settings).forEach(x => C.push(x));
  header('Sablon e-mailek', run.options?.name || 'Weboldal-tulajdonosok tájékoztatása', `Felmérés: ${huDate(run.createdAt)}  ·  A sárga {{MEZŐK}} kitöltendők, a [szögletes] részek elhagyhatók`).forEach(x => C.push(x));
  C.push(p('Oldalanként egy levél, a felmérés megállapításaiból előre kitöltve. Az árak helyén mezők állnak; a küldő saját árát kell beírni. A megszólítás magázó.'));
  C.push(p('Tartalom: ' + sites.map(s => s.domain).join(', '), { run: { size: 18, color: '595959' } }));

  const PC = [4200, 3438, 2000];
  for (const s of sites) {
    const R = s.result;
    C.push(new Paragraph({ children: [new PageBreak()] }));
    C.push(h1(s.domain));
    if (R.status === 'blocked') {
      const ip = process.env.AUDIT_PUBLIC_IP || '{{MÉRŐ IP-CÍM}}';
      C.push(table([1600, W - 1600], ['Tárgy', `A ${s.domain} weboldal védelme blokkolja az automatikus ellenőrzést – engedélyezés kérése`], []));
      C.push(p('')); C.push(p('Tisztelt {{ÜGYFÉL NEVE}}!'));
      C.push(p(`A ${s.domain} weboldal átvizsgálásához automatikus ellenőrzést futtatunk, de a weboldal védelme (bot-védelem, tűzfal vagy a tárhelyszolgáltató szűrése) „${R.reach?.blockedBy || 'védelmi oldal'}” üzenetet ad vissza, ezért a tartalmat nem tudjuk megvizsgálni.`));
      C.push(p('Kérjük, hogy a weboldal védelmében (vagy a tárhelyszolgáltatónál) engedélyezzék az alábbi IP-címet. Ez csak olvasási jellegű, nyilvános oldalakat lekérő ellenőrzés; semmit nem módosít, és nem lép be az oldalra:'));
      C.push(bullet([{ text: 'Mérő IP-cím: ', bold: true }, ip]));
      C.push(p('Ha IP-cím szerinti engedélyezésre nincs lehetőség, egyeztetett fejléc vagy a védelem kivételszabálya is megfelel; ebben szívesen segítünk a tárhelyszolgáltatóval egyeztetve.'));
      C.push(p('Az engedélyezés után újrafuttatjuk az ellenőrzést, és elküldjük az eredményt.'));
      sig().forEach(x => C.push(x)); continue;
    }
    const down = ['down', 'error', 'maintenance'].includes(R.status);
    const hacked = R.flags?.hacked;
    const subj = down ? `A ${s.domain} weboldal jelenleg nem érhető el` : hacked ? `Fontos: biztonsági probléma a ${s.domain} weboldalon – teendők és költségek` : `A ${s.domain} weboldal karbantartása – teendők, költségek, menetrend`;
    C.push(table([1600, W - 1600], ['Tárgy', subj], []));
    C.push(p(''));
    C.push(p('Tisztelt {{ÜGYFÉL NEVE}}!'));
    if (down) {
      C.push(p(`Szeretnénk jelezni, hogy a ${s.domain} weboldal jelenleg ${R.status === 'maintenance' ? 'karbantartás módban van, a látogatók nem látják a tartalmat' : R.status === 'down' ? 'nem töltődik be' : `hibát ad (HTTP ${R.reach?.status})`}.`));
      C.push(p('Kérjük, jelezze, hogy a weboldalra továbbra is szüksége van-e, és helyreállítsuk-e – vagy az állapot szándékos (pl. új oldal készül). Helyreállítás esetén először felmérjük a hiba okát, és erről előzetesen árajánlatot küldünk.'));
      C.push(p('Ha a weboldalra már nincs szükség, javasoljuk a tárhely megszüntetését, de a domain név megtartását, hogy később is az Öné maradjon.'));
      sig().forEach(x => C.push(x)); continue;
    }
    C.push(p(`Átvizsgáltuk a ${s.domain} weboldalt, és a jövőben rendszeres, szakszerű karbantartással szeretnénk gondoskodni a biztonságos működéséről. Az alábbiakban összefoglaljuk, mit találtunk, mi a teendő, mennyibe kerül, és mi fog történni.`));
    C.push(h2('Mi a helyzet?'));
    C.push(p('A weboldal WordPress alapon működik. A rendszert és a kiegészítőit rendszeresen frissíteni kell, mert az elavult verziók a feltört weboldalak leggyakoribb okai. Az Ön weboldalán a következőket találtuk:'));
    const items = [...new Set((R.findings || []).filter(f => !f.base && f.sev !== 'info' && f.sev !== 'alacsony').map(f => PLAIN(f, R)).filter(Boolean))].slice(0, 6);
    (items.length ? items : ['{{TALÁLT PROBLÉMÁK}}']).forEach(t => C.push(bullet(t)));
    if (hacked) C.push(p(`Kiemelten sürgős: az oldalra illetéktelenek reklámbejegyzéseket töltöttek fel. Ezek eltávolítása, a rejtett kártevő kód keresése és a védelem megerősítése a rendbetétel része. Kérjük, ha Önnek vagy munkatársának van belépése, a következő belépéskor változtassa meg a jelszavát.`));
    C.push(h2('Mi a teendő?'));
    C.push(p('Két lépést javaslunk: egy egyszeri rendbetételt, amely naprakész, biztonságos állapotba hozza a weboldalt, majd rendszeres havi karbantartást, amely ezt fenntartja.'));
    C.push(h2('Mennyibe kerül?'));
    const g = k => (R.findings || []).filter(f => f.group === k && !f.base);
    const prow = (a1, b1, c1, opt) => [cell(a1, PC[0], { bold: !opt, fill: opt ? null : 'FFF2CC' }), cell(b1, PC[1], { fill: opt ? null : 'FFF2CC' }), cell(c1, PC[2], { align: AlignmentType.RIGHT, bold: !opt, fill: opt ? null : 'FFF2CC' })];
    const prs = [prow('Egyszeri rendbetétel – szükséges', 'teljes frissítés, a talált hibák javítása, biztonsági alap, mentés és felügyelet', '{{EGYSZERI DÍJ}} + ÁFA'), prow('Rendszeres karbantartás', 'folyamatos frissítés, napi mentés, felügyelet, hibaelhárítás', '{{HAVIDÍJ}} + ÁFA / hó')];
    if (g('gdpr').length) prs.push(prow('[opcionális] Süti-kezelés / GDPR', 'süti-kezelés rendbetétele: hozzájárulás-kezelő, mérőkódok és beágyazások hozzájárulás-függő betöltése, tájékoztató oldalak', '{{GDPR DÍJ}} + ÁFA', true));
    if (g('seo').length) prs.push(prow('[opcionális] Keresőoptimalizálás és mérés', 'keresőoptimalizálási alapbeállítások, látogatottságmérés (GA4), oldaltérkép', '{{SEO DÍJ}} + ÁFA', true));
    if (g('tartalom').length) prs.push(prow('[opcionális] Tartalmi javítás', g('tartalom').map(f => f.fix.split(/[.(]/)[0]).join('; '), '{{TARTALMI DÍJ}} + ÁFA', true));
    C.push(table(PC, ['Tétel', 'Mit tartalmaz', 'Díj (nettó)'], prs));
    C.push(p('Az árak tájékoztató jellegűek; a végleges díjat a munka megkezdése előtt, a részletes átvizsgálás után rögzítjük.', { run: { size: 18, color: '404040' } }));
    C.push(h2('Mi fog történni?'));
    ['Visszaigazolás: Ön jelzi, mely tételeket kéri.', 'Mentés és átvizsgálás ({{KEZDÉS DÁTUMA}}).', 'Rendbetétel ({{IDŐTARTAM}}): minden frissítést először a weboldal egy másolatán végzünk el és tesztelünk, csak ezután kerül élesbe. A weboldal végig elérhető marad.', 'Átadás: röviden összefoglaljuk, mit végeztünk el.', 'Rendszeres karbantartás a következő hónaptól.'].forEach(t => C.push(num(t)));
    C.push(p('A weboldal szövegeit, képeit nem módosítjuk; tartalmi változtatást mindig előre egyeztetünk.'));
    C.push(h2('Mit kérünk Öntől?'));
    C.push(bullet('{{HATÁRIDŐ}}-ig válaszoljon, mely tételeket kéri;'));
    C.push(bullet('ha Önnek vagy munkatársának van saját belépése, erősítse meg, hogy továbbra is szükség van-e rá.'));
    sig().forEach(x => C.push(x));
  }
  return Packer.toBuffer(makeDoc('Sablon e-mailek', C, 'Sablon e-mailek'));
}
