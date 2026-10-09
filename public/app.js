import * as LHX from './lh-explain.mjs';
import * as SX from './seo-explain.mjs';
import { solHtml } from './solutions-ui.mjs';
import { compareHtml } from './compare-ui.mjs';
import { checksHtml } from './checks-ui.mjs';
import { initAdmin } from './admin.mjs';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtH = h => String(+(+h || 0).toFixed(2)).replace('.', ',');
const api = async (url, opt = {}) => { const r = await fetch(url, { headers: { 'content-type': 'application/json' }, ...opt }); const j = await r.json().catch(() => ({})); if (r.status === 401 && j.login) { location.href = j.login; throw new Error('Bejelentkezés szükséges'); } if (!r.ok) throw new Error(j.error || r.statusText); return j; };

const STATUS = { ok: ['Éles', 'c-ok'], maintenance: ['Karbantartás', 'c-warn'], redirect: ['Átirányítás', ''], down: ['Nem elérhető', 'c-bad'], error: ['Hibás válasz', 'c-bad'], 'not-wp': ['Nem WP', ''], blocked: ['Bot-védelem', 'c-warn'] };
const STATE = { queued: 'várakozik', probing: 'felmérés', 'waiting-browser': 'böngészőre vár', browser: 'böngészős mérés', lighthouse: 'Lighthouse', ai: 'MI-összefoglaló', failed: 'hiba' };
const GROUPS = { kotelezo: 'Javasolt rendbetétel', gdpr: 'Opcionális: GDPR és süti-kezelés', seo: 'Opcionális: SEO és mérés', tartalom: 'Opcionális: tartalom', domain: 'Opcionális: domain, DNS és e-mail', info: 'Tájékoztató' };
const HOUR_LABELS = { onboarding: 'Onboarding', updateS: 'Teljes frissítés – egyszerű oldal', updateM: 'Teljes frissítés – közepes oldal', updateL: 'Teljes frissítés – összetett oldal', updateRemainder: 'Frissítés-maradék főverzió-tétel mellett', coreMajorBehind: 'WP core több verziós lemaradás', builderMajor: 'Builder / WooCommerce főverzió', phpEol: 'PHP-váltás (EOL)', incidentLt10: 'Incidens: < 10 spam', incidentLt50: 'Incidens: < 50 spam', incidentLt200: 'Incidens: < 200 spam', incidentLt500: 'Incidens: < 500 spam', incidentMax: 'Incidens: 500+ spam', incidentActiveExtra: 'Incidens: aktív támadás többlet', debugLog: 'Nyilvános debug.log', gitExposed: 'Nyilvános .git', hardening: 'Biztonsági keményítés', riskyPlugin: 'Kockázatos plugin', dupSecurity: 'Párhuzamos biztonsági pluginok', ssl: 'SSL-javítás', httpsRedirect: 'HTTPS-átirányítás', wpBehindRedirect: 'WP lezárása redirect mögött', imageOpt: 'Képoptimalizálás', cacheSetup: 'Gyorsítótár beállítása', gdprCmp: 'GDPR: consent-kezelő bevezetése', gdprCmpFix: 'GDPR: meglévő kezelő javítása', gdprBlock: 'GDPR: követőkódok blokkolása', gdprEmbed: 'GDPR: beágyazások blokkolása', gdprFonts: 'GDPR: Google Fonts helyben', gdprCookiePolicy: 'GDPR: süti-tájékoztató', gdprPrivacyPage: 'GDPR: adatkezelési oldal', gdprImprint: 'GDPR: impresszum', gdprConsentMode: 'GDPR: Consent Mode v2', gdprDupCmp: 'GDPR: több consent-plugin', seoPlugin: 'SEO: plugin telepítése', seoConfigure: 'SEO: plugin beállítása', seoReview: 'SEO: átnézés', seoGa4: 'SEO: GA4 bevezetése', seoH1: 'SEO: H1 javítása', seoSitemap: 'SEO: sitemap', seoIndexFix: 'SEO: indexelési hiba', contentAlt: 'Tartalom: alt szövegek' };

let run = null, es = null, selected = null, settings = null;
let csvClients = {};

