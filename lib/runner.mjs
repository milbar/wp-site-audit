// Futtatás: HTTP-felmérés párhuzamosan, böngészős mérések (GDPR, akadálymentesség, Lighthouse) a helyi Chrome-mal vagy távoli munkásokkal,
// eseményekkel a felület felé
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { probeSite } from './probe.mjs';
import { analyze } from './rules.mjs';
import { startBrowser } from './browser.mjs';
import { runBrowserJob } from './browser-job.mjs';
import { pickSitemapUrls, listSitemapUrls } from './sitemap.mjs';
import { aggregateA11y } from './a11y.mjs';
import { geoScan } from './geo.mjs';
import { aiSummary } from './ai.mjs';
import { compareResults } from './compare.mjs';
import { linkCheck } from './links.mjs';
import { w3cCheck } from './w3c.mjs';
import { mailCheck, domainExpiry } from './dnsmail.mjs';
import { collectVulns, vulnsEnabled, createVulnCache } from './vulns.mjs';
import { cruxLookup, cruxEnabled } from './crux.mjs';
import { aiSuggest, buildSolutions } from './suggest.mjs';

export class Run extends EventEmitter {
  // restored: egy korábban megszakadt felmérés mentett állapota (a kész domainek eredménye megmarad)
  // pool: távoli böngésző-munkások készlete (ha van és van szabad munkás, a helyi Chrome nem indul el)
  constructor({ id, dir, domains, options, client, wporg, settings, restored, previousFor, clients = {}, owner = null, pool = null }) {
    super();
    Object.assign(this, { id, dir, client, wporg, settings, previousFor, pool });
    this.data = restored ? Object.assign(restored, { resumed: (restored.resumed || 0) + 1 }) : { id, createdAt: new Date().toISOString(), owner, options, domains, sites: Object.fromEntries(domains.map(d => [d, { domain: d, state: 'queued', step: '', ...(clients[d] ? { client: clients[d] } : {}) }])), finished: false };
    fs.mkdirSync(dir, { recursive: true });
    this.cancelled = false;
    this.aiChain = Promise.resolve();
  }
  save() { fs.writeFileSync(path.join(this.dir, 'run.json'), JSON.stringify(this.data)); }
  update(d, patch) { Object.assign(this.data.sites[d], patch); this.emit('site', this.data.sites[d]); }
  log(msg) { this.emit('log', { t: Date.now(), msg }); }

