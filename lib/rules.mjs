// Megállapítások és javítási javaslatok a felmérés nyers adataiból.
// group: kotelezo = alap rendbetétel | gdpr / seo / tartalom = opcionális | info = csak tájékoztató
export const SEV_ORDER = { kritikus: 0, magas: 1, 'közepes': 2, alacsony: 3, info: 4 };
export const GROUPS = { kotelezo: 'Javasolt rendbetétel', gdpr: 'Opcionális: GDPR és süti-kezelés', seo: 'Opcionális: SEO és mérés', tartalom: 'Opcionális: tartalom', domain: 'Opcionális: domain, DNS és e-mail', info: 'Tájékoztató' };
export const TIER_NAMES = { S: 'Egyszerű', M: 'Közepes', L: 'Összetett' };

export function estimateTier(R) {
  const d = R.detected || {};
  let score = (R.plugins?.length || 0) / 12;
  if (d.ecommerce?.length) score += 2;
  if (d.multilang?.length) score += 1;
  if (d.booking?.length) score += 1;
  if ((R.content?.pages || 0) > 60 || (R.content?.posts || 0) > 300) score += 0.5;
  return score >= 4 ? 'L' : score >= 2 ? 'M' : 'S';
}

export function analyze(R, settings) {
  const H = settings.hours;
  const F = [];
  const add = (o) => F.push({ hours: 0, group: 'kotelezo', ...o });
  const wp = R.wp || {}, sec = R.security || {}, d = R.detected || {};
  R.tier = R.status === 'ok' || R.status === 'maintenance' ? estimateTier(R) : null;

  // ---- elérhetőség
  if (R.status === 'down') { add({ id: 'down', sev: 'kritikus', cat: 'Elérhetőség', title: 'Az oldal nem érhető el', detail: R.reach?.error || '', fix: 'Szerver-, DNS- és tárhely-ellenőrzés, helyreállítás. A munkaigény kívülről nem becsülhető.', group: 'info', noEstimate: true }); return finalize(R, F); }
  if (R.status === 'blocked') { add({ id: 'blocked', sev: 'magas', cat: 'Elérhetőség', title: 'A webhely bot-védelme blokkolja az automatikus mérést', detail: `Védelmi oldal: „${R.reach?.blockedBy || '?'}”. A tartalom nem mérhető, ezért a többi eredmény hiányos.`, fix: 'Kérd az ügyfelet (vagy a tárhelyszolgáltatót), hogy engedélyezze a mérő gép IP-címét a védelemben (allowlist), majd futtasd újra a felmérést. Sablon levél a „Sablon e-mailek” dokumentumban.', group: 'info', noEstimate: true }); return finalize(R, F); }
  if (R.status === 'error') add({ id: 'http-error', sev: 'kritikus', cat: 'Elérhetőség', title: `A főoldal hibát ad (HTTP ${R.reach.status})`, detail: R.reach.ttfb ? `Válaszidő: ${R.reach.ttfb} ms` : '', fix: 'Hibanapló és erőforrás-ellenőrzés, helyreállítás. A munkaigény kívülről nem becsülhető.', group: 'info', noEstimate: true });
  if (R.status === 'maintenance') add({ id: 'maint', sev: 'magas', cat: 'Elérhetőség', title: 'Karbantartás / „hamarosan” mód aktív', detail: R.seo?.title ? `Cím: „${R.seo.title}”` : '', fix: 'Egyeztetés: szándékos-e; ha nem, élesítés vagy lezárás.', group: 'info' });
  if (R.status === 'redirect') {
    add({ id: 'redirect', sev: 'info', cat: 'Elérhetőség', title: 'Átirányító domain', detail: `→ ${R.reach.redirectTo}`, fix: 'Nem önálló oldal; elég a domain és az átirányítás felügyelete.', group: 'info' });
    if (R.reach.wpBehindRedirect) add({ id: 'wp-behind-redirect', sev: 'közepes', cat: 'Biztonság', title: 'Az átirányítás mögött élő WordPress fut', detail: 'A wp-login.php vagy a REST API elérhető a domainen.', fix: 'A karbantartatlan telepítés lezárása, csak a 301-es átirányítás maradjon.', hours: H.wpBehindRedirect });
  }
  if (R.status === 'not-wp') add({ id: 'not-wp', sev: 'info', cat: 'Elérhetőség', title: 'Nem WordPress oldal', detail: R.seo?.title || '', fix: '', group: 'info' });

  // ---- TLS
  const c = R.cert || {};
  if (c.validTo && c.daysLeft < 0) add({ id: 'ssl-expired', sev: 'kritikus', cat: 'Biztonság', title: 'Lejárt SSL-tanúsítvány', detail: `Lejárt: ${c.validTo.slice(0, 10)}`, fix: 'Tanúsítvány megújítása, automatikus megújítás és lejárat-figyelés beállítása.', hours: H.ssl });
  else if (c.error && !/^(TIMEOUT|ECONNREFUSED)$/.test(c.error) && !c.authorized) add({ id: 'ssl-invalid', sev: 'kritikus', cat: 'Biztonság', title: 'Érvénytelen SSL-tanúsítvány', detail: c.error, fix: 'Helyes, a domainre kiállított tanúsítvány telepítése, automatikus megújítással.', hours: H.ssl });
  else if (c.daysLeft != null && c.daysLeft < 14) add({ id: 'ssl-soon', sev: 'magas', cat: 'Biztonság', title: `Az SSL-tanúsítvány ${c.daysLeft} napon belül lejár`, detail: c.validTo?.slice(0, 10) || '', fix: 'Az automatikus megújítás ellenőrzése.', hours: H.ssl / 2 });
  if (R.reach && R.reach.httpToHttps === false && R.status !== 'down') add({ id: 'no-https-redirect', sev: 'közepes', cat: 'Biztonság', title: 'A http:// cím nem irányít át https://-re', fix: 'Kötelező HTTPS-átirányítás és HSTS beállítása.', hours: H.httpsRedirect });

  if (!wp.isWp || R.status === 'redirect') return finalize(R, F);

  // ---- frissítések
  const majors = [];
  if (wp.gap?.behind) {
    const big = wp.gap.major > 0 || wp.gap.minor >= 2;
    if (big) { majors.push('core'); add({ id: 'core-behind', sev: 'magas', cat: 'Frissítés', title: `WordPress ${wp.version} → ${wp.latest}`, detail: `Több főverzióval elmaradt (forrás: ${wp.versionSource}).`, fix: 'Lépcsőzetes core-frissítés stagingen, kompatibilitási teszttel.', hours: H.coreMajorBehind }); }
    else add({ id: 'core-minor', sev: 'közepes', cat: 'Frissítés', title: `WordPress ${wp.version} → ${wp.latest}`, detail: 'Kisebb lemaradás.', fix: 'A teljes frissítés része.' });
  } else if (!wp.version) add({ id: 'core-unknown', sev: 'info', cat: 'Frissítés', title: 'A WordPress-verzió kívülről nem azonosítható', fix: 'Az onboarding során ellenőrizendő.', group: 'info' });
  const el = (R.plugins || []).find(p => p.slug === 'elementor');
  if (el?.gap && (el.gap.major > 0 || el.gap.minor >= 3)) { majors.push('elementor'); add({ id: 'elementor-behind', sev: 'magas', cat: 'Frissítés', title: `Elementor ${el.version} → ${el.latest}`, detail: 'A builder több főverzióval elmaradt; a frissítés vizuális regressziós ellenőrzést igényel.', fix: 'Elementor (és Pro) lépcsőzetes frissítése stagingen, vizuális ellenőrzéssel.', hours: H.builderMajor }); }
  const wc = (R.plugins || []).find(p => p.slug === 'woocommerce');
  if (wc?.gap && (wc.gap.major > 0 || wc.gap.minor >= 3)) { majors.push('woocommerce'); add({ id: 'woo-behind', sev: 'magas', cat: 'Frissítés', title: `WooCommerce ${wc.version} → ${wc.latest}`, detail: 'Több verzióval elmaradt webshop-motor; sablon-felülírások ellenőrzése szükséges.', fix: 'WooCommerce-frissítés stagingen, rendelési folyamat tesztjével.', hours: H.builderMajor }); }
  const outdated = (R.plugins || []).filter(p => p.outdated);
  if (outdated.length) add({ id: 'plugins-outdated', sev: outdated.length >= 5 ? 'magas' : 'közepes', cat: 'Frissítés', title: `${outdated.length} plugin elavult`, detail: outdated.slice(0, 8).map(p => `${p.name} ${p.version} → ${p.latest}`).join('; ') + (outdated.length > 8 ? ' …' : ''), fix: 'A teljes frissítés része.' });
  const th = (R.theme || []).find(t => t.outdated);
  if (th) add({ id: 'theme-outdated', sev: 'közepes', cat: 'Frissítés', title: `Téma elavult: ${th.name} ${th.version} → ${th.latest}`, fix: 'A teljes frissítés része (gyermektéma esetén a szülőtéma frissítése).' });
  const php = R.server?.php;
  if (php?.isEol) add({ id: 'php-eol', sev: 'kritikus', cat: 'Frissítés', title: `PHP ${php.ver} – nem kap biztonsági javítást`, detail: `Támogatás vége: ${php.eol}`, fix: 'PHP-váltás aktuális verzióra kompatibilitási teszttel (pluginok, téma).', hours: H.phpEol });
  else if (php && php.daysLeft != null && php.daysLeft < 120) add({ id: 'php-soon', sev: 'közepes', cat: 'Frissítés', title: `PHP ${php.ver} támogatása ${php.eol}-án lejár`, fix: 'PHP-váltás tervezése a következő karbantartási ciklusban.', group: 'info' });
  else if (!php) add({ id: 'php-unknown', sev: 'info', cat: 'Frissítés', title: 'A PHP-verzió kívülről nem látszik', fix: 'Az onboarding során ellenőrizendő.', group: 'info' });

  // ---- biztonság
  const sp = R.spam;
  if (sp && sp.confirmed >= 3) {
    const n = sp.confirmed;
    const h = n < 10 ? H.incidentLt10 : n < 50 ? H.incidentLt50 : n < 200 ? H.incidentLt200 : n < 500 ? H.incidentLt500 : H.incidentMax;
    add({ id: 'hacked', sev: 'kritikus', cat: 'Biztonság', title: `Feltört oldal: ${sp.truncated ? '≥' : ''}${n} spam bejegyzés${sp.recent ? ' (aktív)' : ''}`, detail: `${sp.oldest || '?'} – ${sp.newest || '?'}; minta: ${sp.samples.slice(0, 2).map(s => '„' + s.title + '”').join(', ')}${(R.content?.posts) ? `; összes bejegyzés: ${R.content.posts}` : ''}`, fix: 'Incidenskezelés: mentés, spam és illetéktelen felhasználók eltávolítása, backdoor-keresés, core/plugin integritás-ellenőrzés, jelszócsere, Search Console eltávolítási kérelmek.', hours: h + (sp.recent ? H.incidentActiveExtra : 0), incident: true });
  } else if (sp && sp.candidates > 0) add({ id: 'spam-suspect', sev: 'közepes', cat: 'Biztonság', title: `${sp.candidates} gyanús bejegyzés a kulcsszavas keresésben`, detail: 'A címek alapján nem egyértelmű spam – kézi ellenőrzés javasolt.', fix: 'Bejegyzések átnézése az onboarding során.', group: 'info' });
  if (sec.debugLog?.exposed) add({ id: 'debug-log', sev: 'kritikus', cat: 'Biztonság', title: `Nyilvános debug.log (${sec.debugLog.sizeKB || '?'} KB)`, detail: '/wp-content/debug.log bárki számára letölthető (útvonalak, hibák, esetenként adatok).', fix: 'Fájl eltávolítása, WP_DEBUG_LOG áthelyezése webrooton kívülre, a naplózott hibák átnézése.', hours: H.debugLog });
  if (sec.gitExposed) add({ id: 'git', sev: 'kritikus', cat: 'Biztonság', title: 'Nyilvános .git könyvtár', detail: 'A forráskód és előzményei letölthetők.', fix: 'A .git eltávolítása a webrootból / hozzáférés tiltása, kitett titkok cseréje.', hours: H.gitExposed });
  for (const p of (R.plugins || []).filter(p => p.risky)) add({ id: 'risky-' + p.slug, sev: 'magas', cat: 'Biztonság', title: `Kockázatos plugin: ${p.name}`, detail: p.risky, fix: 'Eltávolítás vagy szigorúan korlátozott használat.', hours: H.riskyPlugin });
  const hard = [];
  if (sec.usersRest?.exposed) hard.push(`REST API kiadja a felhasználóneveket (${sec.usersRest.count} fiók${sec.usersRest.hasAdminSlug ? ', köztük „admin”' : ''})`);
  if (sec.authorEnum) hard.push('?author=1 felhasználónév-felderítés');
  if (sec.xmlrpc) hard.push('XML-RPC bekapcsolva');
  if (sec.readme) hard.push('readme.html elérhető');
  if (sec.uploadsListing) hard.push('uploads könyvtárlistázás');
  if (hard.length) add({ id: 'hardening', sev: sec.usersRest?.hasAdminSlug ? 'magas' : 'közepes', cat: 'Biztonság', title: 'Alap biztonsági keményítés hiányzik', detail: hard.join('; '), fix: 'Felhasználó-felderítés lezárása, XML-RPC tiltása, readme és könyvtárlistázás tiltása, biztonsági fejlécek.', hours: H.hardening });
  if (!d.security?.length) add({ id: 'no-security', sev: 'közepes', cat: 'Biztonság', title: 'Nem látható biztonsági bővítmény', fix: 'Biztonsági bővítmény telepítése (bejelentkezés-védelem, 2FA, fájlváltozás-figyelés) – az onboarding része.' });
  else if (d.security.length > 1) add({ id: 'dup-security', sev: 'alacsony', cat: 'Biztonság', title: `Párhuzamos biztonsági bővítmények: ${d.security.join(' + ')}`, fix: 'Konszolidálás egy megoldásra.', hours: H.dupSecurity });
  const mh = R.security?.headers || {};
  const missH = [!mh.hsts && 'HSTS', !mh.xcto && 'X-Content-Type-Options', !mh.xfo && 'X-Frame-Options'].filter(Boolean);
  if (missH.length === 3) add({ id: 'sec-headers', sev: 'alacsony', cat: 'Biztonság', title: 'Biztonsági HTTP-fejlécek hiányoznak', detail: missH.join(', '), fix: 'Fejlécek beállítása (a keményítés része).' });

  // ---- teljesítmény
  const lh = R.lighthouse;
  if (lh && !lh.error) {
    if (lh.totalKB > 4000) add({ id: 'page-weight', sev: 'közepes', cat: 'Teljesítmény', title: `Nehéz főoldal (${(lh.totalKB / 1024).toFixed(1)} MB)`, detail: lh.opportunities?.slice(0, 3).map(o => o.title).join('; '), fix: 'Képoptimalizálás (WebP/AVIF, átméretezés), lazy-load.', hours: H.imageOpt });
    if (lh.perf != null && lh.perf < 50) add({ id: 'lh-poor', sev: 'közepes', cat: 'Teljesítmény', title: `Gyenge ${lh.device === 'desktop' ? 'asztali' : 'mobil'} teljesítmény (Lighthouse ${lh.perf})`, detail: `LCP ${lh.lcp} s, TBT ${lh.tbt} ms, CLS ${lh.cls}`, fix: 'A fő javítási lehetőségek: ' + (lh.opportunities || []).map(o => o.title).slice(0, 3).join('; '), group: 'info' });
  }
  // aloldalak (sitemapből): gyenge teljesítményű oldalak egy tételben
  const weak = (R.lighthousePages || []).flatMap(p => ['mobile', 'desktop'].filter(k => p[k] && !p[k].error && p[k].perf != null && p[k].perf < 50).map(k => `${new URL(p.url).pathname} (${k === 'desktop' ? 'asztali' : 'mobil'}: ${p[k].perf})`));
  if (weak.length) add({ id: 'lh-poor-pages', sev: 'közepes', cat: 'Teljesítmény', title: `Gyenge teljesítményű aloldalak (${weak.length} mérés)`, detail: weak.join('; '), fix: 'Az aloldalak is lassúak, a javítás jellemzően közös (téma, képek, pluginok).', group: 'info' });
  if (!d.cache?.length && !R.server?.litespeed && (R.reach?.ttfb || 0) > 800) add({ id: 'no-cache', sev: 'közepes', cat: 'Teljesítmény', title: `Lassú szerverválasz (${R.reach.ttfb} ms), nincs látható gyorsítótár`, fix: 'Oldal-gyorsítótár beállítása (pl. LiteSpeed Cache / WP Rocket), objektum-cache vizsgálata.', hours: H.cacheSetup });

  // ---- teljes frissítés + onboarding (mindig)
  if (R.status === 'ok' || R.status === 'maintenance') {
    add({ id: 'onboarding', sev: 'info', cat: 'Alap', title: 'Onboarding', fix: 'Hozzáférések átvétele és auditja, staging-környezet, mentés és uptime-monitor, biztonsági alap, alapállapot-riport.', hours: H.onboarding, base: true });
    const up = majors.length ? H.updateRemainder : H['update' + R.tier];
    add({ id: 'full-update', sev: 'info', cat: 'Alap', title: majors.length ? 'Teljes frissítés (a fenti főverziókon túl)' : 'Teljes frissítés', fix: 'WP core, téma, pluginok és fordítások frissítése stagingen, teszt, élesítés.', hours: up, base: true });
  }

  // ---- GDPR (opcionális)
  gdprRules(R, H, add);
  // ---- SEO (opcionális)
  seoRules(R, H, add);
  geoRules(R, H, add);
  checkRules(R, H, add);
  return finalize(R, F);
}

