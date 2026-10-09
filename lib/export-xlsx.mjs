import ExcelJS from 'exceljs';
import { summarize, sortSites } from './summary.mjs';
import { GROUPS } from './rules.mjs';
import * as SX from '../public/seo-explain.mjs';
import * as LHX from '../public/lh-explain.mjs';

const HDR = { font: { bold: true, color: { argb: 'FFFFFFFF' } }, fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F3864' } }, alignment: { vertical: 'middle', wrapText: true } };
const fill = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + c } });
const SEVC = { kritikus: 'F8CBAD', magas: 'FCE4D6', 'közepes': 'FFF2CC', alacsony: 'E2EFDA', info: 'EDEDED' };
const sc = v => v == null ? null : v >= 90 ? 'E2EFDA' : v >= 50 ? 'FFF2CC' : 'F8CBAD';

function sheet(wb, name, cols, rows, opt = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1, xSplit: opt.xSplit || 1 }] });
  ws.columns = cols.map(([header, key, width]) => ({ header, key, width }));
  ws.getRow(1).eachCell(c => Object.assign(c, HDR)); ws.getRow(1).height = 30;
  rows.forEach(r => ws.addRow(r));
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  ws.eachRow((row, i) => { if (i > 1) row.alignment = { vertical: 'top', wrapText: true }; });
  return ws;
}

