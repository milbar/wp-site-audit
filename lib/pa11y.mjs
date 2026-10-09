// Akadálymentesség a teljes sitemapre a pa11y-ci-vel (WCAG 2.1 AA, két motorral: axe-core és HTML_CodeSniffer).
// A pa11y-ci a saját Chrome-ját indítja; ezt a gépen lévő Chrome-ra irányítjuk, szerver módban a szűrő-proxyn át (SSRF-védelem).
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { startGuardProxy } from './guard-proxy.mjs';
import { CHALLENGE_RE } from './challenge.mjs';
import { summarizeA11y, WCAG_HU } from './a11y.mjs';

const require = createRequire(import.meta.url);

// axe-szabály → WCAG-címkék (a pa11y axe-eredménye nem tartalmazza a címkéket)
let axeTags = null;
function tagsOfAxeRule(id) {
  if (!axeTags) { axeTags = new Map(); try { for (const r of require('axe-core').getRules()) axeTags.set(r.ruleId, r.tags || []); } catch {} }
  return axeTags.get(id) || [];
}

// HTML_CodeSniffer: a kód a kritériumot és a technikát tartalmazza, pl. WCAG2AA.Principle1.Guideline1_4.1_4_3.G18.Fail
const HTMLCS_HU = {
  G18: ['Elégtelen színkontraszt', 'A szöveg és a háttér kontrasztja legalább 4,5:1 legyen (nagy szövegnél 3:1).'],
  G145: ['Elégtelen színkontraszt (nagy szöveg)', 'A nagy szöveg kontrasztja legalább 3:1 legyen.'],
  'H91.A.NoContent': ['Link vagy elem szöveges név nélkül', 'Adj a linknek látható szöveget vagy aria-label attribútumot.'],
  'H91.A.EmptyNoId': ['Link vagy elem név nélkül', 'Adj a linknek látható szöveget vagy aria-label attribútumot.'],
  H37: ['Kép alt szöveg nélkül', 'Adj a képnek alt attribútumot (díszképnél üreset).'],
  H30: ['Kép-link szöveges név nélkül', 'A képet tartalmazó linknek legyen alt szövege vagy aria-label attribútuma.'],
  F77: ['Ismétlődő azonosító (id)', 'Egy oldalon minden id legyen egyedi.'],
  H32: ['Az űrlapnak nincs elküldő gombja', 'Adj az űrlapnak submit gombot.'],
  H44: ['Űrlapmező címke nélkül', 'Kösd a mezőt <label>-hez, vagy adj aria-label attribútumot.'],
  H25: ['Az oldalnak nincs címe', 'Adj az oldalnak egyedi <title>-t.'],
  H57: ['Hiányzik az oldal nyelve', 'A html elemen legyen lang attribútum.'],
  H42: ['Címsornak kinéző elem nem valódi címsor', 'Valódi h1–h6 elemet használj címsorhoz.'],
  H48: ['Lista nem valódi listaelemekkel', 'Használj ul / ol / li elemeket.'],
  F68: ['Űrlapmező címkéje nincs hozzákötve', 'Kösd a címkét a mezőhöz (for / id).'],
};
const htmlcsKey = code => { const m = /^WCAG2(A{1,3})\.Principle\d\.Guideline\d_\d\.(\d)_(\d)_(\d{1,2})\.(.+)$/.exec(String(code)); return m ? { level: m[1], crit: `${m[2]}.${m[3]}.${m[4]}`, tech: m[5].replace(/\.(Fail|Pass)$/, '') } : null; };

