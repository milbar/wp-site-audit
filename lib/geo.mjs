// GEO (Generative Engine Optimization) ellenőrzés: statikus HTTP-vizsgálat a főoldalon és a sitemapből választott oldalakon.
// Hat terület, összesen 100 pont: bejárhatóság 20, nyelv 10, megbízhatóság 15, tartalmi érthetőség 20, strukturált adat 25, AI-készültség 10.
// Nem mér tényleges AI-idézettséget (ahhoz külső szolgáltatások kellenének).
import { pickSitemapUrls } from './sitemap.mjs';
import { pool } from './http.mjs';
import { collectLinks } from './links.mjs';
import { rateTitle, rateDesc } from '../public/seo-explain.mjs';

export const AI_BOTS = [
  ['GPTBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.1; +https://openai.com/gptbot)'],
  ['ClaudeBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
  ['PerplexityBot', 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)'],
  ['Google-Extended', null], ['CCBot', null], ['Applebot-Extended', null], ['OAI-SearchBot', null], ['ChatGPT-User', null],
];
import { CHALLENGE_RE } from './challenge.mjs';
const CONTACT_RE = /kapcsolat|contact|elerhetoseg|elérhetőség|kontakt/i, ABOUT_RE = /rolunk|rólunk|bemutatkoz|about|tortenet|történet|csapat|team|ueber-uns|über-uns/i, PRIVACY_RE = /adatvedelm|adatvédelm|adatkezel|privacy|datenschutz/i;
const SOCIAL_RE = /(facebook|instagram|linkedin|youtube|twitter|x)\.com\//i;
const PAGE_TYPES = /^(Article|BlogPosting|NewsArticle|Product|Service|FAQPage|Event|WebPage|AboutPage|ContactPage|CollectionPage|LocalBusiness|Organization|Course|Recipe|JobPosting|MedicalWebPage|HowTo)$/;
const ORG_TYPES = /^(Organization|LocalBusiness|Corporation|NGO|Store|Restaurant|Hotel|LodgingBusiness|MedicalBusiness|NursingHome|HealthAndBeautyBusiness|ProfessionalService|Person)$|Business$/;

const pct = (n, d) => (d ? n / d : 0);
const round1 = x => Math.round(x * 10) / 10;
export const pageLevel = s => (s >= 80 ? 'strong' : s >= 65 ? 'solid' : s >= 50 ? 'needs' : 'weak');
const areaLevel = (s, m) => (s / m >= 0.9 ? 'Erős' : s / m >= 0.65 ? 'Jó' : 'Gyenge');

// robots.txt: melyik AI-botot tiltja ki teljesen
export function blockedBots(robotsTxt) {
  const groups = []; let cur = null, lastWasUA = false;
  for (const raw of (robotsTxt || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim(); const m = line.match(/^([a-z-]+)\s*:\s*(.*)$/i); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') { if (!cur || !lastWasUA) { cur = { uas: [], rules: [] }; groups.push(cur); } cur.uas.push(v.toLowerCase()); lastWasUA = true; }
    else if (cur && (k === 'allow' || k === 'disallow')) { cur.rules.push([k, v]); lastWasUA = false; }
  }
  const blocked = (g) => !!g && g.rules.some(([k, v]) => k === 'disallow' && v === '/') && !g.rules.some(([k, v]) => k === 'allow' && v === '/');
  const star = groups.find(g => g.uas.includes('*'));
  return AI_BOTS.map(([n]) => n).filter(n => {
    const g = groups.find(x => x.uas.includes(n.toLowerCase()));
    return g ? blocked(g) : false; // csak a kifejezetten megnevezett tiltás számít; a „*” tiltás a keresőket is érinti, azt a SEO-rész jelzi
  }).concat(star && blocked(star) ? ['* (minden bot)'] : []);
}

const attr = (tag, name) => (tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i')) || [])[2] ?? (tag.match(new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i')) || [])[1];
const decode = s => s.replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

