// Közös, megjelenítésre szánt összefoglaló mezők (UI, xlsx, docx, html)
import { TIER_NAMES } from './rules.mjs';
export const STATUS_HU = { ok: 'Éles', maintenance: 'Karbantartás mód', redirect: 'Átirányítás', down: 'Nem elérhető', error: 'Hibás válasz', 'not-wp': 'Nem WordPress', blocked: 'Bot-védelem blokkolja' };
export const fmtH = h => (h == null ? '' : String(+(+h).toFixed(2)).replace('.', ','));

export function summarize(site) {
  const R = site.result || {};
  const pl = R.plugins || [];
  const builder = (R.detected?.builder || []).map(b => {
    const p = pl.find(x => x.name === b || x.slug === ({ Elementor: 'elementor', 'Elementor Pro': 'elementor-pro' }[b]));
    return p?.version ? `${b} ${p.version}` : b;
  });
  const theme = (R.theme || []).map(t => `${t.name}${t.version ? ' ' + t.version : ''}`).join(' / ');
  const lh = R.lighthouse && !R.lighthouse.error ? R.lighthouse : null;
  return {
    domain: site.domain, client: site.client || '',
    status: STATUS_HU[R.status] || site.state,
    statusKey: R.status || site.state,
    tier: R.tier ? TIER_NAMES[R.tier] : '',
    wp: R.wp?.version ? `${R.wp.version}${R.wp.gap?.behind ? ' (→ ' + R.wp.latest + ')' : ''}` : (R.wp?.isWp ? '?' : '–'),
    builder: builder.join(', '),
    theme,
    php: R.server?.php ? `${R.server.php.ver}${R.server.php.isEol ? ' (EOL)' : ''}` : '',
    plugins: pl.length ? `${pl.length} / ${pl.filter(p => p.outdated).length} elavult` : '',
    security: (R.detected?.security || []).join(', '),
    seoPlugin: (R.detected?.seo || []).join(', '),
    cookie: (R.detected?.cookie || []).join(', '),
    spam: R.spam ? (R.spam.confirmed ? `${R.spam.truncated ? '≥' : ''}${R.spam.confirmed}${R.spam.recent ? ' (aktív)' : ''}` : '0') : '',
    gdpr: R.gdprState || '',
    analytics: R.seo?.analytics ? [R.seo.analytics.ga4.length && 'GA4', R.seo.analytics.ua.length && 'UA (megszűnt)', R.seo.analytics.gtm.length && 'GTM', R.seo.analytics.siteKit && 'Site Kit'].filter(Boolean).join(', ') || 'nincs' : '',
    geo: R.geo && !R.geo.error ? R.geo : null,
    aiSummary: R.aiSummary?.text ? R.aiSummary : null,
    lh, lhDesktop: R.lighthouseDesktop && !R.lighthouseDesktop.error ? R.lighthouseDesktop : null, lhPages: R.lighthousePages || [], ttfb: R.reach?.ttfb ?? null,
    critical: R.flags?.critical || 0, high: R.flags?.high || 0, hacked: !!R.flags?.hacked,
    totals: R.totals || {}, priority: R.priority ?? 9,
  };
}
export const sortSites = sites => Object.values(sites).sort((a, b) => ((a.result?.priority ?? 9) - (b.result?.priority ?? 9)) || ((b.result?.totals?.kotelezo || 0) - (a.result?.totals?.kotelezo || 0)) || a.domain.localeCompare(b.domain));