// ---------- domain-számláló
function parseDomains(t) {
  const out = [];
  for (const part of t.split(/[\s,;]+/)) { if (!part || part.startsWith('#')) continue; try { const u = new URL(/^https?:\/\//i.test(part) ? part : 'https://' + part); const h = u.hostname.toLowerCase(); if (h.includes('.') && !out.includes(h)) out.push(h); } catch {} }
  return out;
}
// CSV / TXT: az első domain-szerű cella a domain, az első másik nem üres cella az ügyfél neve
$('#csvFile').addEventListener('change', async e => {
  const f = e.target.files[0]; if (!f) return;
  if (f.size > 1e6) { alert('A fájl túl nagy.'); e.target.value = ''; return; }
  const txt = (await f.text()).replace(/^\uFEFF/, '');
  const delim = [';', '\t', ','].find(d => txt.split('\n').slice(0, 5).some(l => l.includes(d))) || ';';
  const doms = []; csvClients = {};
  for (const line of txt.split(/\r?\n/)) {
    const cells = line.split(delim).map(c => c.trim().replace(/^"|"$/g, '')).filter(Boolean); if (!cells.length) continue;
    const di = cells.findIndex(c => parseDomains(c).length === 1 && !/\s/.test(c));
    if (di < 0) continue;
    const d = parseDomains(cells[di])[0]; if (!doms.includes(d)) doms.push(d);
    const cl = cells.find((c, i) => i !== di && !/^(domain|weboldal|url|ügyfél|ugyfel|client)$/i.test(c)); if (cl) csvClients[d] = cl.slice(0, 80);
  }
  $('#domains').value = doms.join('\n'); $('#domains').dispatchEvent(new Event('input'));
  $('#csvInfo').textContent = doms.length ? `${doms.length} domain betöltve, ${Object.keys(csvClients).length} ügyfél-címkével.` : 'Nem találtam domaint a fájlban.';
});
$('#domains').addEventListener('input', () => { const n = parseDomains($('#domains').value).length; $('#count').textContent = `${n} domain`; });

// az űrlap tartalma (a felmérés indítása és az ütemezés mentése közösen használja)
const formBody = () => ({ text: $('#domains').value, clients: csvClients, name: $('#runName').value, webhookUrl: $('#optWebhook').value, spam: $('#optSpam').checked, gdpr: $('#optGdpr').checked, lighthouse: $('#optLh').checked, geo: $('#optGeo').checked, a11y: $('#optA11y').checked, a11yAll: $('#optA11yAll').checked, a11yMax: +$('#optA11yMax').value || 100, w3c: $('#optW3c').checked, links: $('#optLinks').checked, dns: $('#optDns').checked, suggest: $('#optSuggest').checked, suggestPages: +$('#optSuggestPages').value || 10, ai: $('#optAi').checked, geoPages: +$('#optGeoPages').value || 30, device: $('#optDevice').value, pages: +$('#optPages').value || 0, concurrency: +$('#optConc').value });
const admin = initAdmin({ $, api, esc, formBody });
admin.loadMe();

// ---------- indítás
$('#btnStart').addEventListener('click', async () => {
  const text = $('#domains').value;
  if (!parseDomains(text).length) { $('#domains').focus(); return; }
  $('#btnStart').disabled = true;
  try {
    const { id } = await api('/api/runs', { method: 'POST', body: JSON.stringify(formBody()) });
    openRun(id);
  } catch (e) { alert(e.message); }
  $('#btnStart').disabled = false;
});

function openRun(id) {
  if (es) es.close();
  $('#results').classList.remove('hidden');
  $('#log').textContent = '';
  history.replaceState(null, '', '#' + id);
  es = new EventSource(`/api/runs/${id}/events`);
  es.addEventListener('snapshot', e => { run = JSON.parse(e.data); render(); });
  es.addEventListener('site', e => { const s = JSON.parse(e.data); if (run) { run.sites[s.domain] = s; renderRow(s); renderMeta(); if (selected === s.domain) renderDrawer(s); } });
  es.addEventListener('log', e => { const l = JSON.parse(e.data); $('#log').textContent += new Date(l.t).toLocaleTimeString('hu-HU') + '  ' + l.msg + '\n'; });
  es.addEventListener('done', async () => { es.close(); es = null; run = await api(`/api/runs/${id}`); render(); });
  $('#results').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------- megjelenítés
function render() {
  const tb = $('#tbl tbody'); tb.innerHTML = '';
  const order = Object.values(run.sites).sort((a, b) => (prio(a) - prio(b)) || a.domain.localeCompare(b.domain));
  for (const s of order) tb.appendChild(rowEl(s));
  renderMeta(); buildClientFilter();
  const q = `/api/runs/${run.id}/export/`;
  $('#expProp').href = q + 'javaslatok'; $('#expMail').href = q + 'emailek'; $('#expXlsx').href = q + 'xlsx'; $('#expHtml').href = q + 'html'; $('#expPdf').href = q + 'pdf'; $('#expCsv').href = q + 'csv';
  document.querySelectorAll('.hcol').forEach(el => el.classList.toggle('hidden', settings && settings.showHours === false));
}
const prio = s => s.result?.priority ?? (s.state === 'done' ? 5 : 8);
function renderMeta() {
  const all = Object.values(run.sites), done = all.filter(s => s.state === 'done' || s.state === 'failed').length;
  $('#resTitle').textContent = run.options?.name || 'Eredmények';
  $('#resMeta').textContent = `${new Date(run.createdAt).toLocaleString('hu-HU')} · ${done} / ${all.length} kész` + (run.browserError ? ' · böngészős mérés nem futott: ' + run.browserError : '');
  $('#bar').style.width = (100 * done / all.length) + '%';
  const finished = run.finished || done === all.length;
  $('#btnCancel').classList.toggle('hidden', finished);
  document.querySelectorAll('.exports .btn').forEach(a => a.setAttribute('aria-disabled', done ? 'false' : 'true'));
  const R = all.map(s => s.result).filter(Boolean);
  const c = (f) => R.filter(f).length;
  const sumH = k => fmtH(R.reduce((a, r) => a + (r.totals?.[k] || 0), 0));
  const showH = !settings || settings.showHours !== false;
  $('#stats').innerHTML = [
    ['Éles', c(r => r.status === 'ok')], ['Nem működő', c(r => ['down', 'error'].includes(r.status)), 'bad'], ['Feltört', c(r => r.flags?.hacked), 'bad'], ['Kritikus hiba', R.reduce((a, r) => a + (r.flags?.critical || 0), 0)], ['GDPR nem megfelelő', c(r => /Nem megfelelő/.test(r.gdprState || ''))],
    ...(showH ? [['Rendbetétel óra', sumH('kotelezo')], ['Opcionális óra', fmtH(R.reduce((a, r) => a + (r.totals?.gdpr || 0) + (r.totals?.seo || 0) + (r.totals?.tartalom || 0), 0))]] : []),
  ].map(([l, v, cls]) => `<span class="stat ${cls && +v ? cls : ''}"><b>${v}</b>${l}</span>`).join('');
}
function rowEl(s) { const tr = document.createElement('tr'); tr.dataset.d = s.domain; tr.dataset.client = s.client || ''; tr.innerHTML = rowHtml(s); tr.addEventListener('click', () => { selected = s.domain; document.querySelectorAll('#tbl tr.sel').forEach(x => x.classList.remove('sel')); tr.classList.add('sel'); renderDrawer(run.sites[s.domain]); }); return tr; }
function renderRow(s) { const tr = document.querySelector(`#tbl tr[data-d="${CSS.escape(s.domain)}"]`); if (tr) tr.innerHTML = rowHtml(s); else $('#tbl tbody').appendChild(rowEl(s)); }
function rowHtml(s) {
  const R = s.result;
  const busy = s.state !== 'done' && s.state !== 'failed';
  const st = R ? STATUS[R.status] || [R.status, ''] : null;
  const stCell = busy ? `<span class="spin"></span>${esc(STATE[s.state] || s.state)}${s.step ? ' · ' + esc(s.step) : ''}` : s.state === 'failed' ? `<span class="chip c-bad">hiba</span> ${esc(s.step)}` : `<span class="chip ${st[1]}">${esc(st[0])}</span>`;
  const cl = s.client ? `<small class="cl">${esc(s.client)}</small>` : '';
  if (!R) return `<td class="dom">${esc(s.domain)}${cl}</td><td>${stCell}</td><td colspan="8"></td>`;
  const el = (R.plugins || []).find(p => p.slug === 'elementor');
  const builder = (R.detected?.builder || []).filter(b => b !== 'Elementor Pro').map(b => b === 'Elementor' && el?.version ? `Elementor ${el.version}` : b).join(', ');
  const wpv = R.wp?.version ? `${R.wp.version}${R.wp.gap?.behind ? ` <span class="hint">→ ${esc(R.wp.latest)}</span>` : ''}` : (R.wp?.isWp ? '?' : '–');
  const php = R.server?.php ? `<span class="${R.server.php.isEol ? 'chip c-bad' : ''}">${esc(R.server.php.ver)}</span>` : '';
  const spam = R.spam ? (R.spam.confirmed ? `<span class="chip c-bad">${R.spam.truncated ? '≥' : ''}${R.spam.confirmed}${R.spam.recent ? ' aktív' : ''}</span>` : '0') : '';
  const g = R.gdprState || ''; const gc = /Nem megfelelő/.test(g) ? 'c-bad' : /Hiányos/.test(g) ? 'c-warn' : g === 'Rendben' ? 'c-ok' : '';
  const lhChip = x => x && !x.error ? `<span class="chip ${x.perf >= 90 ? 'c-ok' : x.perf >= 50 ? 'c-warn' : 'c-bad'}" title="${x.device === 'desktop' ? 'asztali' : 'mobil'}">${x.perf}</span>` : (x?.error ? '<span class="hint">hiba</span>' : '');
  const lh = [R.lighthouse, R.lighthouseDesktop].filter(Boolean).map(lhChip).join(' ');
  const geoC = R.geo && !R.geo.error ? `<span class="chip ${R.geo.score >= 85 ? 'c-ok' : R.geo.score >= 60 ? 'c-warn' : 'c-bad'}" title="${esc(R.geo.label)}">${R.geo.score}</span>` : (R.geo?.error ? '<span class="hint" title="' + esc(R.geo.error) + '">hiba</span>' : '');
  const t = R.totals || {};
  const showH = !settings || settings.showHours !== false;
  return `<td class="dom">${esc(s.domain)}${cl}${R.wp?.siteName ? `<small>${esc(R.wp.siteName)}</small>` : ''}</td><td>${stCell}</td><td>${wpv}</td><td>${esc(builder)}</td><td>${php}</td><td class="num">${spam}</td><td>${g ? `<span class="chip ${gc}">${esc(g)}</span>` : ''}</td><td class="num">${geoC}</td><td class="num">${lh}</td><td class="num">${R.flags?.critical || 0} / ${R.flags?.high || 0}</td><td class="num hcol ${showH ? '' : 'hidden'}">${fmtH(t.kotelezo)} <span class="hint">+ ${fmtH((t.gdpr || 0) + (t.seo || 0) + (t.tartalom || 0))}</span></td>`;
}

const lhLine = x => x.error ? x.error : `Perf ${x.perf} · A11y ${x.a11y} · BP ${x.bp} · SEO ${x.seo} · LCP ${x.lcp} s · ${Math.round((x.totalKB || 0) / 102.4) / 10} MB`;

const chipCls = r => (r === 'good' ? 'c-ok' : r === 'mid' ? 'c-warn' : r === 'bad' ? 'c-bad' : '');
const pth = u => { try { const x = new URL(u); return x.pathname === '/' ? 'Főoldal' : x.pathname; } catch { return u; } };
const expl = (rows, head) => `<details class="expl"><summary>${head}</summary><dl>${rows.map(([n, w, g]) => `<dt>${esc(n)}</dt><dd>${esc(w)} <em>${esc(g)}</em></dd>`).join('')}</dl></details>`;

function exportBar(s) {
  const q = `/api/runs/${run.id}/export/`, sq = '?sites=' + encodeURIComponent(s.domain);
  return `<div class="dexp"><span class="hint">Letöltés csak ehhez a domainhez:</span> <a class="btn" href="${q}pdf${sq}">Riport <small>pdf</small></a> <a class="btn" href="${q}csv${sq}">Szövegek <small>csv</small></a> <a class="btn" href="${q}javaslatok${sq}">Javaslatok <small>docx</small></a> <a class="btn" href="${q}emailek${sq}">Sablon e-mail <small>docx</small></a> <a class="btn" href="${q}xlsx${sq}">Táblázat <small>xlsx</small></a> <a class="btn" href="${q}html${sq}">Riport <small>html</small></a></div>`;
}

function lhSection(R) {
  const rows = LHX.lhRows(R);
  if (!rows.length && !R.lighthousePagesNote) return '';
  let h = '<h4 class="grp">Lighthouse: sebesség és minőség</h4>';
  if (rows.length) {
    h += `<div class="wrapx"><table class="mini"><thead><tr><th>Oldal</th><th>Profil</th>${LHX.COLS.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map(r => { const c = LHX.cells(r); return c ? `<tr><td title="${esc(r.url)}">${esc(r.page)}</td><td>${LHX.deviceHu(r.device)}</td>${c.map(x => `<td class="num"><span class="chip ${chipCls(x.rating)}">${esc(x.text)}</span></td>`).join('')}</tr>` : `<tr><td>${esc(r.page)}</td><td>${LHX.deviceHu(r.device)}</td><td colspan="${LHX.COLS.length}" class="hint">${esc(r.x.error)}</td></tr>`; }).join('')}</tbody></table></div>`;
    h += `<p class="hint">${esc(LHX.LEGEND)}</p>`;
    const v = rows.filter(r => r.home).map(LHX.verdict).filter(Boolean);
    if (v.length) h += `<div class="verdict"><b>Értékelés</b>${v.map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
    const opp = rows.filter(r => r.x.opportunities?.length);
    if (opp.length) h += `<details class="expl"><summary>Fő javítási lehetőségek oldalanként</summary>${opp.map(r => `<p><b>${esc(r.page)}</b> (${LHX.deviceHu(r.device)})</p><ul>${r.x.opportunities.map(o => `<li>${esc(o.title)} <span class="hint">(kb. ${String(+(o.savingsMs / 1000).toFixed(1)).replace('.', ',')} s nyereség)</span></li>`).join('')}</ul>`).join('')}</details>`;
    h += expl(LHX.EXPLAIN, 'Mit jelentenek ezek az értékek?');
  }
  if (R.lighthousePagesNote) h += `<p class="hint">${esc(R.lighthousePagesNote)}</p>`;
  return h;
}

function seoSection(R) {
  const g = R.geo; if (!g || g.error || !g.pages?.length) return '';
  const rows = g.pages.map(SX.seoRow);
  const cell = (c, txt) => `<td><span class="chip ${chipCls(c.rating)}" title="${esc(c.text || '')}">${esc(txt)}</span><small class="sub">${esc(c.note || '')}</small></td>`;
  let h = '<h4 class="grp">SEO és GEO oldalanként</h4>';
  const v = SX.seoVerdict(g.pages); if (v) h += `<div class="verdict"><b>Értékelés</b><p>${esc(v)}</p></div>`;
  h += `<div class="wrapx"><table class="mini"><thead><tr><th>Oldal</th><th>Title</th><th>Description</th><th>H1</th><th>Canonical</th><th>Szavak</th><th>GEO-pont</th></tr></thead><tbody>${rows.map(r => r.failed ? `<tr><td title="${esc(r.url)}">${esc(pth(r.url))}</td><td colspan="6" class="hint">${esc(r.note)}</td></tr>` : `<tr><td title="${esc(r.url)}">${esc(pth(r.url))}</td>${cell(r.title, r.title.len + ' kar.')}${cell(r.desc, r.desc.len ? r.desc.len + ' kar.' : 'nincs')}<td class="num"><span class="chip ${chipCls(r.h1.rating)}">${r.h1.n}</span></td><td class="num"><span class="chip ${chipCls(r.canonical.rating)}">${r.canonical.ok ? 'van' : 'nincs'}</span></td><td class="num"><span class="chip ${chipCls(r.words.rating)}">${r.words.n}</span></td><td class="num"><span class="chip ${r.score >= 80 ? 'c-ok' : r.score >= 50 ? 'c-warn' : 'c-bad'}">${r.score}</span></td></tr>`).join('')}</tbody></table></div>`;
  h += `<p class="hint">A szín a jó / közepes / rossz értékelést jelzi; a title és description teljes szövegét az egér fölé víve látod.</p>`;
  h += expl(SX.SEO_EXPLAIN, 'Mit jelentenek ezek az értékek, és mi a jó?');
  return h;
}

function renderDrawer(s) {
  if (!s) return;
  const R = s.result || {};
  $('#drawer').classList.remove('hidden');
  $('#dTitle').textContent = s.domain;
  const showH = !settings || settings.showHours !== false;
  const facts = [
    ['Állapot', R.status ? (STATUS[R.status]?.[0] || R.status) + (R.reach?.redirectTo ? ' → ' + R.reach.redirectTo : '') : STATE[s.state]],
    ['WordPress', R.wp?.version ? `${R.wp.version}${R.wp.latest ? ' (legújabb: ' + R.wp.latest + ')' : ''} · ${R.wp.versionSource}` : (R.wp?.isWp ? 'verzió nem látszik' : '')],
    ['Téma', (R.theme || []).map(t => `${t.name} ${t.version || ''}${t.outdated ? ' → ' + t.latest : ''}`).join(' / ')],
    ['Builder', (R.detected?.builder || []).join(', ')], ['Szerver', [R.server?.server, R.server?.poweredBy, R.server?.cdn].filter(Boolean).join(' · ')],
    ['SSL', R.cert?.validTo ? `${R.cert.issuer || ''}, lejár: ${R.cert.validTo.slice(0, 10)} (${R.cert.daysLeft} nap)` : (R.cert?.error || '')],
    ['Becsült méret', R.tier ? { S: 'egyszerű', M: 'közepes', L: 'összetett' }[R.tier] : ''],
    ['Biztonsági bővítmény', (R.detected?.security || []).join(', ') || (R.wp?.isWp ? 'nem látható' : '')], ['SEO', (R.detected?.seo || []).join(', ')], ['Gyorsítótár', (R.detected?.cache || []).join(', ')],
    ['Süti-kezelő', (R.detected?.cookie || []).join(', ')], ['Webshop / nyelv / foglalás', [...(R.detected?.ecommerce || []), ...(R.detected?.multilang || []), ...(R.detected?.booking || [])].join(', ')],
    ['Tartalom', R.content?.posts != null ? `${R.content.posts} bejegyzés, ${R.content.pages} oldal, ${R.content.media} média` : ''],
    ['TTFB / HTML', R.reach?.ttfb ? `${R.reach.ttfb} ms / ${R.reach.htmlKB} KB` : ''],
    ...(R.aiSummary ? [['MI-összefoglaló', R.aiSummary.error ? R.aiSummary.error : `${R.aiSummary.text}\n(${R.aiSummary.model}, ${R.aiSummary.seconds} mp; az MI szövege tájékoztató, átnézendő)`]] : []),
    ...(R.geo ? [['GEO', R.geo.error ? R.geo.error : `${R.geo.score}/100 – ${R.geo.label} · ${R.geo.areas.map(a => `${a.label} ${a.score}/${a.max}`).join(' · ')}`], ...(R.geo.error ? [] : [['GEO oldalak', `${R.geo.pagesChecked} oldal: ${R.geo.health.strong} erős, ${R.geo.health.solid} jó, ${R.geo.health.needs} fejlesztendő, ${R.geo.health.weak} gyenge${R.geo.fromSitemap ? '' : ' (sitemap nélkül, a főoldal linkjeiből)'}`], ['AI-botok', `${R.geo.botsBlocked.length ? 'robots.txt tiltja: ' + R.geo.botsBlocked.join(', ') : 'robots.txt nem tiltja'} · ${R.geo.aiBots.filter(b => b.blocked).length ? 'blokkolva: ' + R.geo.aiBots.filter(b => b.blocked).map(b => b.name).join(', ') : 'elérik az oldalt'} · llms.txt: ${R.geo.llms ? 'van' : 'nincs'}`]])] : []),
    ['Süti-sáv', R.gdpr && !R.gdpr.error ? (R.gdpr.banner ? `van · gombok: ${(R.gdpr.buttons || []).join(' / ')}` : 'nem jelent meg') : (R.gdpr?.error || '')],
    ['Hozzájárulás előtt', R.gdpr && !R.gdpr.error ? [...R.gdpr.preConsent, ...R.gdpr.embeds, ...(R.gdpr.trackerCookies || []).map(c => c + ' süti')].join(', ') || 'semmi' : ''],
    ['Spam', R.spam ? `${R.spam.confirmed} megerősített (${R.spam.method})${R.spam.samples?.length ? ' · pl. „' + R.spam.samples[0].title + '”' : ''}` : ''],
  ].filter(([, v]) => v);
  let html = `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  html = exportBar(s) + html + compareHtml(R, { esc }) + seoSection(R) + lhSection(R) + checksHtml(R, { esc }) + solHtml(R, { esc, interactive: true });
  if (R.screenshot) html += `<img class="shot" alt="Első nézet hozzájárulás előtt" src="/api/runs/${run.id}/shot/${encodeURIComponent(R.screenshot)}">`;
  for (const [g, label] of Object.entries(GROUPS)) {
    const fs = (R.findings || []).filter(f => f.group === g); if (!fs.length) continue;
    html += `<h4 class="grp">${esc(label)}${showH ? `<span>${fmtH(fs.reduce((a, f) => a + (f.hours || 0), 0))} óra</span>` : ''}</h4>`;
    html += fs.map(f => `<div class="find"><span class="sev ${f.base ? '' : esc(f.sev)}">${f.base ? 'alap' : esc(f.sev)}</span><div><b>${esc(f.title)}</b>${f.detail ? `<small>${esc(f.detail)}</small>` : ''}<em>${esc(f.fix)}</em></div><span class="hh">${showH ? (f.noEstimate ? 'n. b.' : fmtH(f.hours)) : ''}</span></div>`).join('');
  }
  if (R.plugins?.length) html += `<details class="pl"><summary>Felismert pluginok (${R.plugins.length})</summary><table><thead><tr><th>Plugin</th><th>Verzió</th><th>Legújabb</th></tr></thead><tbody>${R.plugins.map(p => `<tr><td>${esc(p.name)}${p.risky ? ' ⚠' : ''}</td><td>${esc(p.version || '?')}</td><td class="${p.outdated ? 'mid' : ''}">${esc(p.latest || (p.notOnWporg ? 'prémium' : ''))}</td></tr>`).join('')}</tbody></table></details>`;
  if (s.state !== 'done') html += `<p class="hint">Mérés folyamatban…</p>`;
  $('#dBody').innerHTML = html;
}
$('#dClose').addEventListener('click', () => { $('#drawer').classList.add('hidden'); selected = null; document.querySelectorAll('#tbl tr.sel').forEach(x => x.classList.remove('sel')); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#drawer').classList.contains('hidden')) $('#dClose').click(); });
$('#btnCancel').addEventListener('click', () => run && api(`/api/runs/${run.id}/cancel`, { method: 'POST' }));

// ---------- beállítások
async function loadSettings() { settings = await api('/api/settings'); }
let logoData = '';
const showLogo = () => { const im = $('#sLogoPrev'); im.style.display = logoData ? 'inline' : 'none'; if (logoData) im.src = logoData; };
$('#sLogo').addEventListener('change', e => { const f = e.target.files[0]; if (!f) return; if (f.size > 250000) { alert('A logó túl nagy (legfeljebb ~250 KB).'); e.target.value = ''; return; } const rd = new FileReader(); rd.onload = () => { logoData = String(rd.result); showLogo(); }; rd.readAsDataURL(f); });
$('#sLogoClear').addEventListener('click', () => { logoData = ''; $('#sLogo').value = ''; showLogo(); });
function fillSettings() {
  $('#sName').value = settings.author.name || ''; $('#sCompany').value = settings.author.company || ''; $('#sOrg').value = settings.senderOrg || ''; $('#sPhone').value = settings.author.phone || ''; $('#sEmail').value = settings.author.email || ''; $('#sShowHours').checked = settings.showHours !== false;
  $('#sRate').value = settings.hourlyRate || ''; $('#sVat').value = settings.vatPercent ?? 27; $('#sCur').value = settings.currency || 'Ft'; $('#sColor').value = settings.brandColor || '#1f3864'; logoData = settings.logo || ''; showLogo();
  $('#hours').innerHTML = Object.entries(settings.hours).map(([k, v]) => `<label for="h_${k}" style="margin:0;font-weight:400">${esc(HOUR_LABELS[k] || k)}</label><input id="h_${k}" data-k="${k}" type="number" min="0" step="0.25" value="${v}">`).join('');
}
$('#btnSettings').addEventListener('click', () => { fillSettings(); admin.renderAccess(); $('#dlgSettings').showModal(); });
$('#sReset').addEventListener('click', async () => { settings = await api('/api/settings/reset', { method: 'POST' }); fillSettings(); });
$('#sSave').addEventListener('click', async e => {
  e.preventDefault();
  const hours = {}; document.querySelectorAll('#hours input').forEach(i => { hours[i.dataset.k] = +i.value; });
  settings = await api('/api/settings', { method: 'PUT', body: JSON.stringify({ author: { name: $('#sName').value, company: $('#sCompany').value, phone: $('#sPhone').value, email: $('#sEmail').value }, senderOrg: $('#sOrg').value, showHours: $('#sShowHours').checked, hourlyRate: +$('#sRate').value || 0, vatPercent: +$('#sVat').value || 0, currency: $('#sCur').value, brandColor: $('#sColor').value, logo: logoData, hours }) });
  $('#dlgSettings').close();
  if (run && run.finished) { run = await api(`/api/runs/${run.id}/reanalyze`, { method: 'POST' }); render(); if (selected) renderDrawer(run.sites[selected]); }
});

// ---------- korábbi futások
$('#btnRuns').addEventListener('click', async () => {
  const list = await api('/api/runs');
  $('#runList').innerHTML = list.length ? list.map(r => `<li><div><b>${esc(r.name || 'Felmérés')}</b><div class="meta">${new Date(r.createdAt).toLocaleString('hu-HU')} · ${r.count} domain${r.finished ? '' : ' · folyamatban'}</div></div><div><button class="ghost" data-open="${r.id}" type="button">Megnyitás</button> <button class="ghost" data-del="${r.id}" type="button" aria-label="Törlés">Törlés</button></div></li>`).join('') : '<li class="empty">Még nincs mentett felmérés.</li>';
  $('#dlgRuns').showModal();
});
$('#runList').addEventListener('click', async e => {
  const o = e.target.dataset.open, d = e.target.dataset.del;
  if (o) { $('#dlgRuns').close(); openRun(o); }
  if (d && confirm('Biztosan törlöd ezt a felmérést?')) { await api(`/api/runs/${d}`, { method: 'DELETE' }); e.target.closest('li').remove(); }
});
$('#rClose').addEventListener('click', () => $('#dlgRuns').close());

await loadSettings();
if (location.hash.length > 2) openRun(location.hash.slice(1));

Object.assign(HOUR_LABELS, {
  geoRobots: 'GEO: AI-botok engedélyezése (robots.txt)', geoWaf: 'GEO: tűzfal / bot-védelem hangolása AI-botokhoz', geoLlms: 'GEO: llms.txt',
  geoSchema: 'GEO: Organization / LocalBusiness séma', geoSchemaPages: 'GEO: oldaltípusonkénti strukturált adat', geoSchemaFix: 'GEO: hibás JSON-LD javítása',
  geoBreadcrumb: 'GEO: BreadcrumbList', geoEntity: 'GEO: sameAs / külső profilok', geoContent: 'GEO: szerveroldali szöveg (JS-függőség)',
  geoHeadings: 'GEO: címsor-szerkezet', geoFaq: 'GEO: GYIK / válasz-orientált tartalom', geoMeta: 'GEO: meta description', geoLang: 'GEO: nyelvi jelek (lang, hreflang)',
  geoTrust: 'GEO: megbízhatósági oldalak és elérhetőség', geoFresh: 'GEO: dátumok (published / modified)',
});

// helyi MI elérhetősége: ha az Ollama vagy a modell nem áll készen, a jelölőnégyzet kikapcsol
fetch('/api/ai/status').then(r => r.json()).then(s => {
  const cb = $('#optAi'), hint = $('#aiHint');
  if (!s.available) { cb.disabled = true; cb.checked = false; hint.textContent = s.reason || 'nem elérhető'; const c2 = $('#optSuggest'); c2.disabled = true; c2.checked = false; $('#suggestHint').textContent = s.reason || 'nem elérhető'; }
}).catch(() => {});

Object.assign(HOUR_LABELS, { seoTitles: 'SEO: oldalcímek (title) rendbetétele', seoCanonical: 'SEO: canonical beállítása' });

// másolás gombok a javaslatoknál
document.addEventListener('click', async e => {
  const b = e.target.closest?.('button.cp'); if (!b) return;
  const text = b.dataset.copy ?? b.closest('.codebox')?.querySelector('pre')?.textContent ?? '';
  try { await navigator.clipboard.writeText(text); const t = b.textContent; b.textContent = 'Kimásolva'; setTimeout(() => { b.textContent = t; }, 1400); } catch { b.textContent = 'Nem sikerült'; }
});

Object.assign(HOUR_LABELS, { a11yFix: 'Akadálymentesség: súlyos hibák javítása', linkFix: 'Törött belső linkek javítása', linkExtFix: 'Törött külső linkek javítása', mailFix: 'E-mail hitelesítés (SPF / DMARC) beállítása', mailTune: 'E-mail hitelesítés finomhangolása', domainRenew: 'Domain megújítása / automatikus megújítás', vulnFix: 'Ismert sebezhetőség javítása (komponensenként)' });

// ügyfél szerinti szűrés
function buildClientFilter() {
  const names = [...new Set(Object.values(run.sites).map(s => s.client).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'hu'));
  const bar = $('#clientBar'), sel = $('#clientFilter');
  bar.classList.toggle('hidden', names.length < 2);
  const keep = sel.value;
  sel.innerHTML = '<option value="">Mind (' + Object.keys(run.sites).length + ')</option>' + names.map(n => '<option value="' + esc(n) + '">' + esc(n) + '</option>').join('');
  if (names.includes(keep)) sel.value = keep;
  applyClientFilter();
}
function applyClientFilter() { const v = $('#clientFilter').value; document.querySelectorAll('#tbl tbody tr').forEach(tr => tr.classList.toggle('hidden', !!v && tr.dataset.client !== v)); }
$('#clientFilter').addEventListener('change', applyClientFilter);

// a W3C-validáláshoz Java kell: ha a gépen nincs, a jelölőnégyzet kikapcsol
fetch('/api/me').then(r => r.json()).then(m => { if (m.capabilities && !m.capabilities.w3c) { const c = $('#optW3c'); c.checked = false; c.disabled = true; $('#w3cHint').textContent = 'a Java nincs telepítve (Dockerben elérhető)'; } }).catch(() => {});
Object.assign(HOUR_LABELS, { w3cFix: 'W3C HTML-hibák javítása' });

Object.assign(HOUR_LABELS, { a11ySite: 'Akadálymentesség: teljes sitemap hibáinak javítása' });