export async function exportXlsx(run, { settings }) {
  const wb = new ExcelJS.Workbook(); wb.creator = settings.author?.name || 'wp-site-audit'; wb.created = new Date();
  const sites = sortSites(run.sites);
  const S = sites.map(summarize);

  const ws = sheet(wb, 'Összesítő', [['Domain', 'domain', 28], ['Ügyfél', 'client', 20], ['Állapot', 'status', 15], ['Becsült méret', 'tier', 12], ['WordPress', 'wp', 14], ['Builder', 'builder', 20], ['Téma', 'theme', 20], ['PHP', 'php', 10], ['Pluginok / elavult', 'plugins', 14], ['Biztonsági bővítmény', 'security', 18], ['Spam', 'spam', 10], ['GDPR', 'gdpr', 16], ['Süti-kezelő', 'cookie', 18], ['SEO-plugin', 'seoPlugin', 16], ['Mérés', 'analytics', 14], ['TTFB (ms)', 'ttfb', 9], ['GEO (/100)', 'geoScore', 10], ['LH Perf', 'perf', 8], ['LH A11y', 'a11y', 8], ['LH BP', 'bp', 8], ['LH SEO', 'seo', 8], ['LCP (s)', 'lcp', 8], ['LH Perf (asztali)', 'perfD', 10], ['Kritikus', 'critical', 8], ['Magas', 'high', 8], ['Rendbetétel (óra)', 'h1', 11], ['GDPR (óra)', 'h2', 9], ['SEO (óra)', 'h3', 9], ['Tartalom (óra)', 'h4', 9]],
    S.map(s => ({ ...s, geoScore: s.geo?.score, perf: s.lh?.perf, a11y: s.lh?.a11y, bp: s.lh?.bp, seo: s.lh?.seo, lcp: s.lh?.lcp, perfD: s.lhDesktop?.perf, h1: s.totals.kotelezo || 0, h2: s.totals.gdpr || 0, h3: s.totals.seo || 0, h4: s.totals.tartalom || 0 })));
  ws.eachRow((row, i) => {
    if (i === 1) return; const s = S[i - 2];
    if (s.hacked) row.getCell('domain').fill = fill('F8CBAD'); else if (s.critical) row.getCell('domain').fill = fill('FCE4D6');
    ['perf', 'a11y', 'bp', 'seo'].forEach(k => { const c = sc(s.lh?.[k]); if (c) row.getCell(k).fill = fill(c); });
    { const c = sc(s.geo?.score); if (c) row.getCell('geoScore').fill = fill(c); }
    if (/Nem megfelelő/.test(s.gdpr)) row.getCell('gdpr').fill = fill('F8CBAD'); else if (/Hiányos/.test(s.gdpr)) row.getCell('gdpr').fill = fill('FFF2CC'); else if (s.gdpr === 'Rendben') row.getCell('gdpr').fill = fill('E2EFDA');
  });
  // GEO: területi pontszámok és oldalankénti eredmények
  const geoSites = S.filter(s => s.geo);
  if (geoSites.length) {
    const wg = sheet(wb, 'GEO', [['Domain', 'domain', 26], ['Összpont (/100)', 'score', 12], ['Besorolás', 'label', 14], ['Bejárhatóság (/20)', 'crawl', 12], ['Nyelv (/10)', 'lang', 10], ['Megbízhatóság (/15)', 'trust', 12], ['Tartalom (/20)', 'content', 12], ['Strukturált adat (/25)', 'schema', 12], ['AI-készültség (/10)', 'ai', 12], ['Vizsgált oldalak', 'pages', 10], ['Erős / jó / fejl. / gyenge', 'health', 18], ['AI-botok tiltva (robots.txt)', 'bots', 24], ['AI-botok blokkolva', 'blocked', 22], ['llms.txt', 'llms', 9]],
      geoSites.map(s => { const g = s.geo, a = k => g.areas.find(x => x.key === k)?.score; return { domain: s.domain, score: g.score, label: g.label, crawl: a('crawl'), lang: a('lang'), trust: a('trust'), content: a('content'), schema: a('schema'), ai: a('ai'), pages: g.pagesChecked, health: `${g.health.strong} / ${g.health.solid} / ${g.health.needs} / ${g.health.weak}`, bots: g.botsBlocked.join(', ') || '–', blocked: g.aiBots.filter(b => b.blocked).map(b => b.name).join(', ') || '–', llms: g.llms ? 'van' : 'nincs' }; }));
    wg.eachRow((row, i) => { if (i > 1) { const c = sc(geoSites[i - 2].geo.score); if (c) row.getCell('score').fill = fill(c); } });
    const gp = [];
    const RC = { good: 'E2EFDA', mid: 'FFF2CC', bad: 'F8CBAD' };
    geoSites.forEach(s => s.geo.pages.forEach(p => { const r = SX.seoRow(p); gp.push(r.failed ? { domain: s.domain, url: p.url, issues: r.note } : { domain: s.domain, url: p.url, title: p.title, titleLen: r.title.len, titleNote: r.title.note, desc: p.desc, descLen: r.desc.len, descNote: r.desc.note, h1: r.h1.n, canonical: r.canonical.ok ? 'van' : 'nincs', words: p.words, score: p.score, level: { strong: 'erős', solid: 'jó', needs: 'fejlesztendő', weak: 'gyenge' }[p.level], types: (p.types || []).join(', '), issues: (p.issues || []).join('; '), _r: r }); }));
    const wp2 = sheet(wb, 'SEO és GEO oldalak', [['Domain', 'domain', 22], ['Oldal', 'url', 50], ['Title', 'title', 40], ['Title hossza', 'titleLen', 9], ['Title értékelése', 'titleNote', 26], ['Meta description', 'desc', 50], ['Description hossza', 'descLen', 10], ['Description értékelése', 'descNote', 26], ['H1 db', 'h1', 7], ['Canonical', 'canonical', 10], ['Szavak (HTML)', 'words', 10], ['GEO-pont (/100)', 'score', 10], ['Szint', 'level', 13], ['Séma-típusok', 'types', 28], ['Hiányosságok', 'issues', 55]], gp);
    wp2.eachRow((row, i) => { if (i > 1) { const q = gp[i - 2], r = q._r; const c = sc(q.score); if (c) row.getCell('score').fill = fill(c); if (r) { row.getCell('titleLen').fill = fill(RC[r.title.rating]); row.getCell('titleNote').fill = fill(RC[r.title.rating]); row.getCell('descLen').fill = fill(RC[r.desc.rating]); row.getCell('descNote').fill = fill(RC[r.desc.rating]); row.getCell('h1').fill = fill(RC[r.h1.rating]); row.getCell('canonical').fill = fill(RC[r.canonical.rating]); row.getCell('words').fill = fill(RC[r.words.rating]); } } });
    const wex = wb.addWorksheet('Magyarázat'); wex.columns = [{ width: 30 }, { width: 90 }, { width: 45 }];
    [['Mutató', 'Mit jelent', 'Mi a jó'], ...SX.SEO_EXPLAIN, ['', '', ''], ...LHX.EXPLAIN].forEach((r, i) => { const row = wex.addRow(r); row.alignment = { wrapText: true, vertical: 'top' }; if (i === 0) row.eachCell(c => Object.assign(c, HDR)); });
  }
  // további mérések egy munkalapon: akadálymentesség, linkek, e-mail / domain, sebezhetőségek
  const chk = [];
  sites.forEach(site => {
    const R = site.result || {}, add = (area, item, detail, level) => chk.push({ domain: site.domain, area, item, detail, level });
    for (const v of R.a11y?.violations || []) add('Akadálymentesség (WCAG)', v.helpHu, `${v.wcag?.length ? 'WCAG ' + v.wcag.join(', ') + ' (' + (v.level || '') + ') · ' : ''}${v.count} elem · ${v.fixHu || ''}`, v.impact);
    for (const r of R.a11yAll?.rules || []) add('Akadálymentesség: teljes sitemap', r.helpHu, `${r.wcag?.length ? 'WCAG ' + r.wcag.join(', ') + ' (' + (r.level || '') + ') · ' : ''}${r.pages} / ${R.a11yAll.checked} oldal · ${r.elements} elem · ${r.fixHu || ''}`, r.impact);
    for (const pg of R.a11yAll?.pages || []) if (!pg.error) add('Akadálymentesség: oldalanként', pg.url, `${pg.counts.critical} kritikus, ${pg.counts.serious} súlyos, ${pg.counts.moderate} közepes, ${pg.counts.minor} enyhe`, pg.counts.critical || pg.counts.serious ? 'magas' : '');
    for (const pg of R.a11yPages || []) if (!pg.error) add('Akadálymentesség: aloldal', pg.url, `${pg.counts.critical} kritikus, ${pg.counts.serious} súlyos, ${pg.counts.moderate} közepes, ${pg.counts.minor} enyhe`, '');
    for (const pg of R.w3c?.pages || []) add('W3C HTML-validálás', pg.url, `${pg.errors} hiba, ${pg.warnings} figyelmeztetés${pg.top[0] ? ' · ' + (pg.top[0].hint || pg.top[0].message) : ''}`, pg.errors ? 'alacsony' : '');
    for (const x of R.links?.brokenInternal || []) add('Törött belső link', x.url, `HTTP ${x.status || x.error} · oldal: ${x.from}`, 'közepes');
    for (const x of R.links?.brokenExternal || []) add('Törött külső link', x.url, `HTTP ${x.status || x.error} · oldal: ${x.from}`, 'alacsony');
    if (R.mail && !R.mail.error) { add('E-mail', 'MX / SPF / DMARC / DKIM', `MX: ${R.mail.hasMx ? R.mail.mx.map(m => m.exchange).slice(0, 2).join(', ') : 'nincs'} · SPF: ${R.mail.spf?.policy || (R.mail.spf ? 'szabály nélkül' : 'nincs')} · DMARC: ${R.mail.dmarc ? 'p=' + R.mail.dmarc.policy : 'nincs'} · DKIM: ${R.mail.dkim.join(', ') || '–'}`, ''); for (const i of R.mail.issues) add('E-mail', i.title, i.fix, i.sev); }
    if (R.domainExp && !R.domainExp.error) add('Domain', 'Lejárat', `${R.domainExp.expires} (${R.domainExp.daysLeft} nap)${R.domainExp.registrar ? ' · ' + R.domainExp.registrar : ''}`, R.domainExp.daysLeft < 30 ? 'magas' : '');
    for (const x of R.vulns?.items || []) add('Sebezhetőség', `${x.name} ${x.version}`, `${x.title}${x.cve?.length ? ' (' + x.cve.join(', ') + ')' : ''} · javítva: ${x.fixedIn || 'nincs'}`, x.severity);
  });
  if (chk.length) sheet(wb, 'További mérések', [['Domain', 'domain', 24], ['Terület', 'area', 18], ['Tétel', 'item', 55], ['Részlet', 'detail', 70], ['Súlyosság', 'level', 12]], chk);
  // változás az előző felméréshez képest
  const cmpRows = [];
  sites.forEach(site => { const c = site.result?.compare; if (!c) return; for (const d of c.deltas) cmpRows.push({ domain: site.domain, prevDate: String(c.prevDate || '').slice(0, 10), label: d.label, prev: d.prev, cur: d.cur, delta: d.text ? 'megváltozott' : d.delta, verdict: d.better === true ? 'javult' : d.better === false ? 'romlott' : 'változatlan' }); for (const f of c.resolvedFindings) cmpRows.push({ domain: site.domain, prevDate: String(c.prevDate || '').slice(0, 10), label: 'Megoldódott: ' + f.title, verdict: 'javult' }); for (const f of c.newFindings) cmpRows.push({ domain: site.domain, prevDate: String(c.prevDate || '').slice(0, 10), label: 'Új hiba: ' + f.title + ' (' + f.sev + ')', verdict: 'romlott' }); });
  if (cmpRows.length) { const wc = sheet(wb, 'Változás', [['Domain', 'domain', 24], ['Előző felmérés', 'prevDate', 14], ['Mutató / tétel', 'label', 60], ['Előző', 'prev', 12], ['Mostani', 'cur', 12], ['Változás', 'delta', 12], ['Értékelés', 'verdict', 12]], cmpRows); wc.eachRow((row, i) => { if (i > 1) { const v = cmpRows[i - 2].verdict; row.getCell('verdict').fill = fill(v === 'javult' ? 'E2EFDA' : v === 'romlott' ? 'F8CBAD' : 'EDEDED'); } }); }
  // javasolt szövegek és sebesség-teendők
  const sugRows = [], speedRows = [];
  sites.forEach(site => {
    const R = site.result || {};
    (R.aiSuggest?.meta || []).forEach(m => {
      if (m.title.needed) sugRows.push({ domain: site.domain, url: m.url, field: 'title', old: m.title.old, oldLen: [...(m.title.old || '')].length, next: m.title.new, newLen: m.title.len, ok: m.title.ok ? 'igen' : 'ellenőrizendő' });
      if (m.desc.needed) sugRows.push({ domain: site.domain, url: m.url, field: 'description', old: m.desc.old, oldLen: [...(m.desc.old || '')].length, next: m.desc.new, newLen: m.desc.len, ok: m.desc.ok ? 'igen' : 'ellenőrizendő' });
    });
    (R.solutions?.speed || []).forEach(s => speedRows.push({ domain: site.domain, topic: s.topic, saving: s.savingsMs ? +(s.savingsMs / 1000).toFixed(1) : null, why: s.why, steps: s.steps.map((x, i) => (i + 1) + '. ' + x).join('\n'), seen: (s.seen || []).join(', ') }));
  });
  if (sugRows.length) sheet(wb, 'Javasolt szövegek', [['Domain', 'domain', 22], ['Oldal', 'url', 45], ['Mező', 'field', 12], ['Jelenlegi', 'old', 50], ['Jelenlegi hossz', 'oldLen', 9], ['Javasolt (MI-vázlat)', 'next', 55], ['Javasolt hossz', 'newLen', 9], ['Hossz megfelelő', 'ok', 14]], sugRows);
  if (speedRows.length) sheet(wb, 'Sebesség-teendők', [['Domain', 'domain', 22], ['Teendő', 'topic', 40], ['Becsült nyereség (s)', 'saving', 12], ['Miért', 'why', 50], ['Lépések', 'steps', 80], ['Érintett oldalak', 'seen', 40]], speedRows);
  // minden Lighthouse-mérés (főoldal + aloldalak, mobil + asztali) külön sorban
  const lhRows = [];
  sites.forEach(site => {
    const R = site.result || {};
    const add = (url, x) => { if (x) lhRows.push({ domain: site.domain, url, device: x.device === 'desktop' ? 'asztali' : 'mobil', perf: x.error ? 'hiba' : x.perf, a11y: x.a11y, bp: x.bp, seo: x.seo, lcp: x.lcp, tbt: x.tbt, cls: x.cls, mb: x.totalKB != null ? +(x.totalKB / 1024).toFixed(1) : null, note: x.error || (x.opportunities || []).slice(0, 3).map(o => o.title).join('; ') }); };
    const home = R.reach?.finalUrl || `https://${site.domain}/`;
    add(home, R.lighthouse); add(home, R.lighthouseDesktop);
    (R.lighthousePages || []).forEach(p => { add(p.url, p.mobile); add(p.url, p.desktop); });
  });
  if (lhRows.length) {
    const wl = sheet(wb, 'Lighthouse', [['Domain', 'domain', 26], ['Oldal', 'url', 50], ['Profil', 'device', 9], ['Perf', 'perf', 8], ['A11y', 'a11y', 8], ['BP', 'bp', 8], ['SEO', 'seo', 8], ['LCP (s)', 'lcp', 8], ['TBT (ms)', 'tbt', 9], ['CLS', 'cls', 8], ['Méret (MB)', 'mb', 10], ['Fő javítási lehetőségek', 'note', 60]], lhRows);
    wl.eachRow((row, i) => { if (i > 1) ['perf', 'a11y', 'bp', 'seo'].forEach(k => { const c = sc(lhRows[i - 2][k]); if (c) row.getCell(k).fill = fill(c); }); });
  }
  const n = S.length + 1;
  const tr = ws.addRow({ domain: 'ÖSSZESEN', h1: { formula: `SUM(W2:W${n})` }, h2: { formula: `SUM(X2:X${n})` }, h3: { formula: `SUM(Y2:Y${n})` }, h4: { formula: `SUM(Z2:Z${n})` }, critical: { formula: `SUM(U2:U${n})` }, high: { formula: `SUM(V2:V${n})` } });
  tr.font = { bold: true }; tr.eachCell(c => { c.fill = fill('EDEDED'); });

  const fr = [];
  for (const s of sites) for (const f of s.result?.findings || []) fr.push({ domain: s.domain, group: GROUPS[f.group], sev: f.sev, cat: f.cat, title: f.title, detail: f.detail || '', fix: f.fix || '', hours: f.noEstimate ? 'nem becsülhető' : (f.hours || 0) });
  const wf = sheet(wb, 'Javaslatok', [['Domain', 'domain', 26], ['Csoport', 'group', 22], ['Súlyosság', 'sev', 10], ['Terület', 'cat', 12], ['Megállapítás', 'title', 42], ['Részlet', 'detail', 50], ['Javaslat', 'fix', 50], ['Becsült óra', 'hours', 10]], fr);
  wf.eachRow((row, i) => { if (i > 1) row.getCell('sev').fill = fill(SEVC[fr[i - 2].sev] || 'FFFFFF'); });

  const pr = [];
  for (const s of sites) for (const p of s.result?.plugins || []) pr.push({ domain: s.domain, name: p.name, slug: p.slug, version: p.version || '', src: p.versionSource || '', latest: p.latest || (p.notOnWporg ? 'prémium / nem wp.org' : ''), outdated: p.outdated ? 'igen' : '', risky: p.risky || '' });
  for (const s of sites) for (const t of s.result?.theme || []) pr.push({ domain: s.domain, name: 'Téma: ' + t.name, slug: t.slug, version: t.version || '', src: 'style.css', latest: t.latest || (t.notOnWporg ? 'prémium / nem wp.org' : ''), outdated: t.outdated ? 'igen' : '', risky: '' });
  const wpl = sheet(wb, 'Pluginok', [['Domain', 'domain', 26], ['Plugin / téma', 'name', 32], ['Slug', 'slug', 24], ['Verzió', 'version', 10], ['Verzió forrása', 'src', 14], ['Legújabb', 'latest', 18], ['Elavult', 'outdated', 8], ['Kockázat', 'risky', 40]], pr);
  wpl.eachRow((row, i) => { if (i > 1 && pr[i - 2].outdated) row.getCell('outdated').fill = fill('FFF2CC'); if (i > 1 && pr[i - 2].risky) row.getCell('risky').fill = fill('F8CBAD'); });

  const gr = sites.filter(s => s.result?.wp?.isWp).map(s => { const R = s.result, g = R.gdpr && !R.gdpr.error ? R.gdpr : null, st = R.gdprStatic || {}; return { domain: s.domain, state: R.gdprState || '', banner: g ? (g.banner ? 'van' : 'nincs') : 'nem mért', reject: g?.banner ? (g.reject ? 'igen' : 'nem') : '', settings: g?.banner ? (g.settings ? 'igen' : 'nem') : '', cmp: (R.detected?.cookie || []).join(', '), cm: g ? (g.consentMode ? 'igen' : 'nem') : (st.consentModeInHtml ? 'igen (HTML)' : ''), pre: g ? [...g.preConsent, ...g.trackerCookies.map(c => c + ' süti')].join(', ') : '', emb: g ? g.embeds.join(', ') : '', fonts: g ? (g.fonts ? 'igen' : '') : '', priv: st.privacy ? (st.privacyPdf ? 'csak PDF' : 'van') : 'nincs', imp: st.imprint ? 'van' : 'nincs', cpol: st.cookiePolicy ? 'van' : 'nincs', text: g?.text || '' }; });
  sheet(wb, 'GDPR', [['Domain', 'domain', 26], ['Állapot', 'state', 16], ['Süti-sáv', 'banner', 10], ['Elutasítás', 'reject', 10], ['Beállítások', 'settings', 10], ['Consent-kezelő', 'cmp', 22], ['Consent Mode v2', 'cm', 12], ['Hozzájárulás előtt fut', 'pre', 34], ['Beágyazások', 'emb', 24], ['Google Fonts', 'fonts', 10], ['Adatkezelési tájékoztató', 'priv', 14], ['Impresszum', 'imp', 10], ['Süti-tájékoztató', 'cpol', 12], ['Sáv szövege', 'text', 50]], gr);

  const ws5 = wb.addWorksheet('Beállítások');
  ws5.columns = [{ header: 'Paraméter', key: 'k', width: 26 }, { header: 'Óra', key: 'v', width: 10 }];
  ws5.getRow(1).eachCell(c => Object.assign(c, HDR));
  Object.entries(settings.hours).forEach(([k, v]) => ws5.addRow({ k, v }));
  ws5.addRow({}); ws5.addRow({ k: 'Felmérés ideje', v: run.createdAt.slice(0, 16).replace('T', ' ') });
  ws5.addRow({ k: 'Opciók', v: JSON.stringify(run.options) });
  return Buffer.from(await wb.xlsx.writeBuffer());
}
