// SEO / GEO oldalankénti értékelés: küszöbök és magyar magyarázatok (felület és exportok közösen használják)
export const RATING_HU = { good: 'jó', mid: 'közepes', bad: 'rossz' };

export function rateTitle(len, dup) {
  if (!len) return 'bad';
  let r = len >= 30 && len <= 60 ? 'good' : (len >= 15 && len < 30) || (len > 60 && len <= 75) ? 'mid' : 'bad';
  if (dup && r === 'good') r = 'mid';
  return r;
}
export function rateDesc(len, dup, sameAsTitle) {
  if (!len) return 'bad';
  if (sameAsTitle) return 'bad';
  let r = len >= 70 && len <= 160 ? 'good' : (len >= 40 && len < 70) || (len > 160 && len <= 200) ? 'mid' : 'bad';
  if (dup && r === 'good') r = 'mid';
  return r;
}
export const rateH1 = n => (n === 1 ? 'good' : n > 1 ? 'mid' : 'bad');
export const rateWords = w => (w >= 300 ? 'good' : w >= 150 ? 'mid' : 'bad');

export function noteTitle(len, dup) {
  if (!len) return 'hiányzik';
  const base = len < 15 ? `túl rövid (${len} kar.)` : len < 30 ? `rövid (${len} kar.)` : len <= 60 ? `jó hossz (${len} kar.)` : len <= 75 ? `kicsit hosszú (${len} kar.), levágódhat` : `túl hosszú (${len} kar.), a Google levágja`;
  return base + (dup ? ', több oldalon azonos' : '');
}
export function noteDesc(len, dup, sameAsTitle) {
  if (!len) return 'hiányzik';
  if (sameAsTitle) return 'megegyezik a címmel';
  const base = len < 40 ? `túl rövid (${len} kar.)` : len < 70 ? `rövid (${len} kar.)` : len <= 160 ? `jó hossz (${len} kar.)` : len <= 200 ? `kicsit hosszú (${len} kar.)` : `túl hosszú (${len} kar.), levágódik`;
  return base + (dup ? ', több oldalon azonos' : '');
}

export const SEO_EXPLAIN = [
  ['Title (oldalcím)', 'Ez látszik a keresőtalálat címeként és a böngészőfülön; a legerősebb on-page jel. Legyen oldalanként egyedi, a lényeges kulcsszóval az elején.', 'Jó: 30–60 karakter. 60 fölött a Google levágja, 15 alatt keveset mond.'],
  ['Meta description (leírás)', 'A találat alatti kétsoros leírás. Közvetlenül nem rangsorol, de a kattintási arányt javítja, és az AI-rendszerek is innen tájékozódnak az oldalról. Legyen egyedi, és ne a cím ismétlése.', 'Jó: 70–160 karakter.'],
  ['H1 (főcím)', 'Az oldal látható főcíme: egyértelműen megnevezi a témát. A keresők és az AI-rendszerek ebből értik meg az oldal fő mondanivalóját.', 'Jó: oldalanként pontosan egy.'],
  ['Canonical', 'Megmondja a keresőnek, melyik az oldal „hivatalos” címe; megelőzi, hogy ugyanaz a tartalom több címen versengjen.', 'Jó: minden indexelhető oldalon be van állítva.'],
  ['Szavak (HTML-ben)', 'A nyers HTML-ben található szöveg mennyisége. Az AI-crawlerek többsége nem futtat JavaScriptet, ezért ami csak JS-sel jelenik meg, azt nem látják.', 'Jó: 300 szó fölött; 150 alatt vékony tartalom.'],
  ['GEO-pont (oldal)', 'Az oldal 0–100 pontszáma az AI-keresők számára való érthetőségről: tartalom, strukturált adat, nyelv, bejárhatóság, AI-jelek.', 'Erős: 80 fölött; gyenge: 50 alatt.'],
];

// Oldalanként a táblázat sora: a felület és az exportok is ezt használják
export function seoRow(p) {
  if (p.failed) return { url: p.url, failed: true, note: `nem letölthető (${p.failed})` };
  const sameAsTitle = !!p.desc && !!p.title && p.desc.trim() === p.title.trim();
  return {
    url: p.url, score: p.score, level: p.level,
    title: { len: p.titleLen || 0, rating: rateTitle(p.titleLen, p.dupTitle), note: noteTitle(p.titleLen, p.dupTitle), text: p.title || '' },
    desc: { len: p.descLen || 0, rating: rateDesc(p.descLen, p.dupDesc, sameAsTitle), note: noteDesc(p.descLen, p.dupDesc, sameAsTitle), text: p.desc || '' },
    h1: { n: p.h1 ?? 0, rating: rateH1(p.h1 ?? 0) },
    canonical: { ok: !!p.canonical, rating: p.canonical ? 'good' : 'mid' },
    words: { n: p.words || 0, rating: rateWords(p.words || 0) },
    noindex: !!p.noindex,
  };
}

// Rövid szöveges értékelés a teljes oldalmintáról
export function seoVerdict(pages) {
  const rows = (pages || []).filter(p => !p.failed).map(seoRow);
  if (!rows.length) return '';
  const n = rows.length, c = f => rows.filter(f).length;
  const parts = [];
  const tBad = c(r => r.title.rating === 'bad'), tMid = c(r => r.title.rating === 'mid');
  const dBad = c(r => r.desc.rating === 'bad'), dMiss = c(r => !r.desc.len);
  parts.push(tBad || tMid ? `A ${n} vizsgált oldal közül ${c(r => r.title.rating === 'good')}-nak jó a címe (title), ${tMid} közepes, ${tBad} rossz vagy hiányzik.` : `Mind a ${n} vizsgált oldal címe (title) jó hosszúságú.`);
  parts.push(dMiss ? `${dMiss} oldalról hiányzik a meta description, összesen ${dBad} oldalon rossz.` : dBad ? `${dBad} oldalon rossz a meta description (túl rövid/hosszú vagy a címmel azonos).` : 'A meta description mindenhol jelen van és jó hosszúságú.');
  const h1Bad = c(r => r.h1.rating !== 'good');
  if (h1Bad) parts.push(`${h1Bad} oldalon nem pontosan egy H1 van.`);
  const noCan = c(r => !r.canonical.ok); if (noCan) parts.push(`${noCan} oldalon hiányzik a canonical.`);
  const noidx = c(r => r.noindex); if (noidx) parts.push(`${noidx} oldal noindex jelölésű, pedig a sitemapben szerepel.`);
  return parts.join(' ');
}