  async start() {
    const o = this.data.options;
    this.save();
    const needBrowser = o.gdpr || o.lighthouse || o.a11y;
    let br = null;
    const remote = needBrowser && this.pool && this.pool.enabled() ? this.pool : null;
    if (remote) { await remote.refresh(); }
    const useRemote = !!(remote && remote.size() > 0);
    if (needBrowser && !useRemote) {
      try { br = await startBrowser({ blockPrivate: !!this.client.blockPrivate }); this.log(`Böngésző: ${br.chromePath}${br.proxyPort ? ' (szűrő-proxyval)' : ''}`); }
      catch (e) { this.log('Böngészős mérés kihagyva: ' + e.message); this.data.browserError = e.message; }
    } else if (useRemote) this.log(`Böngészős mérések: ${remote.size()} távoli munkás`);
    const canBrowse = useRemote || !!br;

    // a böngészős feladatok egyszerre legfeljebb ennyi munkáson futnak (helyi Chrome-nál 1)
    const slots = useRemote ? Math.max(1, remote.size()) : 1;
    let free = slots; const waiters = [];
    const acquire = () => (free > 0 ? (free--, Promise.resolve()) : new Promise(r => waiters.push(r)));
    const release = () => { const w = waiters.shift(); if (w) w(); else free++; };
    const browserQueue = [];
    const browserTask = d => (async () => { await acquire(); try { await this.browserSteps(d, br, useRemote ? remote : null); } catch (e) { this.log(`${d}: ${e.message}`); } finally { release(); } })();

    // a már lezárt (kész / hibás) domainek kimaradnak; a félbehagyottak előről indulnak
    const todo = this.data.domains.filter(d => !['done', 'failed'].includes(this.data.sites[d].state));
    for (const d of todo) { const old = this.data.sites[d]; this.data.sites[d] = { domain: d, state: 'queued', step: '', ...(old.client ? { client: old.client } : {}) }; }
    if (this.data.resumed) this.log(`Folytatás megszakadás után: ${todo.length} domain hátra van`);
    let i = 0;
    const workers = Array.from({ length: Math.max(1, Math.min(o.concurrency || 4, 8)) }, async () => {
      while (i < todo.length && !this.cancelled) {
        const d = todo[i++];
        this.update(d, { state: 'probing', step: 'indul' });
        try {
          const R = await probeSite(d, { client: this.client, wporg: this.wporg, spamScan: o.spam !== false, log: step => this.update(d, { step }) });
          this.data.sites[d].result = R;
          if (o.geo && ['ok', 'maintenance'].includes(R.status)) {
            try { R.geo = await geoScan(this.client, new URL(R.reach.finalUrl || `https://${d}/`).hostname, { homeUrl: R.reach.finalUrl || `https://${d}/`, sitemapUrl: R.seo?.sitemap?.ok ? R.seo.sitemap.url : null, maxPages: Math.max(1, Math.min(50, +o.geoPages || 30)), log: step => this.update(d, { step }) }); }
            catch (e) { R.geo = { error: e.message }; }
          }
          // törött linkek (a GEO-bejárás linkjein), e-mail hitelesítés, domain-lejárat, ismert sebezhetőségek, valós látogatói adatok
          if (o.links && R.geo && !R.geo.error && R.geo.linkSet) { this.update(d, { step: 'Linkek ellenőrzése' }); try { R.links = await linkCheck(this.client, R.geo.linkSet); } catch (e) { R.links = { error: e.message }; } }
          if (o.w3c && ['ok', 'maintenance'].includes(R.status)) { this.update(d, { step: 'W3C HTML-validálás' }); try { R.w3c = await w3cCheck(this.client, R, d); } catch (e) { R.w3c = { error: e.message }; } }
          if (o.dns !== false && R.status !== 'down') { this.update(d, { step: 'DNS, e-mail hitelesítés, domain-lejárat' }); try { R.mail = await mailCheck(d); } catch (e) { R.mail = { error: e.message, issues: [] }; } try { R.domainExp = await domainExpiry(this.client, d); } catch (e) { R.domainExp = { error: e.message }; } }
          if (vulnsEnabled() && R.wp?.isWp && ['ok', 'maintenance'].includes(R.status)) { this.update(d, { step: 'Ismert sebezhetőségek' }); try { this.vulnCache ||= createVulnCache(path.join(this.dir, '..', '..', 'vuln-cache.json')); R.vulns = await collectVulns(this.client, R, { cache: this.vulnCache }); } catch (e) { R.vulns = { error: e.message }; } }
          if (cruxEnabled() && R.status === 'ok') { try { R.crux = await cruxLookup(this.client, new URL(R.reach.finalUrl || `https://${d}/`).origin); } catch (e) { R.crux = { error: e.message }; } }
          if (canBrowse && ['ok', 'maintenance', 'error', 'not-wp'].includes(R.status)) { this.update(d, { state: 'waiting-browser', step: 'böngészőre vár' }); browserQueue.push(browserTask(d)); }
          else this.finishSite(d);
        } catch (e) {
          this.update(d, { state: 'failed', step: e.message });
          this.save();
        }
      }
    });
    await Promise.all(workers);
    await Promise.all(browserQueue);
    await this.aiChain;
    if (br) await br.close();
    this.data.finished = true; this.data.finishedAt = new Date().toISOString();
    this.save();
    this.emit('done', { id: this.id });
  }