function gdprRules(R, H, add) {
  const g = R.gdpr, st = R.gdprStatic || {}, d = R.detected || {};
  let cmpItem = false;
  const G = o => { if (['gdpr-no-cmp', 'gdpr-wall', 'gdpr-no-cmp-static', 'gdpr-old'].includes(o.id)) cmpItem = true; add({ group: 'gdpr', cat: 'GDPR', ...o }); };
  const cmps = R.detected?.cookieModern || [];
  const old = cmps.filter(c => !c.modern);
  let state = 'Rendben';
  const worse = s => { const o = ['Rendben', 'Hiányos', 'Nem megfelelő']; if (o.indexOf(s) > o.indexOf(state)) state = s; };
  const staticTrack = R.seo?.analytics && (R.seo.analytics.ga4.length || R.seo.analytics.ua.length || R.seo.analytics.gtm.length);
  if (g && !g.error) {
    if (!g.banner && !cmps.length) {
      if (g.preConsent.length || g.trackerCookies.length) { worse('Nem megfelelő'); G({ id: 'gdpr-no-cmp', sev: 'magas', title: 'Nincs süti-kezelő, a mérés hozzájárulás nélkül fut', detail: `Hozzájárulás előtt: ${[...g.preConsent, ...g.trackerCookies.map(c => c + ' süti')].join(', ')}`, fix: 'Consent-kezelő bevezetése egyenrangú Elfogadom / Elutasítom / Beállítások gombokkal, Google Consent Mode v2.', hours: H.gdprCmp }); }
      else { worse('Hiányos'); }
    } else if (!g.banner && cmps.length) { worse('Hiányos'); G({ id: 'gdpr-cmp-hidden', sev: 'közepes', title: `${cmps.map(c => c.name).join(' + ')} telepítve, de süti-sáv nem jelenik meg`, fix: 'A consent-kezelő beállításának befejezése (süti-scan, sáv, kategóriák).', hours: H.gdprCmpFix }); }
    else if (g.wall || old.length) { worse('Nem megfelelő'); G({ id: 'gdpr-wall', sev: 'magas', title: g.wall ? 'Süti-fal elutasítási lehetőség nélkül' : `Elavult süti-plugin: ${old.map(c => c.name).join(', ')}`, detail: g.text ? `„${g.text.slice(0, 120)}…”` : '', fix: 'Csere valódi consent-kezelőre (elutasítás, kategóriák, Consent Mode v2).', hours: H.gdprCmp }); }
    else if (g.banner && !g.reject) { worse('Hiányos'); G({ id: 'gdpr-no-reject', sev: 'közepes', title: 'A süti-sávon nincs egyenrangú elutasítás', detail: `Gombok: ${(g.buttons || []).join(' / ')}`, fix: 'Az „Elutasítom” gomb első rétegre helyezése.', hours: H.gdprCmpFix }); }
    if (cmps.length > 1) { worse('Hiányos'); G({ id: 'gdpr-dup', sev: 'közepes', title: `Több consent-plugin: ${cmps.map(c => c.name).join(' + ')}`, fix: 'Egy megoldásra konszolidálás.', hours: H.gdprDupCmp }); }
    if (g.banner && (g.preConsent.length || g.trackerCookies.length)) { worse('Nem megfelelő'); G({ id: 'gdpr-preconsent', sev: 'magas', title: 'Mérés / marketing hozzájárulás előtt', detail: [...g.preConsent, ...g.trackerCookies.map(c => c + ' süti')].join(', '), fix: 'Követőkódok betöltése csak hozzájárulás után (script blocking / Consent Mode), teszt üres böngészővel.', hours: H.gdprBlock }); }
    if (g.embeds.length) { worse('Hiányos'); G({ id: 'gdpr-embed', sev: 'közepes', title: 'Külső beágyazás hozzájárulás nélkül', detail: g.embeds.join(', '), fix: 'Google Maps / YouTube / reCAPTCHA hozzájárulás-függő betöltése helykitöltővel.', hours: H.gdprEmbed }); }
    if (g.fonts) G({ id: 'gdpr-fonts', sev: 'alacsony', title: 'Google Fonts külső szerverről', fix: 'Betűtípusok helyi kiszolgálása.', hours: H.gdprFonts });
    const usesGoogle = g.tagLoaded || g.preConsent.some(x => /Google/.test(x)) || staticTrack;
    if (usesGoogle && !g.consentMode && !cmpItem) G({ id: 'gdpr-cmv2', sev: 'közepes', title: 'Google Consent Mode v2 nem aktív', fix: 'Consent Mode v2 beállítása a consent-kezelőben / GTM-ben.', hours: H.gdprConsentMode });
  } else {
    // csak statikus jelek (böngészős mérés nélkül)
    if (!cmps.length && staticTrack) { worse('Nem megfelelő'); G({ id: 'gdpr-no-cmp-static', sev: 'magas', title: 'Mérőkód van, süti-kezelő nem látható', detail: 'Böngészős mérés nélkül – ellenőrizendő.', fix: 'Consent-kezelő bevezetése, Consent Mode v2.', hours: H.gdprCmp }); }
    if (old.length) { worse('Nem megfelelő'); G({ id: 'gdpr-old', sev: 'magas', title: `Elavult süti-plugin: ${old.map(c => c.name).join(', ')}`, fix: 'Csere valódi consent-kezelőre.', hours: H.gdprCmp }); }
    if (cmps.length > 1) { worse('Hiányos'); G({ id: 'gdpr-dup', sev: 'közepes', title: `Több consent-plugin: ${cmps.map(c => c.name).join(' + ')}`, fix: 'Konszolidálás.', hours: H.gdprDupCmp }); }
  }
  if (!st.privacy) { worse('Hiányos'); G({ id: 'gdpr-privacy', sev: 'közepes', title: 'A főoldalon nincs adatkezelési tájékoztató link', fix: 'Adatkezelési tájékoztató oldal és lábléc-link (a szöveget az ügyfél adja).', hours: H.gdprPrivacyPage }); }
  else if (st.privacyPdf) G({ id: 'gdpr-privacy-pdf', sev: 'alacsony', title: 'Adatkezelési tájékoztató csak PDF-ként', fix: 'HTML-oldalként is elérhetővé tétele.', hours: H.gdprPrivacyPage });
  if (st.privacyExternalHost?.length) { worse('Hiányos'); G({ id: 'gdpr-legal-host', sev: 'közepes', title: 'Jogi dokumentumok másik domainen', detail: st.privacyExternalHost.join(', '), fix: 'Áthelyezés a saját domainre (teszthoston tárolt fájlok kockázata).', hours: H.gdprPrivacyPage }); }
  if (!st.imprint) G({ id: 'gdpr-imprint', sev: 'alacsony', title: 'Impresszum-link nem található a főoldalon', detail: 'Ha a szolgáltatói adatok máshol teljes körűen szerepelnek, elhagyható.', fix: 'Impresszum oldal (az adatokat az ügyfél adja).', hours: H.gdprImprint });
  if ((cmps.length || g?.banner) && !st.cookiePolicy) G({ id: 'gdpr-cookie-policy', sev: 'alacsony', title: 'Süti-tájékoztató link nem található', fix: 'Süti-tájékoztató oldal a tényleges süti-lista alapján.', hours: H.gdprCookiePolicy });
  R.gdprState = g && !g.error ? state : (state === 'Rendben' ? 'Nem mért' : state + ' (statikus)');
}

