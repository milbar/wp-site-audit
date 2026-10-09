// További mérések megjelenítése: akadálymentesség, linkek, e-mail és domain, sebezhetőségek, valós látogatói adatok
// (az oldalpanel és a html-riport közösen használja)
const IMPACT_HU = { critical: 'kritikus', serious: 'súlyos', moderate: 'közepes', minor: 'enyhe' };
const IMPACT_CLS = { critical: 'c-bad', serious: 'c-bad', moderate: 'c-warn', minor: '' };
const SEV_CLS = { kritikus: 'c-bad', magas: 'c-bad', 'közepes': 'c-warn', alacsony: '' };

// WCAG-kritériumok magyar nevei (a lib/a11y.mjs listájának másolata a böngészőnek)
const WCAG_HU = { '1.1.1': 'Nem szöveges tartalom', '1.3.1': 'Információ és kapcsolatok', '1.3.2': 'Értelmes sorrend', '1.3.5': 'A beviteli cél azonosítása', '1.4.1': 'Színhasználat', '1.4.3': 'Kontraszt (minimum)', '1.4.4': 'Szöveg átméretezése', '1.4.10': 'Tördelés (reflow)', '1.4.11': 'Nem szöveges kontraszt', '1.4.12': 'Szövegközök', '2.1.1': 'Billentyűzettel használható', '2.1.2': 'Nincs billentyűzet-csapda', '2.4.1': 'Blokkok megkerülése', '2.4.2': 'Az oldal címe', '2.4.3': 'Fókuszsorrend', '2.4.4': 'A link célja (környezetben)', '2.4.6': 'Címsorok és címkék', '2.4.7': 'Látható fókusz', '2.5.3': 'Név a címkében', '2.5.8': 'Célméret (minimum)', '3.1.1': 'Az oldal nyelve', '3.3.2': 'Címkék vagy útmutatás', '4.1.1': 'Értelmezhetőség', '4.1.2': 'Név, szerep, érték' };
const wcagCell = (v, esc) => (v.wcag?.length ? v.wcag.map(c => `<span class="chip" title="${esc(WCAG_HU[c] || '')}">${esc(c)}</span>`).join(' ') + (v.level ? ` <small class="sub">${esc(v.level)} szint</small>` : '') : '<small class="sub">ajánlott gyakorlat</small>');