  async browserSteps(d, br, pool) {
    if (this.cancelled) return this.finishSite(d);
    const R = this.data.sites[d].result;
    const url = R.reach.finalUrl || `https://${d}/`;
    const o = this.data.options;

    // az aloldalakat (sitemap) a koordinátor választja ki HTTP-vel; a böngészős mérést a feladat végzi
    let pageUrls = [];
    const nPages = Math.max(0, Math.min(10, +o.pages || 0));
    if (o.lighthouse && nPages && !['error', 'maintenance'].includes(R.status)) {
      try { pageUrls = await pickSitemapUrls(this.client, new URL(url).hostname, { sitemapUrl: R.seo?.sitemap?.ok ? R.seo.sitemap.url : null, homeUrl: url, limit: nPages }); }
      catch (e) { this.log(`${d}: sitemap-olvasás sikertelen: ${e.message}`); }
      if (!pageUrls.length) { R.lighthousePagesNote = 'Nem sikerült aloldalt választani: a sitemap nem olvasható (hiányzik, vagy bot-védelem blokkolja).'; this.log(`${d}: ${R.lighthousePagesNote}`); }
    }
    const a11yUrls = o.a11y ? (R.geo?.pages || []).filter(p => !p.failed && p.url !== url).slice(0, 2).map(p => p.url) : [];
    const job = { domain: d, url, status: R.status, options: { gdpr: !!o.gdpr, a11y: !!o.a11y, lighthouse: !!o.lighthouse, device: o.device }, pageUrls, a11yUrls };
    this.update(d, { state: 'browser', step: 'böngészős mérések' });
    const onStep = step => this.update(d, { step });
    let out = {};
    // „teljes sitemap” akadálymentesség: az oldalak köteg-feladatokra bontva, több munkáson párhuzamosan
    let siteA11y = null;
    if (o.a11y && o.a11yAll && ['ok', 'maintenance', 'not-wp'].includes(R.status)) {
      try {
        const max = Math.max(5, Math.min(300, +o.a11yMax || 100));
        this.update(d, { step: 'Sitemap beolvasása (akadálymentesség)' });
        const list = await listSitemapUrls(this.client, new URL(url).hostname, { sitemapUrl: R.seo?.sitemap?.ok ? R.seo.sitemap.url : null, homeUrl: url, max });
        if (!list.urls.length) R.a11yAllNote = 'A teljes sitemap-vizsgálat nem futott: a sitemap nem olvasható (hiányzik, vagy bot-védelem blokkolja).';
        else {
          const chunks = []; const size = 10; for (let i = 0; i < list.urls.length; i += size) chunks.push(list.urls.slice(i, i + size));
          let done = 0; const pages = [];
          const conc = pool ? Math.max(1, pool.size()) : 1;
          const runChunk = async ch => {
            const j = { domain: d, url, status: R.status, options: { a11yBatch: true }, a11yUrls: ch };
            try { const r = pool ? await pool.run(j, {}) : await runBrowserJob(br, j, { shouldStop: () => this.cancelled }); pages.push(...(r.a11yPages || [])); }
            catch (e) { pages.push(...ch.map(u => ({ url: u, error: e.message }))); }
            done += ch.length; this.update(d, { step: `Akadálymentesség: ${done} / ${list.urls.length} oldal` });
          };
          let next = 0;
          await Promise.all(Array.from({ length: conc }, async () => { while (next < chunks.length && !this.cancelled) await runChunk(chunks[next++]); }));
          siteA11y = aggregateA11y(pages, { total: list.total, truncated: list.truncated });
        }
      } catch (e) { R.a11yAllNote = 'A teljes sitemap-vizsgálat sikertelen: ' + e.message; }
    }
    try {
      out = pool ? await pool.run(job, { onStep }) : await runBrowserJob(br, job, { onStep, log: m => this.log(`${d}: ${m}`), shouldStop: () => this.cancelled });
    } catch (e) { this.log(`${d}: a böngészős mérés sikertelen: ${e.message}`); R.browserError = e.message; }
    const { screenshot, ...rest } = out;
    Object.assign(R, rest);
    if (siteA11y) R.a11yAll = siteA11y;
    if (screenshot) { try { fs.writeFileSync(path.join(this.dir, `${d}.jpg`), screenshot); R.screenshot = `${d}.jpg`; } catch (e) { this.log(`${d}: a képernyőkép mentése sikertelen: ${e.message}`); } }
    this.finishSite(d);
  }

  finishSite(d) {
    const s = this.data.sites[d];
    if (s.result) analyze(s.result, this.settings);
    if (s.result && this.previousFor) { try { const pv = this.previousFor(d); if (pv) s.result.compare = compareResults(s.result, pv.result, { runId: pv.runId, date: pv.date }); } catch (e) { this.log(`${d}: összehasonlítás sikertelen: ${e.message}`); } }
    if (s.result) { try { s.result.solutions = buildSolutions(s.result, d); } catch (e) { this.log(`${d}: megoldás-vázlatok sikertelenek: ${e.message}`); } }
    const o = this.data.options;
    if ((o.ai || o.suggest) && s.result && !this.cancelled) {
      // a helyi modell CPU-n fut, ezért az MI-feladatok egymás után készülnek
      this.update(d, { state: 'ai', step: 'MI-összefoglaló' });
      this.aiChain = this.aiChain.then(async () => {
        if (o.ai) { try { s.result.aiSummary = await aiSummary(s.result, d); } catch (e) { s.result.aiSummary = { error: e.message }; } }
        if (o.suggest) { try { s.result.aiSuggest = await aiSuggest(s.result, d, { maxPages: Math.max(1, Math.min(25, +o.suggestPages || 10)), onStep: step => this.update(d, { step }) }); } catch (e) { s.result.aiSuggest = { error: e.message }; } }
        this.update(d, { state: 'done', step: '' });
        this.save();
      });
      return;
    }
    this.update(d, { state: 'done', step: '' });
    this.save();
  }
  // beállítás-változás után újraértékelés (mérés nélkül)
  reanalyze(settings) { this.settings = settings; for (const s of Object.values(this.data.sites)) if (s.result) analyze(s.result, settings); this.save(); }
}
