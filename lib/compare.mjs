// Összehasonlítás ugyanazon domain előző felmérésével: mérőszámok változása, új és megoldott hibák
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

// [kulcs, címke, érték-kinyerő, jobb-e a nagyobb (true / false / null: nincs irány)]
export const METRICS = [
  ['geo', 'GEO-pont', R => (R.geo && !R.geo.error ? num(R.geo.score) : null), true],
  ['lhm', 'Lighthouse (főoldal, első profil)', R => (R.lighthouse && !R.lighthouse.error ? num(R.lighthouse.perf) : null), true],
  ['lhd', 'Lighthouse (főoldal, asztali)', R => (R.lighthouseDesktop && !R.lighthouseDesktop.error ? num(R.lighthouseDesktop.perf) : null), true],
  ['crit', 'Kritikus és magas súlyú hibák', R => (R.flags ? (R.flags.critical || 0) + (R.flags.high || 0) : null), false],
  ['outdated', 'Elavult pluginok', R => (Array.isArray(R.plugins) ? R.plugins.filter(p => p.outdated).length : null), false],
  ['hours', 'Rendbetétel becsült óra', R => (R.totals ? num(R.totals.kotelezo) : null), false],
  ['spam', 'Spam-bejegyzések', R => (R.spam ? num(R.spam.confirmed) : null), false],
  ['a11y', 'Akadálymentesség: súlyos hibák', R => (R.a11y && !R.a11y.error ? (R.a11y.counts?.critical || 0) + (R.a11y.counts?.serious || 0) : null), false],
  ['w3c', 'W3C HTML-hibák', R => (R.w3c && !R.w3c.error && !R.w3c.skipped ? num(R.w3c.totals?.errors) : null), false],
  ['broken', 'Törött belső linkek', R => (R.links && !R.links.error ? num(R.links.brokenInternal?.length) : null), false],
];
const TEXT = [
  ['wp', 'WordPress-verzió', R => R.wp?.version || null],
  ['php', 'PHP-verzió', R => R.server?.php?.ver || null],
  ['gdpr', 'GDPR-állapot', R => R.gdprState || null],
  ['status', 'Állapot', R => R.status || null],
];

const findingMap = R => new Map((R.findings || []).filter(f => !f.base && f.sev !== 'info').map(f => [f.id, f]));

export function compareResults(cur, prev, meta = {}) {
  if (!cur || !prev) return null;
  const deltas = [];
  for (const [key, label, get, higherBetter] of METRICS) {
    const a = get(prev), b = get(cur);
    if (a == null || b == null) continue;
    const d = +(b - a).toFixed(2);
    deltas.push({ key, label, prev: a, cur: b, delta: d, better: d === 0 ? null : (higherBetter ? d > 0 : d < 0) });
  }
  for (const [key, label, get] of TEXT) {
    const a = get(prev), b = get(cur);
    if (a == null && b == null) continue;
    if (a !== b) deltas.push({ key, label, prev: a ?? '–', cur: b ?? '–', delta: null, better: null, text: true });
  }
  const pm = findingMap(prev), cm = findingMap(cur);
  const newFindings = [...cm.values()].filter(f => !pm.has(f.id)).map(f => ({ id: f.id, title: f.title, sev: f.sev }));
  const resolvedFindings = [...pm.values()].filter(f => !cm.has(f.id)).map(f => ({ id: f.id, title: f.title, sev: f.sev }));
  const improved = deltas.filter(d => d.better === true).length, worsened = deltas.filter(d => d.better === false).length;
  return {
    prevRunId: meta.runId || null, prevDate: meta.date || null, deltas, newFindings, resolvedFindings, improved, worsened,
    summary: `${resolvedFindings.length} hiba megoldódott, ${newFindings.length} új jelent meg; ${improved} mutató javult, ${worsened} romlott.`,
  };
}

// értesítést érdemlő romlások (ütemezett felmérések riasztásához)
export function alertsFor(cmp, R) {
  const out = [];
  if (!cmp) return out;
  const d = k => cmp.deltas.find(x => x.key === k);
  if (d('geo') && d('geo').delta <= -10) out.push(`A GEO-pont ${-d('geo').delta} ponttal romlott (${d('geo').prev} → ${d('geo').cur}).`);
  if (d('lhm') && d('lhm').delta <= -10) out.push(`A Lighthouse-pontszám ${-d('lhm').delta} ponttal romlott (${d('lhm').prev} → ${d('lhm').cur}).`);
  for (const f of cmp.newFindings.filter(f => ['kritikus', 'magas'].includes(f.sev))) out.push(`Új ${f.sev} súlyú hiba: ${f.title}`);
  const st = d('status'); if (st && ['down', 'error', 'blocked'].includes(R.status)) out.push(`Az oldal állapota megváltozott: ${st.prev} → ${st.cur}.`);
  if (R.cert && R.cert.daysLeft != null && R.cert.daysLeft < 14) out.push(`Az SSL-tanúsítvány ${R.cert.daysLeft} nap múlva lejár.`);
  if (R.flags?.hacked) out.push('Feltörés jelei: reklám- / spam-bejegyzések az oldalon.');
  return out;
}
