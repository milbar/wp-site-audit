// További mérések a docx-javaslatokban (a docx-segédfüggvényeket az export-docx.mjs adja át)
const IMPACT_HU = { critical: 'kritikus', serious: 'súlyos', moderate: 'közepes', minor: 'enyhe' };

export function checksDocx(R, H) {
  const { p, bullet, table, cell, Paragraph, TextRun, AlignmentType, FONT, brand, W } = H;
  const out = [];
  const head = t => out.push(new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: t, font: FONT, size: 20, bold: true, color: brand })] }));
  const note = t => out.push(p(t, { run: { size: 17, color: '404040' } }));
  const short = (t, n) => (String(t).length > n ? String(t).slice(0, n - 1) + '…' : String(t));

  const a = R.a11y;
  if (a && !a.error) {
    head('Akadálymentesség: WCAG 2.2 AA (automatikus ellenőrzés, axe-core)');
    note(a.total ? `${a.total} szabálysértés (${a.counts.critical} kritikus, ${a.counts.serious} súlyos, ${a.counts.moderate} közepes, ${a.counts.minor} enyhe), ${a.nodes} érintett elem a főoldalon.` : 'Az automatikus ellenőrzés nem talált szabálysértést; ez kézi ellenőrzést nem helyettesít.');
    if (a.violations.length) {
      const cols = [2700, 1000, 1000, 700, 4238];
      out.push(table(cols, ['Hiba', 'WCAG', 'Hatás', 'Elem', 'Javítás'], a.violations.slice(0, 12).map(v => [cell(v.helpHu, cols[0], { size: 15 }), cell(v.wcag?.length ? `${v.wcag.join(', ')} (${v.level || ''})` : 'ajánlott gyakorlat', cols[1], { size: 15 }), cell(IMPACT_HU[v.impact] || v.impact, cols[1], { size: 15, fill: ['critical', 'serious'].includes(v.impact) ? 'F8CBAD' : v.impact === 'moderate' ? 'FFF2CC' : undefined }), cell(String(v.count), cols[3], { size: 15, align: AlignmentType.CENTER }), cell(v.fixHu || '', cols[4], { size: 15 })])));
    }
  }
  if (R.a11yPages?.length) {
    head('Akadálymentesség: aloldalak');
    R.a11yPages.forEach(pg => { let pth = pg.url; try { pth = new URL(pg.url).pathname; } catch {} note(pg.error ? `${pth}: ${pg.error}` : `${pth}: ${pg.counts.critical} kritikus, ${pg.counts.serious} súlyos, ${pg.counts.moderate} közepes, ${pg.counts.minor} enyhe`); });
  }
  const w3 = R.w3c;
  if (w3 && !w3.error && !w3.skipped) {
    head('W3C HTML-validálás (Nu Html Checker)');
    note(`${w3.totals.pages} oldal: ${w3.totals.errors} hiba, ${w3.totals.warnings} figyelmeztetés. A legtöbb hiba a témából és a pluginokból jön; többségük nem okoz látható problémát.`);
    const cols = [2400, 800, 900, 5538];
    out.push(table(cols, ['Oldal', 'Hiba', 'Figyelm.', 'Leggyakoribb észrevételek'], w3.pages.map(pg => { let pth = pg.url; try { pth = new URL(pg.url).pathname; } catch {} return [cell(short(pth === '/' ? 'Főoldal' : pth, 30), cols[0], { size: 15 }), cell(String(pg.errors), cols[1], { size: 15, align: AlignmentType.CENTER, fill: pg.errors ? 'F8CBAD' : 'E2EFDA' }), cell(String(pg.warnings), cols[2], { size: 15, align: AlignmentType.CENTER }), cell(pg.top.slice(0, 3).map(t => `${t.type === 'error' ? 'hiba' : 'figyelm.'} ×${t.count}: ${t.hint || t.message}`).join(' | ') || 'nincs észrevétel', cols[3], { size: 15 })]; })));
  }
  const l = R.links;
  if (l && !l.error) {
    head('Linkek ellenőrzése');
    note(`${l.checked} link ellenőrizve. ${l.brokenInternal.length + l.brokenExternal.length ? `${l.brokenInternal.length} törött belső, ${l.brokenExternal.length} törött külső link.` : 'Nem találtunk törött linket.'}`);
    [...l.brokenInternal.slice(0, 8).map(x => ['belső', x]), ...l.brokenExternal.slice(0, 5).map(x => ['külső', x])].forEach(([k, x]) => out.push(bullet(`${k}: ${short(x.url, 90)} (${x.status || x.error}); oldal: ${short(x.from || '', 60)}`)));
  }
  const m = R.mail, de = R.domainExp;
  if ((m && !m.error) || (de && !de.error)) {
    head('E-mail hitelesítés és domain');
    if (m && !m.error) note(m.hasMx ? `MX: ${m.mx.map(x => x.exchange).slice(0, 2).join(', ')} · SPF: ${m.spf ? (m.spf.policy || 'szabály nélkül') : 'nincs'} · DMARC: ${m.dmarc ? 'p=' + m.dmarc.policy : 'nincs'} · DKIM: ${m.dkim.length ? m.dkim.join(', ') : 'a gyakori selectorokkal nem található'}` : 'A domain nem fogad e-mailt (nincs MX-rekord).');
    if (de && !de.error) note(`Domain-lejárat: ${de.expires} (${de.daysLeft} nap)${de.registrar ? ', regisztrátor: ' + de.registrar : ''}.`);
  }
  const v = R.vulns;
  if (v && !v.error && v.items.length) {
    head(`Ismert sebezhetőségek (${v.source || 'WPScan'})`);
    const cols = [2500, 1200, 4338, 1600];
    out.push(table(cols, ['Komponens', 'Súlyosság', 'Sebezhetőség', 'Javítva'], v.items.slice(0, 15).map(x => [cell(`${x.name} ${x.version}`, cols[0], { size: 15 }), cell(x.severity, cols[1], { size: 15, fill: ['kritikus', 'magas'].includes(x.severity) ? 'F8CBAD' : x.severity === 'közepes' ? 'FFF2CC' : undefined }), cell(`${x.title}${x.cve?.length ? ' (' + x.cve.join(', ') + ')' : ''}`, cols[2], { size: 15 }), cell(x.fixedIn || (x.fixedAfter ? '> ' + x.fixedAfter : 'nincs'), cols[3], { size: 15 })])));
  }
  const c = R.crux;
  if (c && !c.error) {
    head('Valós látogatói adatok (Chrome UX Report, 75. percentilis)');
    for (const dev of ['phone', 'desktop']) { const x = c[dev]; if (x && !x.error) note(`${dev === 'phone' ? 'Mobil' : 'Asztali'}: ` + ['lcp', 'inp', 'cls', 'fcp'].filter(k => x[k]).map(k => `${k.toUpperCase()} ${k === 'cls' ? String(x[k].p75).replace('.', ',') : k === 'inp' ? x[k].p75 + ' ms' : (x[k].p75 / 1000).toFixed(1).replace('.', ',') + ' s'}`).join(' · ')); }
  }
  return out;
}