function seoRules(R, H, add) {
  const s = R.seo; if (!s) return;
  const d = R.detected || {};
  const O = o => add({ group: 'seo', cat: 'SEO', ...o });
  if (s.noindex) add({ id: 'noindex', sev: 'kritikus', cat: 'SEO', title: 'Az oldal noindex – kimarad a Google-ből', detail: R.status === 'maintenance' ? 'Karbantartás módban szándékos lehet.' : '', fix: 'Indexelés engedélyezése (Beállítások → Olvasás, SEO-plugin).', hours: H.seoIndexFix });
  if (s.robotsTxt?.disallowAll) add({ id: 'robots-block', sev: 'kritikus', cat: 'SEO', title: 'A robots.txt minden keresőt kitilt', fix: 'robots.txt javítása.', hours: H.seoIndexFix });
  const issues = [];
  if (!s.desc) issues.push('nincs meta description');
  if (s.titleLen < 15 || s.titleLen > 70) issues.push(`title hossza ${s.titleLen} karakter`);
  if (!s.og) issues.push('nincs Open Graph');
  if (!s.canonical) issues.push('nincs canonical');
  if (!d.seo?.length) O({ id: 'seo-plugin', sev: 'közepes', title: 'Nincs SEO-bővítmény', detail: issues.join('; '), fix: 'SEO-plugin telepítése és beállítása: title-sablon, meta description, OG, sitemap.', hours: H.seoPlugin });
  else if (issues.length >= 2) O({ id: 'seo-config', sev: 'közepes', title: `${d.seo.join(', ')} telepítve, de hiányos beállítás`, detail: issues.join('; '), fix: 'A SEO-plugin beállítása: title-sablon, meta description, OG.', hours: H.seoConfigure });
  else if (issues.length) O({ id: 'seo-review', sev: 'alacsony', title: 'SEO-beállítások átnézése', detail: issues.join('; '), fix: 'Hiányzó meta és OG pótlása.', hours: H.seoReview });
  const a = s.analytics || {};
  if (a.ua.length && !a.ga4.length) O({ id: 'ga-ua', sev: 'közepes', title: 'Csak a megszűnt Universal Analytics fut', detail: a.ua.join(', '), fix: 'GA4 bevezetése, a régi kód eltávolítása.', hours: H.seoGa4 });
  else if (!a.ga4.length && !a.gtm.length && !a.siteKit && !a.monsterInsights) O({ id: 'ga-none', sev: 'alacsony', title: 'Nem látható látogatottságmérés', fix: 'GA4 bevezetése (a hozzájárulás-kezelésre építve).', hours: H.seoGa4 });
  else if (a.gtagLoads > 1 || (a.ua.length && a.ga4.length)) O({ id: 'ga-dup', sev: 'alacsony', title: 'Duplikált vagy vegyes mérőkód', detail: [a.gtagLoads > 1 ? `${a.gtagLoads}× gtag.js` : '', a.ua.length ? 'UA + GA4' : ''].filter(Boolean).join('; '), fix: 'Mérőkódok egységesítése.', hours: H.seoGa4 / 3 });
  if (s.h1 !== 1) O({ id: 'h1', sev: 'alacsony', title: s.h1 === 0 ? 'Nincs H1 a főoldalon' : `${s.h1} db H1 a főoldalon`, fix: 'Heading-hierarchia javítása.', hours: H.seoH1 });
  if (!s.sitemap?.ok) O({ id: 'sitemap', sev: 'közepes', title: s.sitemap ? `A robots.txt-ben hirdetett sitemap hibás (${s.sitemap.status})` : 'Nem található működő XML sitemap', fix: 'Sitemap helyreállítása, robots.txt és Search Console frissítése.', hours: H.seoSitemap });
  if (s.imgCount >= 8 && s.imgNoAlt / s.imgCount > 0.4) add({ id: 'alt', group: 'tartalom', cat: 'Tartalom', sev: 'alacsony', title: `${s.imgNoAlt}/${s.imgCount} kép alt szöveg nélkül (főoldal)`, fix: 'Alt szövegek pótlása (akadálymentesség, képkeresés).', hours: H.contentAlt });
}

