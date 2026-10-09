// E-mail hitelesítés (MX, SPF, DKIM, DMARC) és domain-lejárat (RDAP) ellenőrzése – csak nyilvános DNS- és RDAP-adatok
import dns from 'node:dns/promises';

const DKIM_SELECTORS = ['default', 'google', 'selector1', 'selector2', 'k1', 'k2', 'mail', 'dkim', 's1', 's2', 'smtp', 'mandrill', 'mxvault', 'zoho', 'protonmail'];
const withTimeout = (p, ms = 6000) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]);
const txt = async (resolver, name) => { try { return (await withTimeout(resolver.resolveTxt(name))) ?.map(a => a.join('')) || []; } catch { return []; } };

export function parseSpf(rec) {
  if (!rec) return null;
  const policy = (rec.match(/\s([-~?+]?)all\b/) || [])[1];
  // DNS-lekérdezést igénylő tagok: include, a, mx, ptr, exists, redirect (a tag előtti minősítő jel nem számít)
  const lookups = rec.split(/\s+/).filter(t => /^[-~?+]?(include:|a(:|\/|$)|mx(:|\/|$)|ptr(:|$)|exists:|redirect=)/i.test(t)).length;
  return { record: rec, policy: policy === undefined ? null : (policy || '+') + 'all', lookups };
}
export function parseDmarc(rec) {
  if (!rec) return null;
  const tag = k => (rec.match(new RegExp(`(?:^|;)\\s*${k}\\s*=\\s*([^;\\s]+)`, 'i')) || [])[1] || null;
  return { record: rec, policy: (tag('p') || '').toLowerCase() || null, pct: tag('pct') ? +tag('pct') : 100, rua: tag('rua') };
}

export async function mailCheck(domain, resolver = dns) {
  const out = { domain, mx: [], hasMx: false, spf: null, dmarc: null, dkim: [], issues: [] };
  try { out.mx = ((await withTimeout(resolver.resolveMx(domain))) || []).sort((a, b) => a.priority - b.priority).slice(0, 5); } catch {}
  out.hasMx = out.mx.length > 0;
  const spfRecs = (await txt(resolver, domain)).filter(t => /^v=spf1\b/i.test(t));
  out.spf = parseSpf(spfRecs[0]); out.spfCount = spfRecs.length;
  const dm = (await txt(resolver, `_dmarc.${domain}`)).filter(t => /^v=DMARC1\b/i.test(t));
  out.dmarc = parseDmarc(dm[0]);
  if (out.hasMx) for (const sel of DKIM_SELECTORS) { const r = await txt(resolver, `${sel}._domainkey.${domain}`); if (r.some(t => /v=DKIM1|p=/i.test(t))) out.dkim.push(sel); }
  // csak az e-mail fogadására beállított domainnél értelmezhető
  if (out.hasMx) {
    if (!out.spf) out.issues.push({ id: 'spf-missing', sev: 'közepes', title: 'Nincs SPF-rekord', detail: 'Az SPF nélkül könnyebb hamisítani a domainről küldött leveleket, és több levél spamnek minősülhet.', fix: 'SPF TXT rekord felvétele a DNS-ben (a használt levelezőszolgáltatókkal).' });
    else if (out.spfCount > 1) out.issues.push({ id: 'spf-multiple', sev: 'közepes', title: 'Több SPF-rekord van a domainen', detail: 'Egy domainhez csak egy SPF rekord tartozhat, több esetén az SPF érvénytelen.', fix: 'Az SPF rekordok egyesítése egyetlen rekorddá.' });
    else if (out.spf.policy === '+all' || out.spf.policy === '?all') out.issues.push({ id: 'spf-weak', sev: 'közepes', title: `Gyenge SPF-szabály (${out.spf.policy})`, detail: 'A „+all” vagy „?all” gyakorlatilag mindenkinek engedélyezi a küldést a domain nevében.', fix: 'A rekord végére „~all” vagy „-all” kerüljön.' });
    if (out.spf?.lookups > 10) out.issues.push({ id: 'spf-lookups', sev: 'alacsony', title: `Az SPF sok DNS-lekérdezést igényel (${out.spf.lookups})`, detail: 'A 10-nél több lekérdezés érvénytelenné teheti az SPF-et.', fix: 'Felesleges include-ok eltávolítása.' });
    if (!out.dmarc) out.issues.push({ id: 'dmarc-missing', sev: 'közepes', title: 'Nincs DMARC-rekord', detail: 'A DMARC mondja meg a fogadó szervereknek, mit tegyenek a hamis levelekkel; a nagy levelezők (Gmail, Yahoo) már elvárják.', fix: '_dmarc TXT rekord felvétele, kezdetben p=none és riport-címmel (rua), majd szigorítás.' });
    else if (out.dmarc.policy === 'none') out.issues.push({ id: 'dmarc-none', sev: 'alacsony', title: 'A DMARC csak figyel (p=none)', detail: 'A hamis leveleket nem blokkolja.', fix: 'A riportok átnézése után p=quarantine, majd p=reject.' });
  }
  return out;
}

// ---- domain-lejárat az RDAP-ból (IANA bootstrap alapján)
let bootstrap = null, bootstrapAt = 0;
async function rdapBase(client, tld) {
  if (!bootstrap || Date.now() - bootstrapAt > 24 * 3600 * 1000) {
    const r = await client.tryGet('https://data.iana.org/rdap/dns.json', { timeout: 10000, maxBytes: 600000 });
    if (r.status === 200) { try { bootstrap = JSON.parse(r.body); bootstrapAt = Date.now(); } catch {} }
  }
  const svc = bootstrap?.services?.find(([tlds]) => tlds.includes(tld));
  return svc?.[1]?.find(u => u.startsWith('https://')) || svc?.[1]?.[0] || null;
}
export async function domainExpiry(client, domain) {
  const parts = domain.split('.'); const tld = parts.at(-1);
  // a regisztrálható domain a TLD + egy címke (a .co.uk-szerű többszintű végződéseket a bootstrap sem ismeri külön)
  const reg = parts.slice(-2).join('.');
  const base = await rdapBase(client, tld);
  if (!base) return { error: `A(z) .${tld} végződéshez nincs elérhető RDAP-szolgáltatás` };
  const r = await client.tryGet(`${base.replace(/\/?$/, '/')}domain/${reg}`, { timeout: 12000, maxBytes: 400000, headers: { accept: 'application/rdap+json, application/json' } });
  if (r.status !== 200) return { error: `Az RDAP nem adott adatot (HTTP ${r.status || 'hiba'})` };
  let j; try { j = JSON.parse(r.body); } catch { return { error: 'Az RDAP válasza nem értelmezhető' }; }
  const ev = (j.events || []).find(e => /expiration/i.test(e.eventAction));
  const registrar = (j.entities || []).find(e => (e.roles || []).includes('registrar'))?.vcardArray?.[1]?.find(x => x[0] === 'fn')?.[3] || null;
  if (!ev?.eventDate) return { error: 'Az RDAP nem tartalmaz lejárati dátumot', registrar };
  const expires = new Date(ev.eventDate);
  return { expires: expires.toISOString().slice(0, 10), daysLeft: Math.floor((expires - Date.now()) / 86400000), registrar };
}
