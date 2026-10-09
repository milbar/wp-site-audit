// Lighthouse-értékek értelmezése: küszöbök, magyar magyarázatok, táblázatsorok. A felület és a szerveroldali exportok is ezt használják.
// A küszöbök a Google Lighthouse / Core Web Vitals hivatalos tartományai.

export const RATING_HU = { good: 'jó', mid: 'közepes', bad: 'rossz' };
const hu = (n, d = 1) => (n == null ? '–' : String(+(+n).toFixed(d)).replace('.', ','));

// [jó határ, közepes határ, nagyobb-e a rosszabb]
const T = {
  lcp: [2.5, 4, true], fcp: [1.8, 3, true], tbt: [200, 600, true], cls: [0.1, 0.25, true],
  totalKB: [2048, 4096, true], serverMs: [200, 600, true],
};

export function rate(key, v) {
  if (v == null) return null;
  if (['perf', 'a11y', 'bp', 'seo'].includes(key)) return v >= 90 ? 'good' : v >= 50 ? 'mid' : 'bad';
  const t = T[key]; if (!t) return null;
  return v <= t[0] ? 'good' : v <= t[1] ? 'mid' : 'bad';
}

export const COLS = [
  { key: 'perf', label: 'Teljesítmény', fmt: v => hu(v, 0) },
  { key: 'a11y', label: 'Akadály-mentesség', fmt: v => hu(v, 0) },
  { key: 'bp', label: 'Legjobb gyakorlatok', fmt: v => hu(v, 0) },
  { key: 'seo', label: 'SEO', fmt: v => hu(v, 0) },
  { key: 'lcp', label: 'LCP', fmt: v => (v == null ? '–' : hu(v) + ' s') },
  { key: 'tbt', label: 'TBT', fmt: v => (v == null ? '–' : hu(v, 0) + ' ms') },
  { key: 'cls', label: 'CLS', fmt: v => hu(v, 2) },
  { key: 'totalKB', label: 'Méret', fmt: v => (v == null ? '–' : hu(v / 1024) + ' MB') },
];

// Magyarázatok: [név, mit jelent, mi a jó érték]
export const EXPLAIN = [
  ['Teljesítmény (0–100)', 'Összpontszám arról, mennyire gyorsan és gördülékenyen töltődik be az oldal. Mobilon a mérés szándékosan lassú hálózatot és gyengébb telefont feltételez, ezért mobilon mindig alacsonyabb az érték, mint asztali gépen.', '90 fölött jó, 50–89 közepes, 50 alatt rossz'],
  ['Akadálymentesség (0–100)', 'Mennyire használható az oldal látássérült, billentyűzettel vagy képernyőolvasóval böngésző látogatónak (kontraszt, képek alt szövege, űrlapcímkék).', '90 fölött jó'],
  ['Legjobb gyakorlatok (0–100)', 'Biztonsági és technikai alapok: HTTPS, elavult megoldások, a böngésző konzolban megjelenő hibák.', '90 fölött jó'],
  ['SEO (0–100)', 'A Lighthouse alap keresőoptimalizálási ellenőrzése: title, meta description, indexelhetőség, mobilbarát megjelenés. Nem helyettesíti a teljes SEO-vizsgálatot.', '90 fölött jó'],
  ['LCP – legnagyobb tartalmi elem', 'Mennyi idő után jelenik meg a fő kép vagy szövegblokk. Ezt érzékeli a látogató „betöltésként”. Lassú tárhely, nagy képek és blokkoló szkriptek rontják.', '2,5 s alatt jó, 4 s fölött rossz'],
  ['TBT – blokkolási idő', 'Mennyi ideig „fagy” le az oldal betöltés közben, mert túl sok vagy nehéz JavaScriptet kell futtatnia (pluginok, követőkódok, oldalépítők). Ilyenkor a kattintás nem reagál.', '200 ms alatt jó, 600 ms fölött rossz'],
  ['CLS – elmozdulás', 'Mennyire ugrálnak az elemek betöltés közben (például egy késve betöltődő kép lelöki a szöveget). Zavaró, és véletlen rákattintásokat okoz.', '0,1 alatt jó, 0,25 fölött rossz'],
  ['Méret', 'Az oldal teljes letöltött adatmennyisége. Mobilnetről a nagy oldal lassú és drága a látogatónak; jellemzően a tömörítetlen képek miatt nagy.', '2 MB alatt jó, 4 MB fölött rossz'],
];

