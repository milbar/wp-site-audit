// Akadálymentességi ellenőrzés az axe-core szabályrendszerével (WCAG 2.0/2.1 A és AA), a főoldalon, a Chrome-ban
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { UA } from './http.mjs';

const require = createRequire(import.meta.url);
let axeSource = null;
const loadAxe = () => (axeSource ||= fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8'));

// A leggyakoribb szabályok magyarul: [név, mit kell tenni]
export const RULES_HU = {
  'color-contrast': ['Elégtelen színkontraszt a szöveg és a háttér között', 'A szöveg és a háttér kontrasztja legalább 4,5:1 legyen (nagy szövegnél 3:1); a színeket ennek megfelelően kell módosítani.'],
  'image-alt': ['Képek alternatív szöveg nélkül', 'Minden tartalmi képhez alt szöveg kell; a díszképeknél üres alt="" legyen.'],
  'link-name': ['Linkek érthető név nélkül', 'A linknek legyen látható vagy aria-label szövege (pl. az ikonlinkeknél).'],
  'button-name': ['Gombok név nélkül', 'A gombnak legyen szöveges neve vagy aria-label attribútuma.'],
  'label': ['Űrlapmezők címke nélkül', 'Minden beviteli mezőhöz tartozzon látható <label> vagy aria-label.'],
  'html-has-lang': ['Hiányzik az oldal nyelve', 'A html elemen legyen lang attribútum (pl. lang="hu").'],
  'document-title': ['Az oldalnak nincs címe', 'Adj az oldalnak egyedi <title>-t.'],
  'heading-order': ['Kihagyott címsor-szint', 'A címsorok sorban kövessék egymást (H1, H2, H3), szint kihagyása nélkül.'],
  'empty-heading': ['Üres címsor', 'Távolítsd el az üres címsort, vagy írj bele szöveget.'],
  'page-has-heading-one': ['Nincs H1 az oldalon', 'Az oldalon legyen egy H1 főcím.'],
  'landmark-one-main': ['Nincs fő tartalmi terület (main)', 'A fő tartalmat tedd <main> elembe.'],
  'region': ['A tartalom nincs tájékozódási területekben', 'A tartalmat tedd header / nav / main / footer elemekbe.'],
  'meta-viewport': ['A nagyítás le van tiltva', 'A viewport metában ne legyen user-scalable=no vagy maximum-scale=1.'],
  'duplicate-id': ['Ismétlődő azonosítók', 'Egy oldalon minden id legyen egyedi.'],
  'aria-allowed-attr': ['Helytelen ARIA attribútum', 'Az ARIA attribútumot csak megfelelő szerepű elemen használd.'],
  'aria-required-attr': ['Hiányzó kötelező ARIA attribútum', 'Add meg az adott ARIA szerephez kötelező attribútumokat.'],
  'aria-valid-attr-value': ['Érvénytelen ARIA érték', 'Javítsd az ARIA attribútum értékét.'],
  'aria-hidden-focus': ['Rejtett elem fókuszálható', 'Az aria-hidden elemen belüli linkek és gombok ne legyenek billentyűzettel elérhetők.'],
  'tabindex': ['Pozitív tabindex', 'Ne használj 0-nál nagyobb tabindex értéket.'],
  'frame-title': ['Beágyazott keret cím nélkül', 'Az iframe-nek legyen title attribútuma.'],
  'select-name': ['Legördülő lista címke nélkül', 'Adj a listának címkét.'],
  'list': ['Hibás listaszerkezet', 'A ul/ol elemek közvetlen gyermeke csak li lehet.'],
  'listitem': ['Lista elem listán kívül', 'A li elem ul vagy ol belsejében legyen.'],
  'target-size': ['Túl kicsi kattintási felület', 'A kattintható elemek legyenek legalább 24×24 képpont méretűek.'],
  'skip-link': ['A „Ugrás a tartalomra” link nem működik', 'A skip-link célja létezzen az oldalon.'],
  'bypass': ['Nincs mód a menü átugrására', 'Adj „Ugrás a tartalomra” linket vagy tájékozódási területeket.'],
  'link-in-text-block': ['A link csak színnel különül el a szövegtől', 'A linket aláhúzással vagy más, nem csak színalapú jellel is meg kell különböztetni.'],
  'nested-interactive': ['Egymásba ágyazott interaktív elemek', 'Gombon vagy linken belül ne legyen másik gomb vagy link.'],
  'scrollable-region-focusable': ['Görgethető terület billentyűzettel nem érhető el', 'A görgethető területnek legyen fókuszálható eleme (tabindex="0").'],
};

// A leggyakoribb WCAG-kritériumok magyar neve (szám → név)
export const WCAG_HU = {
  '1.1.1': 'Nem szöveges tartalom', '1.2.1': 'Csak hang / csak videó', '1.3.1': 'Információ és kapcsolatok', '1.3.2': 'Értelmes sorrend', '1.3.5': 'A beviteli cél azonosítása',
  '1.4.1': 'Színhasználat', '1.4.2': 'Hangvezérlés', '1.4.3': 'Kontraszt (minimum)', '1.4.4': 'Szöveg átméretezése', '1.4.5': 'Szöveg képként', '1.4.10': 'Tördelés (reflow)',
  '1.4.11': 'Nem szöveges kontraszt', '1.4.12': 'Szövegközök', '2.1.1': 'Billentyűzettel használható', '2.1.2': 'Nincs billentyűzet-csapda', '2.2.1': 'Időkorlát beállítható',
  '2.2.2': 'Megállítás, szüneteltetés, elrejtés', '2.4.1': 'Blokkok megkerülése', '2.4.2': 'Az oldal címe', '2.4.3': 'Fókuszsorrend', '2.4.4': 'A link célja (környezetben)',
  '2.4.6': 'Címsorok és címkék', '2.4.7': 'Látható fókusz', '2.5.3': 'Név a címkében', '2.5.8': 'Célméret (minimum)', '3.1.1': 'Az oldal nyelve', '3.1.2': 'A részek nyelve',
  '3.2.2': 'Beviteli mező hatása', '3.3.1': 'Hiba azonosítása', '3.3.2': 'Címkék vagy útmutatás', '4.1.1': 'Értelmezhetőség', '4.1.2': 'Név, szerep, érték',
};
const wcagOf = tags => [...new Set((tags || []).map(t => { const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(t); return m ? `${m[1]}.${m[2]}.${m[3]}` : null; }).filter(Boolean))];
const levelOf = tags => ((tags || []).some(t => /^wcag(2|21|22)aa$/.test(t)) ? 'AA' : (tags || []).some(t => /^wcag(2|21|22)a$/.test(t)) ? 'A' : null);

export async function a11yCheck(browser, url, { timeout = 35000, waitMs = 3000 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1366, height: 860 });
    await page.setBypassCSP(true); // az axe szkript beillesztését az oldal CSP-je ne akadályozza
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout }); } catch (e) { return { error: 'Az oldal nem töltődött be: ' + e.message.split('\n')[0] }; }
    await new Promise(r => setTimeout(r, waitMs));
    await page.evaluate(loadAxe());
    const res = await page.evaluate(async () => {
      const r = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }, resultTypes: ['violations'] });
      return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, helpUrl: v.helpUrl, tags: v.tags, count: v.nodes.length, samples: v.nodes.slice(0, 3).map(n => String(n.target?.[0] || '').slice(0, 120)) }));
    });
    return summarizeA11y(res);
  } catch (e) { return { error: e.message.split('\n')[0] }; }
  finally { await ctx.close().catch(() => {}); }
}

