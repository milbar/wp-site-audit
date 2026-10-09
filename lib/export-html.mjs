// Önálló, egyfájlos HTML-riport (megosztható, böngészőben megnyitható)
import fs from 'node:fs';
import path from 'node:path';
import { summarize, sortSites, fmtH } from './summary.mjs';
import { GROUPS } from './rules.mjs';
import * as LHX from '../public/lh-explain.mjs';
import * as SX from '../public/seo-explain.mjs';
import { solHtml } from '../public/solutions-ui.mjs';
import { compareHtml } from '../public/compare-ui.mjs';
import { checksHtml } from '../public/checks-ui.mjs';
import { buildQuote } from './brand.mjs';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SEV = { kritikus: 'sev-k', magas: 'sev-m', 'közepes': 'sev-kz', alacsony: 'sev-a', info: 'sev-i' };
const scc = v => v == null ? '' : v >= 90 ? 'good' : v >= 50 ? 'mid' : 'bad';

function quoteHtml(S, settings, showH) {
  const q = buildQuote(S, settings); if (!q) return '';
  const rows = q.rows.map(r => `<tr><td>${esc(r.domain)}</td>${showH ? `<td class="num">${fmtH(r.hoursBase)}</td>` : ''}<td class="num">${esc(q.money(r.netBase))}</td>${showH ? `<td class="num">${fmtH(r.hoursOpt)}</td>` : ''}<td class="num">${esc(q.money(r.netOpt))}</td></tr>`).join('');
  return `<h3>Árajánlat (tájékoztató)</h3><div class="wrap"><table class="t2"><thead><tr><th>Weboldal</th>${showH ? '<th>Rendbetétel (óra)</th>' : ''}<th>Rendbetétel (nettó)</th>${showH ? '<th>Opcionális (óra)</th>' : ''}<th>Opcionális (nettó)</th></tr></thead><tbody>${rows}<tr><td><b>Összesen (nettó)</b></td>${showH ? `<td class="num"><b>${fmtH(q.total.hoursBase)}</b></td>` : ''}<td class="num"><b>${esc(q.money(q.total.netBase))}</b></td>${showH ? `<td class="num"><b>${fmtH(q.total.hoursOpt)}</b></td>` : ''}<td class="num"><b>${esc(q.money(q.total.netOpt))}</b></td></tr></tbody></table></div><p class="facts">Óradíj: ${esc(q.money(q.rate))} + ${q.vat}% ÁFA. Rendbetétel bruttó: ${esc(q.money(q.total.grossBase))}; opcionális tételek bruttó: ${esc(q.money(q.total.grossOpt))}. Az árak a becsült óraszámokból számolt, tájékoztató jellegű összegek.</p>`;
}
const cls = r => (r === 'good' ? 'good' : r === 'mid' ? 'mid' : r === 'bad' ? 'bad' : '');
const pth = u => { try { const x = new URL(u); return x.pathname === '/' ? 'Főoldal' : x.pathname; } catch { return u; } };
const explBlock = (title, rows) => `<details class="ex" open><summary>${esc(title)}</summary><dl>${rows.map(([n, w, g]) => `<dt>${esc(n)}</dt><dd>${esc(w)} <em>${esc(g)}</em></dd>`).join('')}</dl></details>`;
function lhBlock(R) {
  const rows = LHX.lhRows(R); if (!rows.length) return '';
  const body = rows.map(r => { const c = LHX.cells(r); return c ? `<tr><td>${esc(r.page)}</td><td>${LHX.deviceHu(r.device)}</td>${c.map(x => `<td class="num ${cls(x.rating)}">${esc(x.text)}</td>`).join('')}</tr>` : `<tr><td>${esc(r.page)}</td><td>${LHX.deviceHu(r.device)}</td><td colspan="${LHX.COLS.length}">${esc(r.x.error)}</td></tr>`; }).join('');
  const v = rows.filter(r => r.home).map(LHX.verdict).filter(Boolean).map(t => `<p>${esc(t)}</p>`).join('');
  return `<h4>Lighthouse: sebesség és minőség</h4><div class="wrap"><table class="t2"><thead><tr><th>Oldal</th><th>Profil</th>${LHX.COLS.map(c => `<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>${v ? `<div class="verdict"><b>Értékelés</b>${v}</div>` : ''}`;
}
function seoBlock(R) {
  const g = R.geo; if (!g || g.error || !g.pages?.length) return '';
  const rows = g.pages.map(SX.seoRow);
  const cell = (c, t) => `<td class="${cls(c.rating)}">${esc(t)}<small>${esc(c.note)}</small></td>`;
  const body = rows.map(r => r.failed ? `<tr><td>${esc(pth(r.url))}</td><td colspan="6">${esc(r.note)}</td></tr>` : `<tr><td title="${esc(r.url)}">${esc(pth(r.url))}</td>${cell(r.title, r.title.len + ' kar.')}${cell(r.desc, r.desc.len ? r.desc.len + ' kar.' : 'nincs')}<td class="num ${cls(r.h1.rating)}">${r.h1.n}</td><td class="num ${cls(r.canonical.rating)}">${r.canonical.ok ? 'van' : 'nincs'}</td><td class="num ${cls(r.words.rating)}">${r.words.n}</td><td class="num ${r.score >= 80 ? 'good' : r.score >= 50 ? 'mid' : 'bad'}">${r.score}</td></tr>`).join('');
  const v = SX.seoVerdict(g.pages);
  return `<h4>SEO és GEO oldalanként <span class="h">(${g.pagesChecked} oldal, GEO: ${g.score}/100 – ${esc(g.label)})</span></h4>${v ? `<div class="verdict"><b>Értékelés</b><p>${esc(v)}</p></div>` : ''}<div class="wrap"><table class="t2"><thead><tr><th>Oldal</th><th>Title</th><th>Description</th><th>H1</th><th>Canonical</th><th>Szavak</th><th>GEO-pont</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

export function exportHtml(run, { settings, shotDir, print = false }) {
  const brand = /^#[0-9a-f]{6}$/i.test(settings.brandColor || '') ? settings.brandColor : '#1f3864';
  const logo = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(settings.logo || '') ? settings.logo : '';
  const showH = settings.showHours !== false;
  const sites = sortSites(run.sites);
  const S = sites.map(summarize);
  const rows = S.map(s => `<tr class="${s.hacked ? 'hk' : s.critical ? 'cr' : ''}"><td><a href="#${esc(s.domain)}">${esc(s.domain)}</a>${s.client ? `<small style="display:block;color:var(--mut)">${esc(s.client)}</small>` : ''}</td><td>${esc(s.status)}</td><td>${esc(s.wp)}</td><td>${esc(s.builder)}</td><td>${esc(s.php)}</td><td>${esc(s.spam)}</td><td>${esc(s.gdpr)}</td>${['perf', 'a11y', 'bp', 'seo'].map(k => `<td class="num ${scc(s.lh?.[k])}">${s.lh?.[k] ?? ''}</td>`).join('')}<td class="num">${s.critical || ''}</td><td class="num">${s.high || ''}</td>${showH ? `<td class="num">${fmtH(s.totals.kotelezo || 0)}</td><td class="num">${fmtH((s.totals.gdpr || 0) + (s.totals.seo || 0) + (s.totals.tartalom || 0))}</td>` : ''}</tr>`).join('');
  const details = sites.map((site, i) => {
    const R = site.result || {}; const s = S[i];
    let shot = '';
    if (R.screenshot && shotDir && fs.existsSync(path.join(shotDir, R.screenshot))) shot = `<img class="shot" alt="Első nézet" src="data:image/jpeg;base64,${fs.readFileSync(path.join(shotDir, R.screenshot)).toString('base64')}">`;
    const groups = Object.keys(GROUPS).map(g => { const fs_ = (R.findings || []).filter(f => f.group === g); if (!fs_.length) return ''; return `<h4>${esc(GROUPS[g])}${showH ? ` <span class="h">${fmtH(fs_.reduce((a, f) => a + (f.hours || 0), 0))} óra</span>` : ''}</h4><ul class="f">${fs_.map(f => `<li><span class="sev ${f.base ? 'sev-b' : SEV[f.sev]}">${f.base ? 'alap' : esc(f.sev)}</span><div><b>${esc(f.title)}</b>${f.detail ? `<small>${esc(f.detail)}</small>` : ''}<em>${esc(f.fix)}</em></div>${showH ? `<span class="hh">${f.noEstimate ? 'n. b.' : fmtH(f.hours || 0)}</span>` : ''}</li>`).join('')}</ul>`; }).join('');
    return `<section id="${esc(site.domain)}"><h3>${esc(site.domain)} <span class="st">${esc(s.status)}</span></h3><p class="facts">${[s.wp !== '–' && 'WP ' + s.wp, s.builder, s.theme && 'Téma: ' + s.theme, s.php && 'PHP ' + s.php, s.plugins && 'Pluginok: ' + s.plugins, s.tier && 'Méret: ' + s.tier, s.geo && `GEO ${s.geo.score}/100 (${s.geo.label}; ${s.geo.areas.map(a => `${a.label} ${a.score}/${a.max}`).join(', ')})`].filter(Boolean).map(esc).join(' · ')}</p>${s.aiSummary ? `<p class="facts" style="white-space:pre-line"><b>MI-összefoglaló</b> <small>(${esc(s.aiSummary.model)}, tájékoztató jellegű)</small><br>${esc(s.aiSummary.text)}</p>` : ''}${shot}${compareHtml(R, { esc })}${seoBlock(R)}${lhBlock(R)}${checksHtml(R, { esc })}${solHtml(R, { esc })}${groups}</section>`;
  }).join('');
  return `<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Felmérés – ${esc(run.options?.name || run.createdAt.slice(0, 10))}</title><style>
:root{--bg:#fff;--fg:#1d2433;--mut:#5b6476;--line:#e3e6ee;--acc:${brand};--k:#f8cbad;--m:#fce4d6;--kz:#fff2cc;--a:#e2efda;--i:#ededed}
@media (prefers-color-scheme:dark){:root{--bg:#14171d;--fg:#e6e9ef;--mut:#9aa3b5;--line:#2a2f3a;--acc:#8fb0ff;--k:#5a2a1c;--m:#4a3020;--kz:#4a4220;--a:#23402a;--i:#2a2f3a}}
body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,Segoe UI,Arial,sans-serif}main{max-width:1180px;margin:0 auto;padding:24px 16px}
h1{color:var(--acc);margin:0 0 4px}h3{margin:28px 0 4px;color:var(--acc)}h4{margin:14px 0 6px}.st,.h{font-weight:400;color:var(--mut);font-size:.85em}
.wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border-bottom:1px solid var(--line);padding:6px 8px;text-align:left;white-space:nowrap}th{background:var(--acc);color:#fff;position:sticky;top:0}
td.num{text-align:center}.good{background:var(--a)}.mid{background:var(--kz)}.bad{background:var(--k)}tr.hk td:first-child{background:var(--k);font-weight:600}tr.cr td:first-child{background:var(--m)}
a{color:var(--acc)}.facts{color:var(--mut);margin:0 0 8px}.shot{max-width:360px;width:100%;border:1px solid var(--line);border-radius:6px;margin:6px 0}
ul.f{list-style:none;padding:0;margin:0}ul.f li{display:grid;grid-template-columns:76px 1fr 44px;gap:10px;padding:7px 0;border-bottom:1px solid var(--line)}ul.f small{display:block;color:var(--mut)}ul.f em{display:block;font-style:normal}
.sev{font-size:11px;padding:2px 6px;border-radius:4px;text-align:center;align-self:start}.sev-k{background:var(--k)}.sev-m{background:var(--m)}.sev-kz{background:var(--kz)}.sev-a{background:var(--a)}.sev-i,.sev-b{background:var(--i)}.hh{text-align:right;color:var(--mut)}
@media (max-width:640px){ul.f li{grid-template-columns:64px 1fr}.hh{display:none}}
.t2 th{position:static}.t2 td{white-space:normal;vertical-align:top}.t2 td small{display:block;color:var(--mut);font-size:11px}
.ftag{display:inline-block;padding:1px 7px;border-radius:4px;font-size:11px;font-weight:700;letter-spacing:.03em;color:#fff}.ftag-t{background:#2f5bb7}.ftag-d{background:#7a4fb5}
.verdict{border-left:3px solid var(--acc);background:rgba(127,127,127,.08);padding:8px 12px;margin:8px 0}.verdict p{margin:4px 0 0}
details.ex{margin:24px 0}details.ex summary{cursor:pointer;font-weight:600;color:var(--acc)}details.ex dt{font-weight:600;margin-top:8px}details.ex dd{margin:2px 0 0;color:var(--mut)}details.ex dd em{display:block;font-style:normal;color:var(--fg)}
h5{margin:14px 0 4px;font-size:13px}.codebox{border:1px solid var(--line);border-radius:8px;margin:6px 0;overflow:hidden}.codehead{padding:4px 10px;background:rgba(127,127,127,.1);font-size:12px;color:var(--mut)}.codebox pre{margin:0;padding:8px 10px;font:12px/1.45 ui-monospace,Consolas,monospace;white-space:pre-wrap;word-break:break-word}
.fix{border-left:3px solid var(--line);padding:2px 0 2px 10px;margin:8px 0}.fix p{margin:2px 0;color:var(--mut)}.fix ul{margin:2px 0 2px 18px;padding:0}ul.faq{margin:4px 0 8px 18px;padding:0}ul.faq li{margin-bottom:6px}.chip{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;background:rgba(127,127,127,.15)}.c-ok{background:var(--a)}.c-warn{background:var(--kz)}.grp{margin:18px 0 6px}.hint{color:var(--mut);font-size:.85em;font-weight:400}.sub{display:block;color:var(--mut);font-size:11px}
@media print{th,td{white-space:normal!important}body{font-size:11px;background:#fff;color:#111}main{max-width:none;padding:0}.wrap{overflow:visible}th{position:static}table{font-size:10px}section{break-before:page}h3,h4{break-after:avoid}tr,li,.fix,.verdict,.codebox{break-inside:avoid}details.ex{break-inside:avoid}.hint{color:#555}a{color:inherit;text-decoration:none}}
${print ? ':root{--bg:#fff;--fg:#1d2433;--mut:#5b6476;--line:#e3e6ee}' : ''}
</style></head><body><main>${logo ? `<img src="${logo}" alt="" style="max-height:48px;margin-bottom:8px">` : ''}<h1>Weboldal-felmérés</h1><p class="facts">${esc(run.options?.name || '')} · ${esc(run.createdAt.slice(0, 16).replace('T', ' '))} · ${S.length} domain · bejelentkezés nélküli, tájékoztató jellegű felmérés</p>
<div class="wrap"><table><thead><tr><th>Domain</th><th>Állapot</th><th>WP</th><th>Builder</th><th>PHP</th><th>Spam</th><th>GDPR</th><th>Perf</th><th>A11y</th><th>BP</th><th>SEO</th><th>Krit.</th><th>Magas</th>${showH ? '<th>Rendbetétel (óra)</th><th>Opcionális (óra)</th>' : ''}</tr></thead><tbody>${rows}</tbody></table></div>${quoteHtml(S, settings, showH)}${details}${S.some(s => s.lh || s.lhPages.length) ? explBlock('Mit jelentenek a Lighthouse-értékek?', LHX.EXPLAIN) + `<p class="facts">${esc(LHX.LEGEND)}</p>` : ''}${S.some(s => s.geo) ? explBlock('Mit jelentenek az SEO / GEO oldalankénti értékek?', SX.SEO_EXPLAIN) : ''}</main></body></html>`;
}