export const LEGEND = 'Színek (a Google Lighthouse küszöbei alapján): zöld = jó, sárga = közepes, piros = rossz. A mérés futásonként ±5–10 pontot szórhat, ezért a trendet és a nagy eltéréseket érdemes nézni, nem az egyes pontokat.';

const pathOf = u => { try { const x = new URL(u); return x.pathname + (x.search || ''); } catch { return u; } };

// Minden Lighthouse-mérés sora: főoldal + aloldalak, profilonként
export function lhRows(R) {
  const rows = [];
  const homeUrl = R.reach?.finalUrl || '';
  if (R.lighthouse) rows.push({ page: 'Főoldal', url: homeUrl, home: true, device: R.lighthouse.device || 'mobile', x: R.lighthouse });
  if (R.lighthouseDesktop) rows.push({ page: 'Főoldal', url: homeUrl, home: true, device: 'desktop', x: R.lighthouseDesktop });
  for (const p of R.lighthousePages || []) for (const dev of ['mobile', 'desktop']) if (p[dev]) rows.push({ page: pathOf(p.url), url: p.url, home: false, device: dev, x: p[dev] });
  return rows;
}
export const deviceHu = d => (d === 'desktop' ? 'asztali' : 'mobil');

// Rövid, érthető értékelés egy mérésről
export function verdict(row) {
  const x = row.x; if (!x || x.error) return '';
  const where = `${row.page === 'Főoldal' ? 'A főoldal' : 'A(z) ' + row.page + ' oldal'} ${deviceHu(row.device)} nézetben`;
  const lvl = x.perf == null ? '' : x.perf >= 90 ? 'gyors' : x.perf >= 50 ? 'közepesen gyors, fejleszthető' : 'lassú';
  const bad = [];
  if (rate('lcp', x.lcp) === 'bad') bad.push(`a fő tartalom csak ${hu(x.lcp)} s után jelenik meg`);
  else if (rate('lcp', x.lcp) === 'mid') bad.push(`a fő tartalom ${hu(x.lcp)} s alatt jelenik meg (a cél 2,5 s alatt van)`);
  if (rate('tbt', x.tbt) === 'bad') bad.push(`betöltés közben ${hu(x.tbt, 0)} ms-ig nem reagál (túl sok JavaScript)`);
  if (rate('cls', x.cls) === 'bad') bad.push('az elemek láthatóan ugrálnak betöltés közben');
  if (rate('totalKB', x.totalKB) === 'bad') bad.push(`az oldal ${hu(x.totalKB / 1024)} MB, ami nehéz`);
  if (rate('serverMs', x.serverMs) === 'bad') bad.push(`a szerver lassan válaszol (${hu(x.serverMs, 0)} ms)`);
  let s = `${where} ${lvl} (${hu(x.perf, 0)}/100).`;
  if (bad.length) s += ' ' + bad[0].charAt(0).toUpperCase() + bad[0].slice(1) + (bad.length > 1 ? '; ' + bad.slice(1).join('; ') : '') + '.';
  const o = (x.opportunities || [])[0];
  if (o && x.perf < 90) s += ` Legtöbbet ez segítene: ${o.title.charAt(0).toLowerCase() + o.title.slice(1)} (kb. ${hu(o.savingsMs / 1000)} s nyereség).`;
  const weak = [['a11y', 'akadálymentesség'], ['bp', 'technikai alapok'], ['seo', 'alap SEO']].filter(([k]) => rate(k, x[k]) === 'bad').map(([, n]) => n);
  if (weak.length) s += ` Gyenge terület még: ${weak.join(', ')}.`;
  return s;
}

// A táblázat egy sorának cellái: [{text, rating}] (a felület és az exportok formázzák)
export function cells(row) {
  const x = row.x;
  if (x.error) return null;
  return COLS.map(c => ({ key: c.key, text: c.fmt(x[c.key]), rating: rate(c.key, x[c.key]) }));
}