// GEO-megállapítások (a geo.mjs adja a tartalmat és az óraszám-kulcsot); az opcionális SEO-csoportba kerülnek
function geoRules(R, H, add) {
  const g = R.geo; if (!g || g.error) return;
  for (const f of g.findings || []) add({ id: f.id, sev: f.sev, cat: f.id.startsWith('seo-') ? 'SEO' : 'GEO', title: f.title, detail: f.detail, fix: f.fix, hours: H[f.hoursKey] ?? 0, group: 'seo' });
}

// akadálymentesség, törött linkek, e-mail hitelesítés, domain-lejárat, sebezhetőségek, valós felhasználói adatok
function checkRules(R, H, add) {
  const a = R.a11y;
  if (a && !a.error && (a.counts.critical || a.counts.serious)) {
    const worst = a.violations.filter(v => ['critical', 'serious'].includes(v.impact)).slice(0, 4);
    add({ id: 'a11y', sev: a.counts.critical ? 'magas' : 'közepes', cat: 'Akadálymentesség', title: `Akadálymentességi hibák: ${a.counts.critical} kritikus, ${a.counts.serious} súlyos szabálysértés`, detail: worst.map(v => `${v.helpHu} (${v.count} elem${v.wcag?.length ? ', WCAG ' + v.wcag.join(', ') : ''})`).join('; '), fix: worst.map(v => v.fixHu).filter(Boolean).slice(0, 3).join(' ') || 'A főbb szabálysértések javítása (színkontraszt, alt szövegek, címkék).', group: 'tartalom', hours: H.a11yFix });
  }
  const as = R.a11yAll;
  if (as && as.checked && as.pagesWithSevere > 0) {
    const top = as.rules.filter(r => ['critical', 'serious'].includes(r.impact)).slice(0, 4);
    add({ id: 'a11y-site', sev: as.counts.critical ? 'magas' : 'közepes', cat: 'Akadálymentesség', title: `Akadálymentességi hibák a teljes sitemapen: ${as.pagesWithSevere} / ${as.checked} vizsgált oldalon kritikus vagy súlyos hiba`, detail: top.map(r => `${r.helpHu} (${r.pages} oldal${r.wcag?.length ? ', WCAG ' + r.wcag.join(', ') : ''})`).join('; '), fix: 'A hibák többsége sablon- vagy komponens-szintű, ezért egy javítás sok oldalt rendbe tesz: a témában és az oldalépítő elemeiben érdemes kezdeni (kontraszt, linkek és gombok neve, ARIA).', group: 'tartalom', hours: H.a11ySite });
  }
  const l = R.links;
  if (l && !l.error) {
    if (l.brokenInternal.length) add({ id: 'links-internal', sev: 'közepes', cat: 'Linkek', title: `${l.brokenInternal.length} törött belső link`, detail: l.brokenInternal.slice(0, 4).map(x => `${x.url} (${x.status || x.error})`).join('; '), fix: 'A hivatkozások javítása vagy átirányítás (301) beállítása az új címre.', group: 'tartalom', hours: H.linkFix });
    if (l.brokenExternal.length) add({ id: 'links-external', sev: 'alacsony', cat: 'Linkek', title: `${l.brokenExternal.length} törött külső link`, detail: l.brokenExternal.slice(0, 4).map(x => `${x.url} (${x.status || x.error})`).join('; '), fix: 'A külső hivatkozások frissítése vagy eltávolítása.', group: 'tartalom', hours: H.linkExtFix });
    if (l.redirectChains.length >= 3) add({ id: 'links-chains', sev: 'alacsony', cat: 'Linkek', title: `${l.redirectChains.length} hosszú átirányítási lánc`, detail: l.redirectChains.slice(0, 3).map(x => `${x.url} (${x.hops} átirányítás)`).join('; '), fix: 'A belső hivatkozások a végleges címre mutassanak.', group: 'tartalom', hours: 0 });
  }
  const w = R.w3c;
  if (w && !w.error && !w.skipped && w.totals.errors > 0) {
    const top = w.pages.flatMap(p => p.top).filter(t => t.type === 'error' && t.hint).map(t => t.hint);
    add({ id: 'w3c', sev: w.totals.errors / Math.max(1, w.totals.pages) >= 10 ? 'közepes' : 'alacsony', cat: 'HTML', title: `HTML-hibák a W3C-validátor szerint: ${w.totals.errors} hiba, ${w.totals.warnings} figyelmeztetés (${w.totals.pages} oldalon)`, detail: [...new Set(top)].slice(0, 3).join(' · ') || w.pages.flatMap(p => p.top)[0]?.message || '', fix: 'A hibák többsége a témából és a pluginokból jön, ezért oldalanként ismétlődik: a sablon és az oldalépítő kimenetének javítása, a felesleges elemek eltávolítása. A legtöbb hiba nem okoz látható problémát, de a böngészők eltérően kezelhetik.', group: 'tartalom', hours: H.w3cFix });
  }
  for (const i of R.mail?.issues || []) add({ id: 'mail-' + i.id, sev: i.sev, cat: 'E-mail', title: i.title, detail: i.detail, fix: i.fix, group: 'domain', hours: /missing|multiple|weak/.test(i.id) ? H.mailFix : H.mailTune });
  const de = R.domainExp;
  if (de && de.daysLeft != null && de.daysLeft < 90) add({ id: 'domain-expiry', sev: de.daysLeft < 30 ? 'magas' : 'alacsony', cat: 'Domain', title: de.daysLeft < 0 ? 'A domain lejárt' : `A domain ${de.daysLeft} nap múlva lejár (${de.expires})`, detail: de.registrar ? `Regisztrátor: ${de.registrar}` : '', fix: 'A domain megújítása, automatikus megújítás bekapcsolása.', group: 'domain', hours: H.domainRenew });
  for (const [i, v] of (R.vulns?.items || []).slice(0, 15).entries()) add({ id: `vuln-${v.slug}-${i}`, sev: v.severity, cat: 'Sebezhetőség', title: `Ismert sebezhetőség: ${v.name} ${v.version}`, detail: [v.title, v.cve?.join(', '), v.fixedIn ? `javítva: ${v.fixedIn}` : v.fixedAfter ? `javítva a(z) ${v.fixedAfter} utáni verzióban` : 'nincs javított verzió'].filter(Boolean).join(' · '), fix: v.fixedIn ? `Frissítés a ${v.fixedIn} vagy újabb verzióra.` : v.fixedAfter ? `Frissítés a(z) ${v.fixedAfter} utáni (legújabb) verzióra.` : 'Nincs javított verzió: a bővítmény cseréje vagy eltávolítása javasolt.', group: 'kotelezo', hours: H.vulnFix });
  const cx = R.crux?.phone;
  if (cx && !cx.error) {
    const bad = [cx.lcp?.p75 > 4000 && `LCP ${(cx.lcp.p75 / 1000).toFixed(1)} s`, cx.inp?.p75 > 500 && `INP ${cx.inp.p75} ms`, cx.cls?.p75 > 0.25 && `CLS ${cx.cls.p75}`].filter(Boolean);
    if (bad.length) add({ id: 'crux-poor', sev: 'közepes', cat: 'Teljesítmény', title: 'A valós látogatók (mobil) tapasztalata gyenge', detail: bad.join(', ') + ' (a látogatók 75%-ánál)', fix: 'A Lighthouse-javaslatok (képek, JavaScript, szerverválasz) a valós látogatóknak is javítanak.', group: 'info' });
  }
}

function finalize(R, F) {
  F.sort((a, b) => (a.base ? 1 : 0) - (b.base ? 1 : 0) || SEV_ORDER[a.sev] - SEV_ORDER[b.sev]);
  const sum = g => +F.filter(f => f.group === g).reduce((a, f) => a + (f.hours || 0), 0).toFixed(2);
  R.findings = F;
  R.totals = { kotelezo: sum('kotelezo'), gdpr: sum('gdpr'), seo: sum('seo'), tartalom: sum('tartalom') + sum('domain') };
  R.flags = { hacked: F.some(f => f.id === 'hacked'), critical: F.filter(f => f.sev === 'kritikus').length, high: F.filter(f => f.sev === 'magas').length };
  R.priority = R.flags.hacked ? 0 : R.flags.critical ? 1 : R.flags.high ? 2 : 3;
  return R;
}