// a pa11y-ci eredménye egy oldalra → az akadálymentességi mérés közös szerkezete (counts, violations)
export function normalizePage(url, issues) {
  const errorOnly = issues.length > 0 && !issues[0].runner && issues[0].message;
  if (errorOnly && issues.every(i => !i.runner)) return { url, error: String(issues[0].message).split('\n')[0].slice(0, 160) };
  const groups = new Map();
  for (const i of issues) {
    let key, v;
    if (i.runner === 'axe') {
      key = 'axe:' + i.code;
      v = groups.get(key) || { id: i.code, engine: 'axe', impact: i.runnerExtras?.impact || 'moderate', help: i.runnerExtras?.help || i.message, helpUrl: i.runnerExtras?.helpUrl, tags: tagsOfAxeRule(i.code), count: 0, samples: [] };
    } else if (i.runner === 'htmlcs') {
      const h = htmlcsKey(i.code); if (!h) continue;
      key = `htmlcs:${h.crit}:${h.tech}`;
      // a HTML_CodeSniffer nem ad súlyosságot: kiegészítő észrevételként „közepes”, hogy ne torzítsa a súlyos / kritikus számokat
      v = groups.get(key) || { id: `htmlcs:${h.crit}:${h.tech}`, engine: 'HTMLCS', impact: 'moderate', help: String(i.message).split('. ')[0].slice(0, 160), tags: [h.level === 'AAA' ? 'wcag2aaa' : h.level === 'AA' ? 'wcag2aa' : 'wcag2a', `wcag${h.crit.replace(/\./g, '')}`], count: 0, samples: [], _tech: h.tech, _crit: h.crit };
    } else continue;
    v.count++; if (v.samples.length < 3 && i.selector) v.samples.push(String(i.selector).slice(0, 120));
    groups.set(key, v);
  }
  const page = summarizeA11y([...groups.values()].map(({ _tech, _crit, ...rest }) => rest));
  // magyar nevek a HTML_CodeSniffer-észrevételekhez
  for (const v of page.violations) {
    if (v.engine !== 'HTMLCS') continue;
    const [, crit, tech] = v.id.split(':'); const hu = HTMLCS_HU[tech];
    v.helpHu = hu ? hu[0] : `${WCAG_HU[crit] || 'WCAG ' + crit}: ${v.help}`; v.fixHu = hu ? hu[1] : '';
  }
  return { url, ...page };
}

// egy kör: a pa11y-ci futtatása a megadott oldalakon
async function scanOnce(urls, { chromePath, guarded, concurrency, timeout }) {
  const pa11yCi = require('pa11y-ci');
  const proxy = guarded ? await startGuardProxy() : null;
  const args = ['--disable-gpu', ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...(proxy ? [`--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>'] : []), ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(/\s+/).filter(Boolean) : [])];
  const titles = (globalThis.__pa11yTitles ||= new Map());
  const norm = u => { try { return new URL(u).href; } catch { return u; } };
  for (const u of urls) titles.delete(u);
  try {
    // A pa11y-ci a Chrome indítási hibáját kezeletlen kivételként dobja (ez a teljes folyamatot leállíthatná), ezért a vizsgálat idejére elkapjuk,
    // és időkorlátot is kap: egy elakadt böngésző nem tarthat fogva egy felmérést.
    let onRej, timer;
    const trap = new Promise((_, rej) => { onRej = e => rej(e instanceof Error ? e : new Error(String(e))); process.on('unhandledRejection', onRej); });
    const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('Az akadálymentességi vizsgálat időtúllépés miatt megszakadt')), Math.ceil(urls.length / Math.max(1, concurrency)) * (timeout + 5000) + 60000); });
    const run = pa11yCi(urls, {
      concurrency, reporters: [require.resolve('./pa11y-reporter.cjs')], log: { error() {}, info() {}, log() {} }, useIncognitoBrowserContext: false,
      chromeLaunchConfig: { executablePath: chromePath, headless: true, args },
      standard: 'WCAG2AA', runners: ['axe', 'htmlcs'], timeout, wait: 1000, includeNotices: false, includeWarnings: false,
    });
    run.catch(() => {});
    let report;
    try { report = await Promise.race([run, trap, limit]); } finally { process.off('unhandledRejection', onRej); clearTimeout(timer); }
    const byUrl = new Map(Object.entries(report.results).map(([k, v]) => [norm(k), v]));
    const byTitle = new Map([...titles.entries()].map(([k, v]) => [norm(k), v]));
    return urls.map(u => {
      const title = byTitle.get(norm(u)) || '';
      if (CHALLENGE_RE.test(title)) return { url: u, challenge: true, error: `bot-védelmi oldal („${title.slice(0, 40)}”), nem mérhető` };
      return normalizePage(u, byUrl.get(norm(u)) || []);
    });
  } finally { if (proxy) await proxy.close().catch(() => {}); }
}

export async function pa11yScan(urls, { chromePath, guarded = false, concurrency = 3, timeout = 45000, retryWaitMs = 15000 } = {}) {
  if (!chromePath || !fs.existsSync(chromePath)) throw new Error('Nem található Chrome vagy Edge az akadálymentességi vizsgálathoz.');
  const opts = { chromePath, guarded, concurrency, timeout };
  let pages = await scanOnce(urls, opts);
  // a bot-védelmi köztes oldalakat egyszer újrapróbáljuk (a szigorítás gyakran csak rövid ideig tart)
  const blocked = pages.filter(p => p.challenge).map(p => p.url);
  if (blocked.length) {
    await new Promise(r => setTimeout(r, retryWaitMs));
    const again = new Map((await scanOnce(blocked, opts)).map(p => [p.url, p]));
    pages = pages.map(p => (p.challenge ? again.get(p.url) || p : p));
  }
  return pages.map(({ challenge, ...p }) => p);
}