function jsonLdTypes(html) {
  const types = new Set(); let blocks = 0, invalid = 0, sameAs = false, org = false, dated = false;
  const walk = n => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) return n.forEach(walk);
    for (const t of [].concat(n['@type'] || [])) { types.add(String(t)); if (ORG_TYPES.test(String(t))) { org = true; } }
    if (n.sameAs && (Array.isArray(n.sameAs) ? n.sameAs.length : true)) sameAs = true;
    if (n.dateModified || n.datePublished) dated = true;
    Object.values(n).forEach(walk);
  };
  for (const m of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    blocks++;
    try { walk(JSON.parse(m[1].trim().replace(/^<!--|-->$/g, ''))); } catch { invalid++; }
  }
  return { types: [...types], blocks, invalid, sameAs, org, dated };
}

export function analyzePage(html, url) {
  const head = html.slice(0, 200_000);
  const title = decode(((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim());
  const metaTags = [...head.matchAll(/<meta\b[^>]*>/gi)].map(m => m[0]);
  const meta = (k, v) => { const t = metaTags.find(t => new RegExp(`\\b${k}\\s*=\\s*["']${v}["']`, 'i').test(t)); return t ? attr(t, 'content') || '' : null; };
  const desc = meta('name', 'description') || '';
  const robots = meta('name', 'robots') || '';
  const lang = (html.match(/<html[^>]*\blang\s*=\s*["']([^"']+)/i) || [])[1] || '';
  const hreflang = (head.match(/<link[^>]+hreflang=/gi) || []).length;
  const canonical = /<link[^>]+rel=["']canonical["']/i.test(head);
  const og = !!meta('property', 'og:title') && !!meta('property', 'og:description');
  const heads = [...html.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => [+m[1], decode(m[2].replace(/<[^>]+>/g, '').trim())]);
  const h1 = heads.filter(h => h[0] === 1).length, h2 = heads.filter(h => h[0] === 2).length;
  let skip = false; for (let i = 1; i < heads.length; i++) if (heads[i][0] - heads[i - 1][0] > 1) skip = true;
  const questions = heads.filter(h => /\?\s*$/.test(h[1])).length + (html.match(/<details\b/gi) || []).length;
  const main = (html.match(/<main\b[\s\S]*?<\/main>/i) || [html])[0];
  const text = decode(main.replace(/<(script|style|noscript|svg|nav|footer|header|form)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const words = text ? text.split(' ').length : 0;
  const structure = (main.match(/<(ul|ol|table|dl)\b/gi) || []).length + questions;
  const ld = jsonLdTypes(html);
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const imgAlt = imgs.filter(t => /\balt\s*=\s*["'][^"']+["']/i.test(t)).length;
  const dated = ld.dated || !!meta('property', 'article:modified_time') || !!meta('property', 'article:published_time') || /<time\b[^>]*datetime=/i.test(html);
  const links = [...html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)].map(m => [m[1], m[2].replace(/<[^>]+>/g, '')]);
  const noindex = /noindex/i.test(robots);

  // oldalpontszám (0–100): tartalom 40, strukturált adat 30, nyelv 10, bejárhatóság 10, AI-jelek 10
  const content20 = (h1 === 1 ? 4 : h1 > 1 ? 2 : 0) + (title.length >= 15 && title.length <= 70 ? 3 : title ? 1 : 0) + (desc.length >= 50 ? 3 : desc ? 1 : 0) + (h2 > 0 && !skip ? 3 : h2 > 0 ? 1.5 : 0) + (words >= 150 ? 4 : words >= 60 ? 2 : 0) + (structure > 0 ? 3 : 0);
  const ld14 = (ld.blocks && !ld.invalid ? 6 : ld.blocks ? 2 : 0) + (ld.types.some(t => PAGE_TYPES.test(t)) ? 5 : 0) + (ld.types.includes('BreadcrumbList') ? 3 : 0);
  const score = Math.round(content20 / 20 * 40 + ld14 / 14 * 30 + (lang ? 10 : 0) + (noindex ? 0 : 10) + ((og ? 5 : 0) + (canonical ? 5 : 0)));
  const issues = [];
  if (h1 !== 1) issues.push(h1 ? `${h1} db H1` : 'nincs H1');
  if (!desc) issues.push('nincs meta description');
  if (words < 150) issues.push(`kevés szöveg a HTML-ben (${words} szó)`);
  if (skip) issues.push('kihagyott címsor-szint');
  if (!ld.blocks) issues.push('nincs strukturált adat'); else if (ld.invalid) issues.push('hibás JSON-LD');
  if (!lang) issues.push('nincs lang attribútum');
  if (noindex) issues.push('noindex');
  if (!canonical) issues.push('nincs canonical');
  const attrAll = (re, group = 1) => [...html.matchAll(re)].map(m => decode(m[group] || '').trim()).filter(Boolean);
  const facts = {
    siteName: meta('property', 'og:site_name') || '', description: desc || meta('property', 'og:description') || '', logo: meta('property', 'og:image') || '',
    tel: attrAll(/href\s*=\s*["']tel:([^"']+)["']/gi)[0] || '', email: attrAll(/href\s*=\s*["']mailto:([^"'?]+)/gi)[0] || '',
    sameAs: [...new Set(attrAll(/href\s*=\s*["'](https?:\/\/(?:www\.)?(?:facebook|instagram|linkedin|youtube|twitter|x)\.com\/[^"'#?\s]+)/gi))].slice(0, 8),
  };
  return { url, title, desc, lang, hreflang, h1Text: (heads.find(h => h[0] === 1) || [])[1] || '', h2s: heads.filter(h => h[0] === 2).map(h => h[1]).filter(Boolean).slice(0, 6), excerpt: text.slice(0, 700), facts, canonical, og, h1, h2, skip, questions, words, structure, ld, imgs: imgs.length, imgAlt, dated, links, noindex, content20, ld14, score, level: pageLevel(score), issues };
}

export async function geoScan(client, host, { homeUrl, homeHtml, sitemapUrl, maxPages = 30, log = () => {} } = {}) {
  const origin = new URL(homeUrl).origin;
  if (!homeHtml) { const r = await client.tryGet(homeUrl, { maxBytes: 1_500_000, timeout: 15000, maxRedirects: 5, headers: { accept: 'text/html' } }); if (r.status !== 200) return { error: `A főoldal nem tölthető le (HTTP ${r.status || r.error || 'hiba'})` }; homeHtml = r.body; }
  if (CHALLENGE_RE.test((homeHtml || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')) return { error: 'A webhely bot-védelme blokkolja a lekérést, a GEO-vizsgálat nem végezhető el.' };
  const hrefHost = u => { try { return new URL(u, homeUrl); } catch { return null; } };

  // 1) robots.txt, llms.txt, AI-botok elérése
  log('GEO: robots.txt, llms.txt');
  const [robots, llms] = await Promise.all([
    client.tryGet(`${origin}/robots.txt`, { maxBytes: 200_000, timeout: 8000, maxRedirects: 2 }),
    client.tryGet(`${origin}/llms.txt`, { maxBytes: 200_000, timeout: 8000, maxRedirects: 2 }),
  ]);
  const bots = robots.status === 200 ? blockedBots(robots.body) : [];
  const hasLlms = llms.status === 200 && !/<html|<!doctype/i.test((llms.body || '').slice(0, 300)) && (llms.body || '').trim().length > 20;
  log('GEO: AI-botok elérése');
  const aiRes = [];
  for (const [name, ua] of AI_BOTS.filter(b => b[1])) {
    const r = await client.tryGet(homeUrl, { maxBytes: 300_000, timeout: 10000, maxRedirects: 3, headers: { 'user-agent': ua } });
    const challenged = CHALLENGE_RE.test((r.body || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
    aiRes.push({ name, status: r.status, blocked: [401, 403, 429, 503].includes(r.status) || challenged });
  }
  const aiBlockedBy = aiRes.filter(x => x.blocked).map(x => `${x.name} (${x.status || 'hiba'})`);

  // 2) oldalak kiválasztása: főoldal + sitemap (tartalék: a főoldal belső linkjei)
  const home = analyzePage(homeHtml || '', homeUrl);
  let urls = [];
  try { urls = await pickSitemapUrls(client, host, { sitemapUrl, homeUrl, limit: Math.max(0, maxPages - 1) }); } catch {}
  let fromSitemap = urls.length > 0;
  if (!urls.length) {
    const seen = new Set();
    for (const [href] of home.links) {
      const u = hrefHost(href); if (!u || !/^https?:$/.test(u.protocol) || u.hostname.replace(/^www\./, '') !== host.replace(/^www\./, '')) continue;
      u.hash = ''; const s = u.href; if (/\.(jpe?g|png|gif|webp|svg|pdf|zip|css|js)(\?|$)|\/(wp-admin|wp-json|feed|cart|kosar|checkout)(\/|$)/i.test(s) || u.pathname === '/' || seen.has(s)) continue;
      seen.add(s); urls.push(s); if (urls.length >= maxPages - 1) break;
    }
  }

  // 3) oldalak letöltése és elemzése
  log(`GEO: ${urls.length + 1} oldal elemzése`);
  const pages = [home];
  await pool(urls, 2, async (u, i) => {
    const r = await client.tryGet(u, { maxBytes: 1_500_000, timeout: 12000, maxRedirects: 4, headers: { accept: 'text/html' } });
    if (r.status === 200 && !/html/i.test(r.headers?.['content-type'] || 'html')) return; // nem HTML (kml, xml, kép stb.): nem oldal, kihagyjuk
    if (r.status !== 200 || CHALLENGE_RE.test((r.body || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '')) { pages.push({ url: u, failed: r.status || r.error || 'hiba', score: 0, level: 'weak', issues: [`nem letölthető (${r.status || 'hiba'})`], links: [], ld: { types: [], blocks: 0, invalid: 0 }, words: 0 }); return; }
    pages.push(analyzePage(r.body, u));
  });
  const ok = pages.filter(p => !p.failed);
  const dupOf = (key) => { const m = new Map(); ok.forEach(p => { const v = (p[key] || '').trim().toLowerCase(); if (v) m.set(v, (m.get(v) || 0) + 1); }); ok.forEach(p => { p[key === 'title' ? 'dupTitle' : 'dupDesc'] = !!(p[key] || '').trim() && m.get((p[key] || '').trim().toLowerCase()) > 1; }); };
  dupOf('title'); dupOf('desc');
  const n = ok.length || 1;
  const cnt = f => ok.filter(f).length;

  // 4) területi pontszámok
  const allLinks = ok.flatMap(p => p.links);
  const allHtmlHints = ok.some(p => p.links.some(([h]) => /^(tel|mailto):/i.test(h)));
  const hasLink = re => allLinks.some(([h, t]) => re.test(h) || re.test(t));
  const org = ok.some(p => p.ld.org), orgHome = home.ld.org || home.ld.types.some(t => /^WebSite$/.test(t));
  const sameAs = ok.some(p => p.ld.sameAs) || allLinks.some(([h]) => SOCIAL_RE.test(h));
  const langs = new Set(ok.map(p => (p.lang || '').toLowerCase().split('-')[0]).filter(Boolean));
  const dated = cnt(p => p.dated);
  const A = {};
  A.crawl = round1((1 - bots.filter(b => !b.startsWith('*')).length / AI_BOTS.length) * 8 + (aiBlockedBy.length ? (1 - aiBlockedBy.length / aiRes.length) * 6 : 6) + (sitemapUrl || fromSitemap ? 3 : 0) + pct(cnt(p => !p.noindex), n) * 3);
  A.lang = round1(pct(cnt(p => p.lang), n) * 6 + (langs.size <= 1 || cnt(p => p.hreflang) ? 4 : 0));
  A.trust = round1((hasLink(CONTACT_RE) ? 3 : 0) + (hasLink(ABOUT_RE) ? 3 : 0) + (hasLink(PRIVACY_RE) ? 2 : 0) + (allHtmlHints || ok.some(p => /PostalAddress|telephone/.test(JSON.stringify(p.ld.types))) ? 3 : 0) + (sameAs ? 2 : 0) + (org ? 2 : 0));
  A.content = round1(ok.reduce((a, p) => a + p.content20, 0) / n);
  A.schema = round1(pct(cnt(p => p.ld.blocks && !p.ld.invalid), n) * 6 + (orgHome || org ? 6 : 0) + pct(cnt(p => p.ld.types.some(t => PAGE_TYPES.test(t))), n) * 5 + pct(cnt(p => p.ld.types.includes('BreadcrumbList')), n) * 3 + (ok.some(p => p.ld.sameAs) ? 3 : 0) + (cnt(p => p.ld.invalid) === 0 ? 2 : 0));
  A.ai = round1((hasLlms ? 3 : 0) + pct(cnt(p => p.og), n) * 2 + pct(cnt(p => p.canonical), n) * 2 + (dated ? 2 : 0) + pct(ok.reduce((a, p) => a + p.imgAlt, 0), ok.reduce((a, p) => a + p.imgs, 0) || 1) * 1);
  const defs = [['crawl', 'Bejárhatóság', 20], ['lang', 'Nyelv', 10], ['trust', 'Megbízhatósági jelek', 15], ['content', 'Tartalmi érthetőség', 20], ['schema', 'Strukturált adat', 25], ['ai', 'AI-készültség', 10]];
  const areas = defs.map(([key, label, max]) => ({ key, label, max, score: Math.min(max, A[key]), level: areaLevel(A[key], max) }));
  const score = Math.round(areas.reduce((a, x) => a + x.score, 0));
  const label = score >= 85 ? 'Erős' : score >= 60 ? 'Fejlesztendő' : 'Gyenge';

  // 5) megállapítások (a rules.mjs óraszámot és besorolást ad hozzá)
  const F = [];
  const f = (id, sev, area, title, detail, fix, hoursKey) => F.push({ id, sev, area, title, detail, fix, hoursKey });
  if (bots.length) f('geo-bots', 'közepes', 'crawl', `A robots.txt kitiltja az AI-botokat: ${bots.join(', ')}`, 'Ha ez nem szándékos, az AI-keresők nem használhatják a tartalmat.', 'robots.txt felülvizsgálata: az AI-keresők (pl. OAI-SearchBot, PerplexityBot) engedélyezése, ha az ügyfél láthatóságot szeretne.', 'geoRobots');
  if (aiBlockedBy.length) f('geo-waf', 'magas', 'crawl', `Az AI-botok nem érik el az oldalt (${aiBlockedBy.join(', ')})`, 'A védelem (WAF, bot-védelem) az AI-bot User-Agentet blokkolja, miközben a böngésző kiszolgálást kap.', 'A tűzfal / bot-védelem szabályainak módosítása, hogy a megbízható AI-crawlerek hozzáférjenek.', 'geoWaf');
  if (!hasLlms) f('geo-llms', 'alacsony', 'ai', 'Nincs llms.txt', 'Az llms.txt egy új, még nem általános ajánlás: rövid, gépi összefoglaló az oldalról.', 'llms.txt létrehozása a fő szolgáltatásokkal és oldalakkal.', 'geoLlms');
  if (!(orgHome || org)) f('geo-org', 'közepes', 'schema', 'Nincs Organization / LocalBusiness strukturált adat', 'Az AI-rendszerek nem tudják egyértelműen azonosítani a céget (név, cím, elérhetőség).', 'Organization vagy LocalBusiness JSON-LD a főoldalon (név, logó, cím, telefon, sameAs).', 'geoSchema');
  const noLd = cnt(p => !p.ld.blocks);
  if (noLd / n >= 0.5) f('geo-schema-pages', 'közepes', 'schema', `Az oldalak ${Math.round(noLd / n * 100)}%-án nincs strukturált adat`, `${noLd} / ${n} vizsgált oldal`, 'Oldaltípusonkénti JSON-LD (Article, Service, Product, FAQPage, BreadcrumbList), lehetőleg SEO-bővítménnyel.', 'geoSchemaPages');
  const badLd = cnt(p => p.ld.invalid);
  if (badLd) f('geo-schema-invalid', 'közepes', 'schema', `Hibás JSON-LD ${badLd} oldalon`, 'A hibás JSON-t a keresők és az AI-rendszerek figyelmen kívül hagyják.', 'JSON-LD javítása (Rich Results Test, Schema Markup Validator).', 'geoSchemaFix');
  const noBc = cnt(p => !p.ld.types.includes('BreadcrumbList') && p !== home);
  if (ok.length > 3 && noBc / (n - 1 || 1) >= 0.7) f('geo-breadcrumb', 'alacsony', 'schema', 'Nincs BreadcrumbList az aloldalakon', '', 'Morzsamenü strukturált adattal.', 'geoBreadcrumb');
  if (!sameAs) f('geo-sameas', 'alacsony', 'trust', 'Nincsenek közösségi / külső profil-hivatkozások (sameAs)', '', 'Facebook, LinkedIn, Google Cégprofil stb. hivatkozása a sameAs mezőben és az oldalon.', 'geoEntity');
  const thin = cnt(p => p.words < 150);
  if (thin / n >= 0.3) f('geo-ssr', 'magas', 'content', `Sok oldalon alig van szöveg a HTML-ben (${thin} / ${n})`, 'A legtöbb AI-crawler nem futtat JavaScriptet: ami csak JS-sel jelenik meg, azt nem látják.', 'A fő tartalom szerveroldali megjelenítése, vagy valódi szöveges tartalom pótlása az oldalakon.', 'geoContent');
  const badH = cnt(p => p.h1 !== 1 || p.skip);
  if (badH / n >= 0.3) f('geo-headings', 'alacsony', 'content', `Hibás címsor-szerkezet ${badH} oldalon`, 'H1 hiányzik / több van, vagy kimaradt szint.', 'Egy H1, logikus H2–H3 hierarchia.', 'geoHeadings');
  const flat = cnt(p => !p.structure);
  if (flat / n >= 0.6) f('geo-structure', 'alacsony', 'content', `Kevés a válasz-orientált szerkezet (lista, táblázat, kérdés-válasz): ${flat} / ${n} oldal`, '', 'GYIK-blokkok, felsorolások, összefoglaló bekezdések az oldal elején.', 'geoFaq');
  // SEO: title / description minőség (az ismétlődés az egész mintán belül számít)
  const sOk = ok.map(p => ({ p, t: rateTitle((p.title || '').length, p.dupTitle), d: rateDesc((p.desc || '').length, p.dupDesc, !!p.desc && p.desc.trim() === (p.title || '').trim()) }));
  const noTitle = sOk.filter(x => !(x.p.title || '').length).length, titleBad = sOk.filter(x => x.t === 'bad').length, titleMid = sOk.filter(x => x.t === 'mid').length;
  const noDesc = sOk.filter(x => !(x.p.desc || '').length).length, descBad = sOk.filter(x => x.d === 'bad').length, descMid = sOk.filter(x => x.d === 'mid').length;
  const dupT = ok.filter(p => p.dupTitle).length, dupD = ok.filter(p => p.dupDesc).length;
  if (titleBad + titleMid > 0 && (titleBad + titleMid) / n >= 0.2) f('seo-title', titleBad ? 'közepes' : 'alacsony', 'content', `Nem megfelelő az oldalcím (title) ${titleBad + titleMid} oldalon (${titleBad} rossz, ${titleMid} közepes${noTitle ? ', ' + noTitle + ' hiányzik' : ''})`, 'Az ideális hossz 30–60 karakter; a hosszabb címet a Google levágja, a rövid keveset mond a találatban.', 'Oldalankénti egyedi, 30–60 karakteres title, a kulcsszóval az elején (SEO-plugin sablonjával).', 'seoTitles');
  if (noDesc || (descBad + descMid) / n >= 0.2) f('seo-desc', noDesc / n >= 0.3 ? 'közepes' : 'alacsony', 'content', `Hiányzó vagy gyenge meta description ${descBad + descMid} oldalon (${noDesc} hiányzik, ${descBad - noDesc} rossz hosszúságú vagy ismétlődő, ${descMid} közepes)`, 'A description nem rangsorol közvetlenül, de a kattintást és az AI-rendszerek tájékozódását segíti. Jó hossz: 70–160 karakter.', 'Oldalankénti, egyedi, 70–160 karakteres leírás (a címet ne ismételje).', 'geoMeta');
  if (dupT || dupD) f('seo-dup', 'alacsony', 'content', `Ismétlődő meta adatok: ${dupT} oldalon azonos title, ${dupD} oldalon azonos description`, 'Az azonos cím vagy leírás nehezíti, hogy a keresők megkülönböztessék az oldalakat.', 'Egyedi title és description minden oldalra.', 'seoTitles');
  const noCanon = cnt(p => !p.canonical);
  if (noCanon / n >= 0.3) f('seo-canonical', 'alacsony', 'content', `Hiányzó canonical ${noCanon} oldalon`, '', 'Canonical beállítása (SEO-plugin).', 'seoCanonical');
  const noidx = cnt(p => p.noindex && p !== home);
  if (noidx) f('seo-noindex', 'magas', 'crawl', `${noidx} sitemapben szereplő oldal noindex jelölésű`, 'A sitemap és a noindex ellentmond egymásnak.', 'A noindex eltávolítása, vagy az oldal kivétele a sitemapből.', 'seoIndexFix');
  const noLang = cnt(p => !p.lang);
  if (noLang) f('geo-lang', 'alacsony', 'lang', `Hiányzó lang attribútum ${noLang} oldalon`, '', 'A html elem lang attribútumának beállítása (pl. hu-HU).', 'geoLang');
  if (langs.size > 1 && !cnt(p => p.hreflang)) f('geo-hreflang', 'alacsony', 'lang', `Többnyelvű tartalom hreflang nélkül (${[...langs].join(', ')})`, '', 'hreflang hivatkozások beállítása.', 'geoLang');
  const missing = [!hasLink(CONTACT_RE) && 'kapcsolat', !hasLink(ABOUT_RE) && 'rólunk / bemutatkozás', !hasLink(PRIVACY_RE) && 'adatvédelem', !allHtmlHints && 'telefon / e-mail hivatkozás'].filter(Boolean);
  if (missing.length) f('geo-trust', 'közepes', 'trust', `Hiányzó megbízhatósági jelek: ${missing.join(', ')}`, 'Az AI-rendszerek ezekből ítélik meg a cég hitelességét.', 'Kapcsolat, Rólunk és Adatvédelem oldalak elérhetővé tétele, látható elérhetőségi adatok.', 'geoTrust');
  if (!dated) f('geo-fresh', 'alacsony', 'ai', 'Sehol nincs látható / gépi dátum (datePublished, dateModified)', 'A frissesség jelzése segíti az AI-rendszereket.', 'Közzétételi és módosítási dátum a tartalmakon és a strukturált adatban.', 'geoFresh');

  const good = [];
  if (A.crawl >= 18) good.push('Az oldal és a sitemap jól bejárható, az AI-botok kiszolgálást kapnak.');
  if (A.lang >= 9) good.push('A nyelvi jelek rendben vannak.');
  if (A.schema >= 20) good.push('A strukturált adat több oldalon jelen van.');
  if (A.content >= 17) good.push('A tartalom jól tagolt és szöveges.');
  if (A.trust >= 12) good.push('A cég- és elérhetőségi jelek egyértelműek.');
  const attention = areas.filter(a => a.level === 'Gyenge').map(a => `${a.label}: ${a.score}/${a.max}`);
  const health = { strong: 0, solid: 0, needs: 0, weak: 0 }; pages.forEach(p => { health[p.level]++; });

  return {
    score, label, areas, health, pagesChecked: pages.length, pagesRequested: maxPages, fromSitemap,
    botsBlocked: bots, facts: home.facts, linkSet: collectLinks(ok, homeUrl), aiBots: aiRes, llms: hasLlms, good, attention, findings: F,
    pages: pages.map(p => ({ url: p.url, score: p.score, level: p.level, words: p.words, types: p.ld?.types || [], issues: p.issues, failed: p.failed, title: (p.title || '').slice(0, 200), titleLen: (p.title || '').length, desc: (p.desc || '').slice(0, 320), descLen: (p.desc || '').length, h1: p.h1, h2: p.h2, canonical: p.canonical, og: p.og, lang: p.lang, noindex: p.noindex, hasLd: !!p.ld?.blocks, dupTitle: p.dupTitle, dupDesc: p.dupDesc, h1Text: p.h1Text, h2s: p.h2s, excerpt: p.excerpt })),
  };
}