export function summarizeA11y(violations) {
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const list = (violations || []).map(({ tags, ...v }) => ({ ...v, wcag: wcagOf(tags), level: levelOf(tags), helpHu: RULES_HU[v.id]?.[0] || v.help, fixHu: RULES_HU[v.id]?.[1] || '' }))
    .sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || b.count - a.count);
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const v of list) counts[v.impact] = (counts[v.impact] || 0) + 1;
  return { counts, total: list.length, nodes: list.reduce((a, v) => a + v.count, 0), violations: list.slice(0, 25) };
}

// A „teljes sitemap” mód összesítése: szabályonként hány oldalt és elemet érint, oldalankénti számok, a legrosszabb oldalak
export function aggregateA11y(pages, { total = null, truncated = false } = {}) {
  const ok = (pages || []).filter(p => !p.error && p.counts);
  const rules = new Map();
  const counts = { critical: 0, serious: 0, moderate: 0, minor: 0 };
  for (const p of ok) {
    for (const k of Object.keys(counts)) counts[k] += p.counts[k] || 0;
    for (const v of p.violations || []) {
      const r = rules.get(v.id) || { id: v.id, engine: v.engine || 'axe', helpHu: v.helpHu, fixHu: v.fixHu, impact: v.impact, wcag: v.wcag || [], level: v.level || null, pages: 0, elements: 0, examples: [] };
      r.pages++; r.elements += v.count || 0; if (r.examples.length < 3) r.examples.push(p.url);
      rules.set(v.id, r);
    }
  }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  return {
    checked: ok.length, failed: (pages || []).length - ok.length, total, truncated, counts,
    pagesWithSevere: ok.filter(p => (p.counts.critical || 0) + (p.counts.serious || 0) > 0).length,
    rules: [...rules.values()].sort((a, b) => (order[a.impact] ?? 9) - (order[b.impact] ?? 9) || b.pages - a.pages).slice(0, 40),
    // oldalanként csak a számok és a szabály-azonosítók maradnak (kis méret)
    pages: (pages || []).map(p => (p.error ? { url: p.url, error: p.error } : { url: p.url, counts: p.counts, rules: (p.violations || []).slice(0, 12).map(v => v.id) })),
    engines: ['axe-core', 'HTML_CodeSniffer'], runner: 'pa11y-ci',
  };
}