export function checksHtml(R, { esc }) {
  let h = '';
  const sec = (t, body) => { h += `<h4 class="grp">${esc(t)}</h4>${body}`; };

  const a = R.a11y;
  if (a) {
    if (a.error) sec('Akadálymentesség', `<p class="hint">${esc(a.error)}</p>`);
    else sec('Akadálymentesség: WCAG 2.2 AA (automatikus ellenőrzés, axe-core)', `<p class="hint">Az automata teszt a WCAG-kritériumoknak csak egy részét (kb. 30–40%) tudja megítélni; a megfelelőséget ez nem igazolja, kézi ellenőrzést nem helyettesít. </p><p class="hint">${a.total ? `${a.total} szabálysértés (${a.counts.critical} kritikus, ${a.counts.serious} súlyos, ${a.counts.moderate} közepes, ${a.counts.minor} enyhe), összesen ${a.nodes} érintett elem a főoldalon.` : 'Az automatikus ellenőrzés nem talált szabálysértést. (Az automata teszt a hibák kb. harmadát találja meg; kézi ellenőrzést nem helyettesít.)'}</p>`
      + (a.violations.length ? `<div class="wrapx"><table class="mini"><thead><tr><th>Hiba</th><th>WCAG</th><th>Hatás</th><th>Elem</th><th>Javítás</th></tr></thead><tbody>${a.violations.map(v => `<tr><td>${esc(v.helpHu)}<small class="sub">${esc(v.id)}${v.samples?.[0] ? ' · ' + esc(v.samples[0]) : ''}</small></td><td>${wcagCell(v, esc)}</td><td><span class="chip ${IMPACT_CLS[v.impact] || ''}">${esc(IMPACT_HU[v.impact] || v.impact)}</span></td><td class="num">${v.count}</td><td>${esc(v.fixHu || '')}</td></tr>`).join('')}</tbody></table></div>` : ''));
  }

  const all = R.a11yAll;
  if (all || R.a11yAllNote) {
    if (!all) sec('Akadálymentesség: a teljes sitemap', `<p class="hint">${esc(R.a11yAllNote)}</p>`);
    else {
      const ruleRows = all.rules.map(r => `<tr><td>${esc(r.helpHu)}<small class="sub">${esc(r.engine === 'HTMLCS' ? 'HTML_CodeSniffer' : 'axe-core')} · ${esc(r.id.replace(/^htmlcs:/, ''))}</small></td><td>${wcagCell(r, esc)}</td><td><span class="chip ${IMPACT_CLS[r.impact] || ''}">${esc(IMPACT_HU[r.impact] || r.impact)}</span></td><td class="num">${r.pages} / ${all.checked}</td><td class="num">${r.elements}</td></tr>`).join('');
      const worst = [...all.pages].filter(p => p.counts).sort((a, b) => ((b.counts.critical || 0) * 3 + (b.counts.serious || 0) * 2 + (b.counts.moderate || 0)) - ((a.counts.critical || 0) * 3 + (a.counts.serious || 0) * 2 + (a.counts.moderate || 0))).slice(0, 10);
      const pageRows = worst.map(p => { let pth = p.url; try { pth = new URL(p.url).pathname; } catch {} return `<tr><td title="${esc(p.url)}">${esc(pth)}</td><td class="num">${p.counts.critical}</td><td class="num">${p.counts.serious}</td><td class="num">${p.counts.moderate}</td><td class="num">${p.counts.minor}</td></tr>`; }).join('');
      const allRows = all.pages.map(p => { let pth = p.url; try { pth = new URL(p.url).pathname; } catch {} return p.error ? `<tr><td>${esc(pth)}</td><td colspan="4" class="hint">${esc(p.error)}</td></tr>` : `<tr><td title="${esc(p.url)}">${esc(pth)}</td><td class="num">${p.counts.critical}</td><td class="num">${p.counts.serious}</td><td class="num">${p.counts.moderate}</td><td class="num">${p.counts.minor}</td></tr>`; }).join('');
      sec('Akadálymentesség: a teljes sitemap', `<p class="hint">${all.checked} oldal ellenőrizve${all.total ? ` a sitemap ${all.total} oldalából${all.truncated ? ' (a beállított felső korlát miatt nem mind)' : ''}` : ''}${all.failed ? `, ${all.failed} oldal nem volt elérhető` : ''}. ${all.pagesWithSevere} oldalon van kritikus vagy súlyos hiba. Az azonos hibák többnyire a sablonból jönnek, ezért egy javítás sok oldalt rendbe tesz. A vizsgálatot a pa11y-ci végzi két motorral: az axe-core súlyosságot is ad, a HTML_CodeSniffer kiegészítő észrevételeket (súlyosság nélkül, ezek nem számítanak bele a súlyos / kritikus oldalak számába).</p>
        <div class="wrapx"><table class="mini"><thead><tr><th>Hiba</th><th>WCAG</th><th>Hatás</th><th>Érintett oldal</th><th>Elem</th></tr></thead><tbody>${ruleRows}</tbody></table></div>
        <p><b>Legtöbb hibát tartalmazó oldalak</b></p><div class="wrapx"><table class="mini"><thead><tr><th>Oldal</th><th>Kritikus</th><th>Súlyos</th><th>Közepes</th><th>Enyhe</th></tr></thead><tbody>${pageRows}</tbody></table></div>
        <details class="expl"><summary>Minden vizsgált oldal (${all.pages.length})</summary><div class="wrapx"><table class="mini"><thead><tr><th>Oldal</th><th>Kritikus</th><th>Súlyos</th><th>Közepes</th><th>Enyhe</th></tr></thead><tbody>${allRows}</tbody></table></div></details>`);
    }
  }

  // aloldalak akadálymentessége (a GEO-bejárás oldalai közül)
  if (R.a11yPages?.length) {
    const rows = R.a11yPages.map(p => { let path = p.url; try { path = new URL(p.url).pathname; } catch {} return p.error ? `<tr><td>${esc(path)}</td><td colspan="4" class="hint">${esc(p.error)}</td></tr>` : `<tr><td title="${esc(p.url)}">${esc(path)}</td><td class="num"><span class="chip ${p.counts.critical ? 'c-bad' : ''}">${p.counts.critical}</span></td><td class="num"><span class="chip ${p.counts.serious ? 'c-bad' : ''}">${p.counts.serious}</span></td><td class="num">${p.counts.moderate}</td><td class="num">${p.counts.minor}</td></tr>`; }).join('');
    sec('Akadálymentesség: aloldalak', `<div class="wrapx"><table class="mini"><thead><tr><th>Oldal</th><th>Kritikus</th><th>Súlyos</th><th>Közepes</th><th>Enyhe</th></tr></thead><tbody>${rows}</tbody></table></div>`);
  }

  const w3 = R.w3c;
  if (w3 && !w3.skipped) {
    if (w3.error) sec('W3C HTML-validálás', `<p class="hint">${esc(w3.error)}</p>`);
    else {
      const rows = w3.pages.map(p => { let path = p.url; try { path = new URL(p.url).pathname; } catch {} const top = p.top.slice(0, 3).map(t => `<li><span class="chip ${t.type === 'error' ? 'c-bad' : 'c-warn'}">${t.type === 'error' ? 'hiba' : 'figyelm.'} ×${t.count}</span> ${esc(t.hint || t.message)}${t.hint ? `<small class="sub">${esc(t.message)}</small>` : ''}</li>`).join(''); return `<tr><td title="${esc(p.url)}">${esc(path === '/' ? 'Főoldal' : path)}</td><td class="num"><span class="chip ${p.errors ? 'c-bad' : 'c-ok'}">${p.errors}</span></td><td class="num"><span class="chip ${p.warnings ? 'c-warn' : 'c-ok'}">${p.warnings}</span></td><td><ul class="faq">${top || '<li class="hint">nincs észrevétel</li>'}</ul></td></tr>`; }).join('');
      sec('W3C HTML-validálás', `<p class="hint">A W3C hivatalos validátorával (Nu Html Checker) ${w3.totals.pages} oldal ellenőrizve: ${w3.totals.errors} hiba, ${w3.totals.warnings} figyelmeztetés. A legtöbb hiba a témából és a pluginokból jön, ezért oldalanként ismétlődik; többségük nem okoz látható problémát. A CSS-validálás nem része az ellenőrzésnek.</p><div class="wrapx"><table class="mini"><thead><tr><th>Oldal</th><th>Hiba</th><th>Figyelm.</th><th>Leggyakoribb észrevételek</th></tr></thead><tbody>${rows}</tbody></table></div>`);
    }
  }

  const l = R.links;
  if (l) {
    if (l.error) sec('Linkek', `<p class="hint">${esc(l.error)}</p>`);
    else {
      const row = (x, kind) => `<tr><td>${esc(x.url)}<small class="sub">oldal: ${esc(x.from || '')}</small></td><td>${kind}</td><td class="num"><span class="chip c-bad">${esc(x.status || x.error || 'hiba')}</span></td></tr>`;
      const rows = [...l.brokenInternal.map(x => row(x, 'belső')), ...l.brokenExternal.map(x => row(x, 'külső'))].join('');
      sec('Linkek ellenőrzése', `<p class="hint">${l.checked} link ellenőrizve (${l.internalTotal} belső, ${l.externalTotal} külső egyedi link a vizsgált oldalakon). ${l.brokenInternal.length + l.brokenExternal.length ? `${l.brokenInternal.length} törött belső, ${l.brokenExternal.length} törött külső.` : 'Nem találtunk törött linket.'}${l.restricted ? ` ${l.restricted} külső oldal tiltja az automatikus lekérést (nem hiba).` : ''}</p>`
        + (rows ? `<div class="wrapx"><table class="mini"><thead><tr><th>Link</th><th>Típus</th><th>Állapot</th></tr></thead><tbody>${rows}</tbody></table></div>` : '')
        + (l.redirectChains.length ? `<p class="hint">Hosszú átirányítási láncok: ${l.redirectChains.slice(0, 5).map(x => esc(x.url) + ' (' + x.hops + ')').join(', ')}</p>` : ''));
    }
  }

  const m = R.mail, de = R.domainExp;
  if (m || de) {
    let body = '';
    if (m && !m.error) {
      const ok = v => `<span class="chip c-ok">${esc(v)}</span>`, bad = v => `<span class="chip c-bad">${esc(v)}</span>`, warn = v => `<span class="chip c-warn">${esc(v)}</span>`;
      body += `<div class="wrapx"><table class="mini"><tbody>
        <tr><td>E-mail fogadás (MX)</td><td>${m.hasMx ? ok(m.mx.map(x => x.exchange).slice(0, 2).join(', ')) : 'nincs MX-rekord (nem fogad e-mailt)'}</td></tr>
        ${m.hasMx ? `<tr><td>SPF</td><td>${m.spf ? (['-all', '~all'].includes(m.spf.policy) ? ok(m.spf.policy) : warn(m.spf.policy || 'szabály nélkül')) : bad('nincs')}</td></tr>
        <tr><td>DMARC</td><td>${m.dmarc ? (m.dmarc.policy === 'none' ? warn('p=none') : ok('p=' + m.dmarc.policy)) : bad('nincs')}</td></tr>
        <tr><td>DKIM</td><td>${m.dkim.length ? ok(m.dkim.join(', ')) : 'a gyakori selectorokkal nem található (nem biztos, hogy hiba)'}</td></tr>` : ''}
      </tbody></table></div>`;
    }
    if (de) body += de.error ? `<p class="hint">Domain-lejárat: ${esc(de.error)}</p>` : `<p>Domain-lejárat: <span class="chip ${de.daysLeft < 30 ? 'c-bad' : de.daysLeft < 90 ? 'c-warn' : 'c-ok'}">${esc(de.expires)} (${de.daysLeft} nap)</span>${de.registrar ? ` <span class="hint">regisztrátor: ${esc(de.registrar)}</span>` : ''}</p>`;
    if (body) sec('E-mail hitelesítés és domain', body);
  }

  const v = R.vulns;
  if (v) {
    if (v.error) sec('Ismert sebezhetőségek', `<p class="hint">${esc(v.error)}</p>`);
    else sec(`Ismert sebezhetőségek (${v.source || 'WPScan'})`, v.items.length
      ? `<div class="wrapx"><table class="mini"><thead><tr><th>Komponens</th><th>Súlyosság</th><th>Sebezhetőség</th><th>Javítva</th></tr></thead><tbody>${v.items.map(x => `<tr><td>${esc(x.name)} ${esc(x.version)}</td><td><span class="chip ${SEV_CLS[x.severity] || ''}">${esc(x.severity)}</span></td><td>${esc(x.title)}${x.cve?.length ? `<small class="sub">${esc(x.cve.join(', '))}</small>` : ''}</td><td>${esc(x.fixedIn || (x.fixedAfter ? '> ' + x.fixedAfter : 'nincs'))}</td></tr>`).join('')}</tbody></table></div>${v.limited ? '<p class="hint">Nem minden komponens lekérdezése sikerült (korlát vagy átmeneti hiba), ezért a lista hiányos lehet.</p>' : ''}<p class="hint">A WordPress-magra az ingyenes adatbázis nem ad megbízható adatot; ott az „elavult verzió” megállapítás az irányadó.</p>`
      : `<p class="hint">A felismert komponensekhez nincs ismert, az adott verziót érintő sebezhetőség.${v.limited ? ' A lekérdezési korlát miatt nem minden komponens lett ellenőrizve.' : ''}</p>`);
  }

  const c = R.crux;
  if (c) {
    if (c.error) sec('Valós látogatói adatok', `<p class="hint">${esc(c.error)}</p>`);
    else {
      const rate = (k, p) => (k === 'lcp' ? (p <= 2500 ? 'c-ok' : p <= 4000 ? 'c-warn' : 'c-bad') : k === 'inp' ? (p <= 200 ? 'c-ok' : p <= 500 ? 'c-warn' : 'c-bad') : k === 'cls' ? (p <= 0.1 ? 'c-ok' : p <= 0.25 ? 'c-warn' : 'c-bad') : (p <= 1800 ? 'c-ok' : p <= 3000 ? 'c-warn' : 'c-bad'));
      const fmt = (k, p) => (k === 'cls' ? String(p).replace('.', ',') : k === 'inp' ? p + ' ms' : (p / 1000).toFixed(1).replace('.', ',') + ' s');
      const rows = ['phone', 'desktop'].map(dev => { const x = c[dev]; if (!x) return ''; if (x.error) return `<tr><td>${dev === 'phone' ? 'mobil' : 'asztali'}</td><td colspan="4" class="hint">${esc(x.error)}</td></tr>`; return `<tr><td>${dev === 'phone' ? 'mobil' : 'asztali'}</td>${['lcp', 'inp', 'cls', 'fcp'].map(k => `<td class="num">${x[k] ? `<span class="chip ${rate(k, x[k].p75)}">${esc(fmt(k, x[k].p75))}</span>` : '–'}</td>`).join('')}</tr>`; }).join('');
      sec('Valós látogatói adatok (Chrome UX Report, 75. percentilis)', `<div class="wrapx"><table class="mini"><thead><tr><th>Eszköz</th><th>LCP</th><th>INP</th><th>CLS</th><th>FCP</th></tr></thead><tbody>${rows}</tbody></table></div><p class="hint">Ezek a Lighthouse laboratóriumi értékeivel szemben valódi látogatók mérései az elmúlt 28 napból. INP: a kattintás utáni reagálás ideje (jó: 200 ms alatt).</p>`);
    }
  }
  return h;
}
