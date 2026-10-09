// Valós felhasználói adatok (Chrome UX Report): opcionális, GOOGLE_API_KEY környezeti változó kell hozzá
export const cruxEnabled = () => !!process.env.GOOGLE_API_KEY;

const METRICS = { largest_contentful_paint: 'lcp', interaction_to_next_paint: 'inp', cumulative_layout_shift: 'cls', first_contentful_paint: 'fcp' };

export function parseCrux(json) {
  const m = json?.record?.metrics || {};
  const out = {};
  for (const [k, short] of Object.entries(METRICS)) {
    const x = m[k]; if (!x?.percentiles?.p75 && x?.percentiles?.p75 !== 0) continue;
    const p75 = +x.percentiles.p75;
    const dist = (x.histogram || []).map(h => Math.round((+h.density || 0) * 100));
    // LCP, INP, FCP ezredmásodpercben jön, a CLS tizedes szám (szövegként)
    out[short] = { p75: short === 'cls' ? +p75.toFixed(3) : Math.round(p75), good: dist[0] ?? null, ni: dist[1] ?? null, poor: dist[2] ?? null };
  }
  return Object.keys(out).length ? out : null;
}

export async function cruxLookup(client, origin) {
  const key = process.env.GOOGLE_API_KEY; if (!key) return null;
  const res = {};
  for (const [name, formFactor] of [['phone', 'PHONE'], ['desktop', 'DESKTOP']]) {
    const r = await client.postJson(`https://chromeuxreport.googleapis.com/v1/records:queryRecord?key=${encodeURIComponent(key)}`, { origin, formFactor });
    if (r.status === 404) { res[name] = { error: 'Nincs elég valós látogatói adat ehhez az oldalhoz' }; continue; }
    if (r.status === 403 || r.status === 400) { return { error: 'A Google API-kulcs érvénytelen, vagy a Chrome UX Report API nincs engedélyezve hozzá.' }; }
    if (r.status !== 200) { res[name] = { error: `A CrUX nem adott adatot (HTTP ${r.status || 'hiba'})` }; continue; }
    let j; try { j = JSON.parse(r.body); } catch { res[name] = { error: 'Értelmezhetetlen válasz' }; continue; }
    res[name] = parseCrux(j) || { error: 'A válasz nem tartalmaz mérőszámot' };
  }
  return res;
}
