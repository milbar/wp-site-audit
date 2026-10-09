// Egy domain bejelentkezés nélküli felmérése (HTTP-szint, böngésző nélkül)
import { pool, sleep } from './http.mjs';
import { isChallenge, titleOf } from './challenge.mjs';
import { phpStatus, gap, cmpVer } from './wporg.mjs';
import * as S from './signatures.mjs';

export function normalizeDomain(s) {
  s = String(s || '').trim();
  if (!s || s.startsWith('#')) return null;
  try { const u = new URL(/^https?:\/\//i.test(s) ? s : 'https://' + s); return u.hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
}
export function parseDomains(text) {
  const out = [];
  for (const part of String(text || '').split(/[\s,;]+/)) { const d = normalizeDomain(part); if (d && /\./.test(d) && !out.includes(d)) out.push(d); }
  return out;
}
const bare = h => h.replace(/^www\./, '');
// a hibás %-kódolású hivatkozás (pl. „/akcio-100%”) nem szakíthatja meg a domain felmérését
export const safeDecode = s => { try { return decodeURIComponent(s); } catch { return String(s); } };
const mode = arr => { const c = {}; arr.forEach(x => { c[x] = (c[x] || 0) + 1; }); return Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0] || null; };
const decodeEntities = s => decodeOnce(decodeOnce(s)); // a WP.org API néha kétszer kódolt („&amp;#8211;”)
const decodeOnce = s => String(s || '').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ');
const strip = s => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8211;|&ndash;/g, '–').replace(/&#0?39;|&#8217;/g, "'").replace(/\s+/g, ' ').trim();
const meta = (html, attr, name) => { const rx = new RegExp(`<meta[^>]+${attr}=["']${name}["'][^>]*>`, 'i'); const m = html.match(rx); if (!m) return null; const c = m[0].match(/content=["']([^"']*)["']/i); return c ? c[1] : ''; };
const isVer = v => /^\d+(\.\d+){0,3}([.-][a-z0-9]+)?$/i.test(v || '');

export async function probeSite(domain, { client, wporg, log = () => {}, spamScan = true, challengeWaits = [15000, 45000] } = {}) {
  const R = { domain, checkedAt: new Date().toISOString(), status: 'ok', notes: [] };
  const base = `https://${domain}`;

  // ---- elérhetőség
  log('elérhetőség');
  let home = await client.tryGet(base + '/', { maxBytes: 4_000_000 });
  if (home.error) {
    const alt = await client.tryGet(`http://${domain}/`, { maxBytes: 4_000_000 });
    if (!alt.error) { home = alt; R.notes.push('HTTPS nem érhető el, csak HTTP'); }
  }
  // bot-védelmi köztes oldal: várunk és újrapróbáljuk (a szigorítás gyakran csak percekig tart)
  for (const wait of challengeWaits) {
    if (!isChallenge(home)) break;
    log(`bot-védelem, újrapróbálás ${Math.round(wait / 1000)} mp múlva`);
    await sleep(wait + Math.random() * 3000);
    home = await client.tryGet(base + '/', { maxBytes: 4_000_000 });
  }
  const blocked = isChallenge(home);
  R.reach = { status: home.status, error: home.error || null, finalUrl: home.finalUrl || null, chain: home.chain || [], ttfb: home.ttfb ?? null, htmlKB: home.bytes ? Math.round(home.bytes / 1024) : 0 };
  if (blocked) { R.status = 'blocked'; R.reach.blockedBy = titleOf(home.body).slice(0, 60) || ('HTTP ' + home.status); R.cert = await client.cert(domain); return R; }
  if (home.error || !home.status) { R.status = 'down'; R.reach.error = home.error || 'nincs válasz'; R.cert = await client.cert(domain); return R; }

  const finalHost = new URL(home.finalUrl).hostname;
  R.reach.finalHost = finalHost;
  if (bare(finalHost) !== bare(domain)) { R.status = 'redirect'; R.reach.redirectTo = home.finalUrl; }
  const H = home.headers || {};
  const html = home.body || '';

  // ---- TLS, HTTP→HTTPS
  R.cert = await client.cert(domain);
  const httpR = await client.tryRaw(`http://${domain}/`, { method: 'GET', maxBytes: 2000, timeout: 8000 });
  R.reach.httpToHttps = httpR.status >= 300 && httpR.status < 400 && /^https:/i.test(httpR.headers?.location || '');

  // ---- átirányító domain: él-e WP a redirect mögött? (a céloldalt nem mérjük újra)
  if (R.status === 'redirect') {
    const wl = await client.tryRaw(`https://${domain}/wp-login.php`, { maxBytes: 3000, timeout: 8000 });
    const wj = await client.tryRaw(`https://${domain}/wp-json/`, { maxBytes: 3000, timeout: 8000 });
    R.reach.wpBehindRedirect = wl.status === 200 || wj.status === 200 || wj.status === 500;
    return R;
  }

  // ---- szerver
  const powered = H['x-powered-by'] || '';
  const phpVer = (powered.match(/PHP\/([\d.]+)/i) || [])[1] || null;
  R.server = { server: H.server || '', poweredBy: powered, php: phpStatus(phpVer), cdn: H['cf-ray'] ? 'Cloudflare' : H['x-sucuri-id'] ? 'Sucuri' : H['x-cdn'] || null, litespeed: !!H['x-litespeed-cache'] || /litespeed/i.test(H.server || '') };

  // ---- karbantartás mód / coming soon
  const title = strip((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
  if (home.status === 503 || /elementor-maintenance-mode|maintenance-mode|coming-soon-page|seedprod|cmp-coming-soon/i.test(html) || /^(coming soon|hamarosan|karbantart|under construction|maintenance)/i.test(title)) {
    if (R.status === 'ok') R.status = 'maintenance';
  }
  if (home.status >= 500 && R.status === 'ok') R.status = 'error';
  if (home.status === 404 && R.status === 'ok') R.status = 'error';

  // ---- WordPress felismerés
  const nsRes = await client.tryGet(`https://${finalHost}/wp-json/`, { maxBytes: 2_500_000, timeout: 15000 });
  let ns = [];
  let restJson = null;
  if (nsRes.status === 200) { try { restJson = JSON.parse(nsRes.body); ns = restJson.namespaces || []; } catch {} }
  const isWp = /\/wp-content\/|\/wp-includes\//i.test(html) || ns.includes('wp/v2') || /api\.w\.org/.test(H.link || '');
  const gen = meta(html, 'name', 'generator') || '';
  const gens = [...html.matchAll(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']+)["']/gi)].map(m => m[1]);
  let wpVer = (gens.join(' ').match(/WordPress ([\d.]+)/) || [])[1] || null, wpVerSrc = wpVer ? 'generator' : null;
  if (!wpVer) {
    const vers = [...html.matchAll(/\/wp-includes\/[^"'\s]+\?ver=(\d+\.\d+(?:\.\d+)?)/g)].map(m => m[1]);
    const v = mode(vers); if (v) { wpVer = v; wpVerSrc = 'wp-includes asset (becsült)'; }
  }
  if (!wpVer && isWp) {
    const feed = await client.tryGet(`https://${finalHost}/feed/`, { maxBytes: 200_000, timeout: 10000 });
    const m = (feed.body || '').match(/<generator>https?:\/\/wordpress\.org\/\?v=([\d.]+)<\/generator>/);
    if (m) { wpVer = m[1]; wpVerSrc = 'RSS feed'; }
  }
  const coreLatest = isWp ? await wporg.core() : null;
  R.wp = { isWp, version: wpVer, versionSource: wpVerSrc, latest: coreLatest, gap: gap(wpVer, coreLatest), generators: gens, restStatus: nsRes.status, restOpen: ns.includes('wp/v2'), namespaces: ns, siteName: restJson?.name || null };
  if (!isWp && R.status === 'ok') R.status = 'not-wp';

  // ---- téma, pluginok
  const themeSlugs = [...new Set([...html.matchAll(/\/wp-content\/themes\/([A-Za-z0-9_.-]+)\//g)].map(m => m[1]))];
  const pluginVers = {};
  for (const m of html.matchAll(/\/wp-content\/plugins\/([a-z0-9_-]+)\/[^"'\s)]*?(?:\?ver=([0-9][0-9a-z.\-]*))?["'\s)&]/gi)) {
    const slug = m[1].toLowerCase(); (pluginVers[slug] ||= []); if (m[2]) pluginVers[slug].push(m[2]);
  }
  // REST-névtérből felismert pluginok
  const NS_PLUGIN = { 'yoast/v1': 'wordpress-seo', 'rankmath/v1': 'seo-by-rank-math', 'seopress/v1': 'wp-seopress', 'aioseo/v1': 'all-in-one-seo-pack', 'wordfence/v1': 'wordfence', 'ithemes-security/v1': 'better-wp-security', 'complianz/v1': 'complianz-gdpr', 'cky/v1': 'cookie-law-info', 'wc/store': 'woocommerce', 'wc/v3': 'woocommerce', 'contact-form-7/v1': 'contact-form-7', 'elementor/v1': 'elementor', 'litespeed/v1': 'litespeed-cache', 'jetpack/v4': 'jetpack', 'redirection/v1': 'redirection', 'tribe/events/v1': 'the-events-calendar', 'wpml/v1': 'sitepress-multilingual-cms', 'pll/v1': 'polylang', 'google-site-kit/v1': 'google-site-kit', 'wp-statistics/v2': 'wp-statistics', 'monsterinsights/v1': 'google-analytics-for-wordpress', 'wpforms/v1': 'wpforms-lite', 'fluentform/v1': 'fluentform', 'aios/v1': 'all-in-one-wp-security-and-firewall', 'wp-rocket/v1': 'wp-rocket', 'burst/v1': 'burst-statistics', 'updraftplus/v1': 'updraftplus' };
  for (const n of ns) { const base = n.replace(/\/v\d+$/, '/v1'); const slug = NS_PLUGIN[n] || NS_PLUGIN[base]; if (slug && !pluginVers[slug]) pluginVers[slug] = []; }

  const elemGen = (gens.find(g => /^Elementor /.test(g)) || '').match(/Elementor ([\d.]+)/);
  if (elemGen) { pluginVers.elementor ||= []; pluginVers.elementor.unshift(elemGen[1], elemGen[1], elemGen[1]); }
  const wcGen = (gens.find(g => /^WooCommerce /.test(g)) || '').match(/WooCommerce ([\d.]+)/);
  if (wcGen) { pluginVers.woocommerce ||= []; pluginVers.woocommerce.unshift(wcGen[1], wcGen[1], wcGen[1]); }

  log(`pluginok (${Object.keys(pluginVers).length})`);
  const slugs = Object.keys(pluginVers).slice(0, 60);
  R.plugins = await pool(slugs, 4, async slug => {
    let ver = mode(pluginVers[slug].filter(isVer)), src = ver ? 'asset ?ver=' : null;
    if (slug === 'elementor' && elemGen) src = 'generator';
    if (slug === 'woocommerce' && wcGen) src = 'generator';
    const rd = await client.tryGet(`https://${finalHost}/wp-content/plugins/${slug}/readme.txt`, { maxBytes: 60_000, timeout: 8000, maxRedirects: 2 });
    if (rd.status === 200 && /===|Stable tag/i.test(rd.body)) {
      const st = (rd.body.match(/Stable tag:\s*([0-9][0-9a-z.\-]*)/i) || [])[1];
      if (st && isVer(st) && (!ver || src === 'asset ?ver=')) { ver = st; src = 'readme.txt'; }
    }
    const info = await wporg.plugin(slug);
    const p = { slug, name: decodeEntities(info?.name || slug), version: ver, versionSource: src, latest: info?.version || null, notOnWporg: !!info?.notOnWporg, risky: S.RISKY[slug] || null };
    if (p.version && p.latest) { p.gap = gap(p.version, p.latest); p.outdated = cmpVer(p.version, p.latest) < 0; }
    return p;
  });

  R.theme = [];
  for (const slug of themeSlugs.slice(0, 3)) {
    const css = await client.tryGet(`https://${finalHost}/wp-content/themes/${slug}/style.css`, { maxBytes: 20_000, timeout: 8000, maxRedirects: 2 });
    const hdr = k => ((css.body || '').match(new RegExp(k + ':\\s*(.+)', 'i')) || [])[1]?.trim() || null;
    const t = { slug, name: hdr('Theme Name') || slug, version: hdr('Version'), parent: hdr('Template') };
    const info = await wporg.theme(slug);
    t.latest = info?.version || null; t.notOnWporg = !!info?.notOnWporg;
    if (t.version && t.latest) t.outdated = cmpVer(t.version, t.latest) < 0;
    R.theme.push(t);
  }

  // ---- felismert komponensek
  const has = (sig) => {
    const hit = [];
    for (const s of sig) {
      if ((s.slug && pluginVers[s.slug]) || (s.ns && ns.some(n => n.startsWith(s.ns.split('/')[0]))) || (s.theme && themeSlugs.includes(s.theme)) || (s.header && H[s.header]) || (s.html && !s.slug && !s.theme && s.html.test(html))) hit.push(s.name);
    }
    return hit;
  };
  R.detected = { builder: has(S.BUILDERS), seo: has(S.SEO), security: has(S.SECURITY), cache: has(S.CACHE), cookie: has(S.COOKIE), ecommerce: has(S.ECOM), multilang: has(S.MULTILANG), booking: has(S.BOOKING), forms: has(S.FORMS) };
  if (!R.detected.builder.length && isWp) R.detected.builder.push(/wp-block-|is-layout-/.test(html) ? 'Gutenberg (blokkszerkesztő)' : 'nem azonosított');
  R.detected.cookieModern = S.COOKIE.filter(c => R.detected.cookie.includes(c.name)).map(c => ({ name: c.name, modern: c.modern }));

  // ---- biztonsági jelek
  log('biztonság');
  const sec = {};
  const users = await client.tryGet(`https://${finalHost}/wp-json/wp/v2/users?per_page=100&_fields=id,slug`, { maxBytes: 300_000, timeout: 10000 });
  let ul = null; try { ul = JSON.parse(users.body); } catch {}
  sec.usersRest = Array.isArray(ul) && ul.length ? { exposed: true, count: ul.length, hasAdminSlug: ul.some(u => /^admin(istrator)?(-\d+)?$/i.test(u.slug || '')) } : { exposed: false };
  const auth = await client.tryRaw(`https://${finalHost}/?author=1`, { maxBytes: 2000, timeout: 8000 });
  const al = auth.headers?.location || '';
  sec.authorEnum = /\/author\/[^/]+/.test(al);
  const xr = await client.tryGet(`https://${finalHost}/xmlrpc.php`, { maxBytes: 5000, timeout: 8000, maxRedirects: 2 });
  sec.xmlrpc = /XML-RPC server accepts POST requests only/i.test(xr.body || '');
  const rm = await client.tryGet(`https://${finalHost}/readme.html`, { maxBytes: 20000, timeout: 8000, maxRedirects: 1 });
  sec.readme = rm.status === 200 && /WordPress/i.test(rm.body);
  const dl = await client.tryRaw(`https://${finalHost}/wp-content/debug.log`, { maxBytes: 4000, timeout: 10000, headers: { range: 'bytes=0-3999' } });
  const dlLen = +(String(dl.headers?.['content-range'] || '').split('/')[1] || dl.headers?.['content-length'] || 0);
  sec.debugLog = (dl.status === 200 || dl.status === 206) && /PHP (Warning|Notice|Fatal|Deprecated|Parse)|\[\d{2}-\w{3}-\d{4}/i.test(dl.body || '') ? { exposed: true, sizeKB: Math.round(dlLen / 1024) } : { exposed: false };
  const up = await client.tryGet(`https://${finalHost}/wp-content/uploads/`, { maxBytes: 20000, timeout: 8000, maxRedirects: 1 });
  sec.uploadsListing = up.status === 200 && /<title>Index of/i.test(up.body);
  const git = await client.tryRaw(`https://${finalHost}/.git/HEAD`, { maxBytes: 500, timeout: 6000 });
  sec.gitExposed = git.status === 200 && /^ref: refs\//.test(git.body || '');
  const login = await client.tryRaw(`https://${finalHost}/wp-login.php`, { maxBytes: 3000, timeout: 8000 });
  sec.loginReachable = login.status === 200;
  sec.headers = { hsts: !!H['strict-transport-security'], xfo: !!H['x-frame-options'] || /frame-ancestors/i.test(H['content-security-policy'] || ''), xcto: !!H['x-content-type-options'], csp: !!H['content-security-policy'] };
  R.security = sec;

  // ---- tartalom-mennyiség
  const tot = async t => { const r = await client.tryRaw(`https://${finalHost}/wp-json/wp/v2/${t}?per_page=1&_fields=id`, { maxBytes: 5000, timeout: 10000 }); return r.status === 200 ? +r.headers['x-wp-total'] || 0 : null; };
  R.content = R.wp.restOpen ? { posts: await tot('posts'), pages: await tot('pages'), media: await tot('media') } : {};

  // ---- spam-szűrés
  if (spamScan && isWp) { log('spam-szűrés'); R.spam = await spamCheck(client, finalHost, R); }

  // ---- SEO-alapok
  log('SEO');
  const h1 = (html.match(/<h1[\s>]/gi) || []).length;
  const desc = meta(html, 'name', 'description');
  const robotsMeta = meta(html, 'name', 'robots') || '';
  const imgs = [...html.matchAll(/<img\b[^>]*>/gi)].map(m => m[0]);
  const robots = await client.tryGet(`https://${finalHost}/robots.txt`, { maxBytes: 100_000, timeout: 8000, maxRedirects: 2 });
  const rtxt = robots.status === 200 ? robots.body : '';
  const smFromRobots = [...rtxt.matchAll(/^sitemap:\s*(\S+)/gim)].map(m => m[1]);
  const disallowAll = /user-agent:\s*\*[\s\S]*?^disallow:\s*\/\s*$/im.test(rtxt);
  let sitemap = null;
  for (const u of [...smFromRobots, `https://${finalHost}/sitemap_index.xml`, `https://${finalHost}/wp-sitemap.xml`, `https://${finalHost}/sitemap.xml`]) {
    const r = await client.tryGet(u, { maxBytes: 300_000, timeout: 8000, maxRedirects: 3 });
    if (r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body)) { sitemap = { url: u, ok: true }; break; }
    if (!sitemap && smFromRobots.includes(u)) sitemap = { url: u, ok: false, status: r.status };
  }
  const ga4 = [...new Set([...html.matchAll(/\bG-[A-Z0-9]{6,12}\b/g)].map(m => m[0]))];
  const ua = [...new Set([...html.matchAll(/\bUA-\d{4,10}-\d{1,3}\b/g)].map(m => m[0]))];
  const gtm = [...new Set([...html.matchAll(/\bGTM-[A-Z0-9]{4,9}\b/g)].map(m => m[0]))];
  const gtagLoads = (html.match(/googletagmanager\.com\/gtag\/js/g) || []).length;
  R.seo = {
    title, titleLen: title.length, desc, descLen: desc ? desc.length : 0, h1, canonical: !!html.match(/<link[^>]+rel=["']canonical["']/i),
    noindex: /noindex/i.test(robotsMeta) || /noindex/i.test(H['x-robots-tag'] || ''), og: !!meta(html, 'property', 'og:title'), lang: (html.match(/<html[^>]+lang=["']([^"']+)/i) || [])[1] || null,
    viewportDup: (html.match(/<meta[^>]+name=["']viewport["']/gi) || []).length > 1,
    robotsTxt: { status: robots.status, disallowAll, sitemaps: smFromRobots }, sitemap,
    imgCount: imgs.length, imgNoAlt: imgs.filter(t => !/\balt=["'][^"']+["']/i.test(t)).length,
    analytics: { ga4, ua, gtm, gtagLoads, siteKit: !!pluginVers['google-site-kit'] || ns.includes('google-site-kit/v1'), monsterInsights: !!pluginVers['google-analytics-for-wordpress'] },
  };

  // ---- statikus GDPR-jelek
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m => ({ href: m[1], text: strip(m[2]).toLowerCase() }));
  const lt = l => (l.text + ' ' + safeDecode(l.href).toLowerCase());
  R.gdprStatic = {
    cmp: R.detected.cookie,
    privacy: links.some(l => /adatkezel|adatvédelm|adatvedelm|privacy|gdpr/.test(lt(l))),
    privacyPdf: links.some(l => /(adatkezel|adatvedelm|adatvédelm|privacy)[^ ]*\.pdf/.test(lt(l))),
    privacyExternalHost: links.filter(l => /(adatkezel|adatvedelm|adatvédelm|privacy|aszf|ászf)/.test(lt(l)) && /^https?:/i.test(l.href)).map(l => { try { return new URL(l.href).hostname; } catch { return ''; } }).filter(h => h && bare(h) !== bare(finalHost)).slice(0, 3),
    imprint: links.some(l => /impresszum|imprint|jogi nyilatkozat/.test(lt(l))),
    cookiePolicy: links.some(l => /süti|suti|cookie/.test(lt(l)) && /szabályzat|szabalyzat|policy|tájékoztat|tajekoztat/.test(lt(l))),
    consentModeInHtml: /gtag\(\s*['"]consent['"]\s*,\s*['"]default/.test(html),
  };

  // ---- teljesítmény (statikus)
  R.perf = { ttfb: R.reach.ttfb, htmlKB: R.reach.htmlKB, scripts: (html.match(/<script\b/gi) || []).length, styles: (html.match(/<link[^>]+stylesheet/gi) || []).length, imgs: imgs.length, compression: H['content-encoding'] || null, domNodesApprox: (html.match(/<[a-z]/gi) || []).length };

  return R;
}

async function spamCheck(client, host, R) {
  const out = { method: null, candidates: 0, confirmed: 0, samples: [], newest: null, oldest: null, recent: false };
  if (R.wp.restOpen) {
    out.method = 'REST API';
    const seen = new Map();
    await pool(S.SPAM_TERMS, 3, async term => {
      const r = await client.tryGet(`https://${host}/wp-json/wp/v2/posts?search=${encodeURIComponent(term)}&per_page=100&_fields=id,date,link,title`, { maxBytes: 2_000_000, timeout: 15000, maxRedirects: 2 });
      if (r.status !== 200) return;
      let a; try { a = JSON.parse(r.body); } catch { return; }
      if (!Array.isArray(a)) return;
      const total = +r.headers['x-wp-total'] || a.length;
      for (const p of a) seen.set(p.id, { id: p.id, date: p.date, link: p.link, title: strip(p.title?.rendered || '') });
      if (total > a.length) out.truncated = true, out.minTotal = Math.max(out.minTotal || 0, total);
    });
    out.candidates = seen.size;
    const conf = [...seen.values()].filter(p => S.SPAM_RX.test(p.title) || S.SPAM_RX.test(safeDecode(p.link || '')));
    out.confirmed = Math.max(conf.length, out.minTotal && conf.length > 50 ? out.minTotal : 0);
    conf.sort((a, b) => String(b.date).localeCompare(String(a.date)));
    out.samples = conf.slice(0, 5).map(p => ({ title: p.title.slice(0, 90), date: p.date?.slice(0, 10) }));
    out.newest = conf[0]?.date?.slice(0, 10) || null; out.oldest = conf.at(-1)?.date?.slice(0, 10) || null;
  } else {
    // sitemap-alapú tartalék
    out.method = 'sitemap';
    const idx = await client.tryGet(`https://${host}/wp-sitemap.xml`, { maxBytes: 300_000, timeout: 10000, maxRedirects: 3 });
    let subs = [...(idx.body || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]).filter(u => /posts-post|post-sitemap/.test(u));
    if (!subs.length) { const y = await client.tryGet(`https://${host}/post-sitemap.xml`, { maxBytes: 2_000_000, timeout: 10000, maxRedirects: 3 }); if (y.status === 200) subs = [`https://${host}/post-sitemap.xml`]; }
    let urls = [];
    for (const s of subs.slice(0, 10)) { const r = await client.tryGet(s, { maxBytes: 3_000_000, timeout: 15000, maxRedirects: 3 }); urls.push(...[...(r.body || '').matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1])); }
    const conf = urls.filter(u => S.SPAM_RX.test(safeDecode(u)));
    out.candidates = conf.length; out.confirmed = conf.length; out.samples = conf.slice(0, 5).map(u => ({ title: safeDecode(u).replace(/^https?:\/\/[^/]+/, '').slice(0, 90), date: null }));
    if (!subs.length) out.method = 'nem vizsgálható (REST és sitemap zárva)';
  }
  if (out.newest) out.recent = (Date.now() - new Date(out.newest)) / 86400000 <= 30;
  return out;
}
