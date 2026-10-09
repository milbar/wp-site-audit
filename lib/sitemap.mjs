// Aloldalak kiválasztása a sitemapből (Lighthouse-hoz). Csak az oldal saját hosztjáról, típusonként váltogatva.
const SKIP = /\.(jpe?g|png|gif|webp|svg|pdf|zip|xml|mp4|mp3|docx?|xlsx?|kml|txt|json|rss|ics)(\?|$)|\/(tag|category|kategoria|author|feed|wp-json|wp-content|wp-admin|cart|kosar|checkout|penztar|my-account|fiok)(\/|$)/i;
const locs = xml => [...(xml || '').matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/g)].map(m => m[1].replace(/&amp;/g, '&'));
const sameSite = (u, host) => { try { const h = new URL(u).hostname.replace(/^www\./, ''); return h === host.replace(/^www\./, ''); } catch { return false; } };
const isSub = sub => /(^|[-_/])(page|post|product|portfolio|service|szolgaltat|projekt|news|blog|cikk)/i.test(sub);

export async function pickSitemapUrls(client, host, { sitemapUrl, homeUrl, limit = 3 } = {}) {
  if (limit <= 0) return [];
  const get = u => client.tryGet(u, { maxBytes: 1_500_000, timeout: 10000, maxRedirects: 3 });
  const roots = [sitemapUrl, `https://${host}/sitemap_index.xml`, `https://${host}/wp-sitemap.xml`, `https://${host}/sitemap.xml`].filter(Boolean);
  let root = null;
  for (const u of [...new Set(roots)]) {
    const r = await get(u);
    if (r.status === 200 && /<(urlset|sitemapindex)/i.test(r.body || '')) { root = r.body; break; }
  }
  if (!root) return [];
  // sitemap-index: a gyermek-sitemapek (maximum 6, a tartalomtípusosak előre), különben maga az urlset
  let groups;
  if (/<sitemapindex/i.test(root)) {
    const subs = locs(root).filter(u => sameSite(u, host) && !/(taxonom|tag|category|author|user|attachment|media|image)/i.test(u));
    subs.sort((a, b) => Number(isSub(b)) - Number(isSub(a)));
    groups = [];
    for (const u of subs.slice(0, 6)) { const r = await get(u); if (r.status === 200) groups.push(locs(r.body)); }
  } else groups = [locs(root)];
  const home = homeUrl ? new URL(homeUrl) : null;
  const isHome = u => { try { const x = new URL(u); return x.pathname.replace(/\/+$/, '') === '' && (!home || x.hostname.replace(/^www\./, '') === home.hostname.replace(/^www\./, '')); } catch { return true; } };
  const clean = groups.map(g => g.filter(u => sameSite(u, host) && !isHome(u) && !SKIP.test(u)));
  // váltogatva szedünk az egyes sitemapekből, hogy különböző típusú oldalak kerüljenek be
  const out = [], seen = new Set();
  for (let i = 0; out.length < limit; i++) {
    let any = false;
    for (const g of clean) {
      if (i < g.length) { any = true; const u = g[i]; if (!seen.has(u) && out.length < limit) { seen.add(u); out.push(u); } }
    }
    if (!any) break;
  }
  return out;
}
