// Törött linkek és hosszú átirányítási láncok ellenőrzése (a GEO-bejárás oldalairól összegyűjtött linkeken)
import { pool } from './http.mjs';

const SKIP_SCHEME = /^(mailto|tel|javascript|sms|data|whatsapp|viber|skype|callto):/i;
const FILE_EXT = /\.(jpe?g|png|gif|webp|svg|ico|css|js|woff2?|ttf|mp4|mp3|zip|pdf|docx?|xlsx?)(\?|$)/i;
const sameSite = (host, site) => host.replace(/^www\./, '') === site.replace(/^www\./, '');

// az oldalak linkjeiből egyedi belső és külső URL-lista (oldalonként a forrás oldal is megmarad)
export function collectLinks(pages, homeUrl, { maxInternal = 120, maxExternal = 40 } = {}) {
  const site = new URL(homeUrl).hostname;
  const internal = new Map(), external = new Map();
  for (const p of pages) for (const [href] of p.links || []) {
    if (!href || SKIP_SCHEME.test(href) || href.startsWith('#')) continue;
    let u; try { u = new URL(href, p.url); } catch { continue; }
    if (!/^https?:$/.test(u.protocol)) continue;
    u.hash = '';
    if (/\/(wp-admin|wp-login\.php|wp-json|xmlrpc\.php|feed)(\/|$)|[?&](replytocom|add-to-cart)=/i.test(u.href)) continue;
    const map = sameSite(u.hostname, site) ? internal : external;
    if (!map.has(u.href)) map.set(u.href, p.url);
  }
  const top = (m, n) => [...m.entries()].slice(0, n).map(([url, from]) => ({ url, from }));
  // a kép- és fájllinkeket a külső listából is ellenőrizzük, de a belsőknél előre vesszük a HTML-oldalakat
  const ie = [...internal.entries()].sort((a, b) => Number(FILE_EXT.test(a[0])) - Number(FILE_EXT.test(b[0])));
  return { internal: ie.slice(0, maxInternal).map(([url, from]) => ({ url, from })), external: top(external, maxExternal), internalTotal: internal.size, externalTotal: external.size };
}

// egy URL ellenőrzése: HEAD, ha a szerver nem támogatja, GET; az átirányítási lánc hosszával
async function probe(client, url) {
  let r = await client.tryGet(url, { method: 'HEAD', maxBytes: 2000, timeout: 12000, maxRedirects: 6 });
  if (r.status === 0 && /Túl sok átirányítás/.test(r.error || '')) return { status: 0, hops: 7, error: 'átirányítási hurok' };
  if ([405, 501, 403, 400].includes(r.status) || (r.status === 0 && !/Privát|Túl sok/.test(r.error || ''))) {
    const g = await client.tryGet(url, { maxBytes: 4000, timeout: 12000, maxRedirects: 6 });
    if (g.status || !r.status) r = g;
  }
  return { status: r.status, hops: (r.chain?.length || 1) - 1, error: r.error || null };
}

// set: a collectLinks eredménye (a GEO-bejárás tárolja R.geo.linkSet néven)
export async function linkCheck(client, set, { concurrency = 3 } = {}) {
  const run = async list => (await pool(list, concurrency, async it => ({ ...it, ...(await probe(client, it.url)) })));
  const [ri, re] = [await run(set.internal), await run(set.external)];
  // 401/403/429/999: a külső oldal a botokat tiltja, nem törött link
  const restricted = r => [401, 403, 429, 451, 999].includes(r.status);
  const broken = r => (r.status === 0 && !/Privát/.test(r.error || '')) || r.status === 404 || r.status === 410 || r.status >= 500;
  return {
    checked: ri.length + re.length, internalTotal: set.internalTotal, externalTotal: set.externalTotal,
    brokenInternal: ri.filter(broken).map(r => ({ url: r.url, status: r.status, from: r.from, error: r.error })),
    brokenExternal: re.filter(broken).map(r => ({ url: r.url, status: r.status, from: r.from, error: r.error })),
    restricted: [...ri, ...re].filter(restricted).length,
    redirectChains: [...ri, ...re].filter(r => r.hops >= 3).map(r => ({ url: r.url, hops: r.hops, from: r.from })).slice(0, 15),
  };
}
