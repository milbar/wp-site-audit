// Böngészős mérések: GDPR / süti (első látogatás, interakció nélkül) és Lighthouse.
// A gépen telepített Chrome-ot / Edge-et használja (chrome-launcher), külön Chromium-letöltés nélkül.
import * as chromeLauncher from 'chrome-launcher';
import puppeteer from 'puppeteer-core';
import lighthouse from 'lighthouse';
import fs from 'node:fs';
import { TRACKERS, TRACKER_COOKIES, TRACKER_KIND } from './signatures.mjs';
import { UA } from './http.mjs';
import { startGuardProxy } from './guard-proxy.mjs';

const EDGE_WIN = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];

export function findChrome() {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
  try { const p = chromeLauncher.Launcher.getFirstInstallation(); if (p) return p; } catch {}
  return EDGE_WIN.find(p => fs.existsSync(p)) || null;
}

// blockPrivate: szerver módban a Chrome forgalma egy szűrő-proxyn megy át, így a böngésző sem érheti el a belső hálózatot
export async function startBrowser({ blockPrivate = false } = {}) {
  const chromePath = findChrome();
  if (!chromePath) throw new Error('Nem található Chrome vagy Edge. Telepítsd a Google Chrome-ot, vagy add meg a CHROME_PATH környezeti változót.');
  const proxy = blockPrivate ? await startGuardProxy() : null;
  const flags = ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-extensions', ...(process.platform === 'linux' ? ['--no-sandbox'] : []),
    ...(proxy ? [`--proxy-server=http://127.0.0.1:${proxy.port}`, '--proxy-bypass-list=<-loopback>'] : []),
    ...(process.env.CHROME_FLAGS ? process.env.CHROME_FLAGS.split(/\s+/).filter(Boolean) : [])];
  const self = { chromePath, proxyPort: proxy?.port || null, port: 0, browser: null, chrome: null };
  const launch = async () => {
    self.chrome = await chromeLauncher.launch({ chromePath, chromeFlags: flags });
    self.port = self.chrome.port;
    self.browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${self.chrome.port}`, defaultViewport: null });
  };
  const stop = async () => { try { await self.browser?.disconnect(); } catch {} try { await self.chrome?.kill(); } catch {} };
  await launch();
  // időtúllépés után a lógó Lighthouse-futás nem zavarhatja a következőt: új Chrome-ot indítunk
  self.restart = async () => { await stop(); await launch(); };
  // a leállás időkorlátos: egy elakadt Chrome vagy proxy nem tarthat fogva egy felmérést
  const bounded = (p, ms) => Promise.race([p, new Promise(r => setTimeout(r, ms))]);
  self.close = async () => { await bounded(stop(), 10000); try { if (self.chrome?.pid) process.kill(self.chrome.pid, 'SIGKILL'); } catch {} try { await bounded(proxy?.close() ?? Promise.resolve(), 5000); } catch {} };
  return self;
}

// Banner-felismerés a lapon belül (shadow DOM-mal együtt)
const BANNER_JS = () => {
  const vis = el => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && r.width > 40 && r.height > 20; };
  const roots = [document];
  document.querySelectorAll('*').forEach(e => { if (e.shadowRoot) roots.push(e.shadowRoot); });
  const cands = [];
  for (const root of roots) root.querySelectorAll('div,section,aside,dialog,form,footer').forEach(el => {
    const s = getComputedStyle(el); const t = (el.innerText || '').trim();
    if ((s.position === 'fixed' || s.position === 'sticky' || el.tagName === 'DIALOG' || +s.zIndex > 999) && vis(el) && /süti|sütik|cookie|adatvédelm|hozzájárul|consent/i.test(t) && t.length < 4000) cands.push(el);
  });
  const b = cands.sort((a, c) => (c.innerText || '').length - (a.innerText || '').length)[0];
  const R = { banner: !!b };
  if (b) {
    const btns = [...b.querySelectorAll('button,a,[role=button],input[type=button],input[type=submit]')].filter(vis).map(x => (x.innerText || x.value || x.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ')).filter(Boolean);
    R.buttons = [...new Set(btns)].slice(0, 8);
    R.reject = btns.some(t => /elutas|elvet|csak a (szüks|szuks|szükséges)|nem fogad|megtagad|reject|decline|deny|refuse|only necessary|necessary only|csak szükséges/i.test(t));
    R.settings = btns.some(t => /beállít|testreszab|preferenc|settings|customi|kezel|részletek|kiválaszt/i.test(t));
    R.text = (b.innerText || '').replace(/\s+/g, ' ').slice(0, 220);
    R.wall = /további használatához|el kell fogadni|használatával elfogad|by continuing|by using this site/i.test(R.text) && !R.reject;
    const r = b.getBoundingClientRect(); R.coverage = Math.round(100 * (r.width * r.height) / (innerWidth * innerHeight));
  }
  try { R.consentDefault = Array.isArray(window.dataLayer) && window.dataLayer.some(e => e && e[0] === 'consent' && e[1] === 'default'); } catch { R.consentDefault = false; }
  try { R.googleIcs = !!(window.google_tag_data && window.google_tag_data.ics && window.google_tag_data.ics.entries && Object.keys(window.google_tag_data.ics.entries).length); } catch {}
  return R;
};

export async function gdprCheck(browser, url, { screenshotPath, waitMs = 6000, timeout = 35000 } = {}) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  const reqs = [];
  try {
    await page.setUserAgent(UA);
    await page.setViewport({ width: 1366, height: 860 });
    page.on('request', r => reqs.push(r.url()));
    let navErr = null;
    try { await page.goto(url, { waitUntil: 'domcontentloaded', timeout }); } catch (e) { navErr = e.message; }
    await new Promise(r => setTimeout(r, waitMs));
    const dom = await page.evaluate(BANNER_JS).catch(e => ({ error: e.message }));
    const cdp = await page.createCDPSession();
    const { cookies } = await cdp.send('Network.getAllCookies');
    const trackers = {};
    for (const [name, rx] of Object.entries(TRACKERS)) { const n = reqs.filter(u => rx.test(u)).length; if (n) trackers[name] = n; }
    const preConsent = Object.keys(trackers).filter(k => ['analytics', 'marketing'].includes(TRACKER_KIND[k]));
    const embeds = Object.keys(trackers).filter(k => TRACKER_KIND[k] === 'embed');
    const trackerCookies = [...new Set(cookies.map(c => c.name).filter(n => TRACKER_COOKIES.test(n)))];
    if (screenshotPath) await page.screenshot({ path: screenshotPath, type: 'jpeg', quality: 55 }).catch(() => {});
    return { url, navErr, ...dom, trackers, preConsent, embeds, fonts: !!trackers['Google Fonts'], tagLoaded: !!trackers['Google Tag Manager / gtag'], trackerCookies, cookieCount: cookies.length, consentMode: !!(dom.consentDefault || dom.googleIcs) };
  } finally { await ctx.close().catch(() => {}); }
}

// Bot-védelmi köztes oldal (Cloudflare, „One moment, please…”, „Kis türelmet…”): ilyenre a Lighthouse hamis, kiváló pontot adna
import { CHALLENGE_RE } from './challenge.mjs';
export async function detectChallenge(browser, url, waitMs = 8000) {
  const ctx = await browser.createBrowserContext();
  try {
    const page = await ctx.newPage();
    const resp = await page.goto(url, { waitUntil: 'load', timeout: 30000 }).catch(() => null);
    const t0 = Date.now(); let title = await page.title().catch(() => '');
    while (CHALLENGE_RE.test(title) && Date.now() - t0 < waitMs) { await new Promise(r => setTimeout(r, 1000)); title = await page.title().catch(() => ''); }
    if (CHALLENGE_RE.test(title)) return `bot-védelmi oldal („${title.slice(0, 40)}”)`;
    if (resp && [403, 429, 503].includes(resp.status())) return `HTTP ${resp.status()} válasz`;
    return null;
  } finally { await ctx.close().catch(() => {}); }
}

export async function runLighthouse(port, url, { device = 'mobile', timeoutMs = 120000 } = {}) {
  const flags = { port, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], locale: 'hu', maxWaitForLoad: 45000 };
  const config = device === 'desktop' ? (await import('lighthouse/core/config/desktop-config.js')).default : undefined;
  const job = lighthouse(url, flags, config);
  const res = await Promise.race([job, new Promise((_, rej) => setTimeout(() => rej(new Error('Lighthouse időtúllépés')), timeoutMs))]);
  const lhr = res?.lhr; if (!lhr) throw new Error('Lighthouse: nincs eredmény');
  if (lhr.runtimeError) throw new Error('Lighthouse: ' + lhr.runtimeError.message);
  const bytes = lhr.audits['total-byte-weight']?.numericValue;
  if (bytes != null && bytes < 30_000) throw new Error(`Gyanús mérés: az oldal mindössze ${Math.round(bytes / 1024)} KB (valószínűleg bot-védelmi vagy hibaoldal)`);
  const sc = k => lhr.categories[k]?.score == null ? null : Math.round(lhr.categories[k].score * 100);
  const nv = k => lhr.audits[k]?.numericValue ?? null;
  const shot = lhr.audits['final-screenshot']?.details?.data || null;
  const opp = Object.values(lhr.audits).filter(a => a.details?.type === 'opportunity' && (a.details.overallSavingsMs || 0) > 300).sort((a, b) => b.details.overallSavingsMs - a.details.overallSavingsMs).slice(0, 5).map(a => ({ id: a.id, title: a.title, savingsMs: Math.round(a.details.overallSavingsMs) }));
  return {
    device, perf: sc('performance'), a11y: sc('accessibility'), bp: sc('best-practices'), seo: sc('seo'),
    lcp: nv('largest-contentful-paint') && +(nv('largest-contentful-paint') / 1000).toFixed(1), cls: nv('cumulative-layout-shift') != null ? +nv('cumulative-layout-shift').toFixed(3) : null,
    tbt: nv('total-blocking-time') && Math.round(nv('total-blocking-time')), fcp: nv('first-contentful-paint') && +(nv('first-contentful-paint') / 1000).toFixed(1),
    totalKB: nv('total-byte-weight') && Math.round(nv('total-byte-weight') / 1024), serverMs: nv('server-response-time') && Math.round(nv('server-response-time')),
    opportunities: opp, screenshot: shot,
  };
}
