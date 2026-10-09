// Egy domain böngészős mérései (GDPR / süti, akadálymentesség, Lighthouse + aloldalak) egyetlen feladatként.
// Ugyanezt futtatja a helyi Chrome vagy egy távoli munkás-konténer; az eredmény JSON-ba alakítható (a képernyőkép Buffer).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { gdprCheck, runLighthouse, detectChallenge } from './browser.mjs';
import { a11yCheck } from './a11y.mjs';
import { pa11yScan } from './pa11y.mjs';
import { sleep } from './http.mjs';

const BROWSER_PAUSE_MS = +(process.env.BROWSER_PAUSE_MS ?? 3000);

// job: { domain, url, status, options: { gdpr, a11y, lighthouse, device }, pageUrls: [] }
export async function runBrowserJob(br, job, { onStep = () => {}, log = () => {}, shouldStop = () => false } = {}) {
  const out = {};
  const { url, status, options: o = {}, pageUrls = [] } = job;
  // kötegelt mód: csak a megadott oldalak akadálymentessége (a „teljes sitemap” mérés szétosztható több munkásra)
  if (o.a11yBatch) {
    const urls = job.a11yUrls || [];
    out.a11yPages = [];
    if (shouldStop() || !urls.length) return out;
    onStep(`Akadálymentesség (pa11y-ci): ${urls.length} oldal`);
    try { out.a11yPages = await pa11yScan(urls, { chromePath: br.chromePath, guarded: !!br.proxyPort }); }
    catch (e) { out.a11yPages = urls.map(u => ({ url: u, error: e.message })); }
    onStep(`Akadálymentesség: ${out.a11yPages.length} / ${urls.length}`);
    return out;
  }
  if (o.gdpr) {
    onStep('GDPR / süti-mérés');
    const tmp = path.join(os.tmpdir(), `wpa-${crypto.randomBytes(6).toString('hex')}.jpg`);
    try { out.gdpr = await gdprCheck(br.browser, url, { screenshotPath: tmp }); try { out.screenshot = fs.readFileSync(tmp); } catch {} }
    catch (e) { out.gdpr = { error: e.message }; }
    finally { try { fs.unlinkSync(tmp); } catch {} }
  }
  if (o.a11y && ['ok', 'maintenance', 'not-wp'].includes(status)) {
    onStep('Akadálymentesség (axe)');
    try { out.a11y = await a11yCheck(br.browser, url); } catch (e) { out.a11y = { error: e.message }; }
    out.a11yPages = [];
    for (const u of job.a11yUrls || []) { if (shouldStop()) break; let p = u; try { p = new URL(u).pathname; } catch {} onStep(`Akadálymentesség (axe): ${p}`); try { out.a11yPages.push({ url: u, ...(await a11yCheck(br.browser, u)) }); } catch (e) { out.a11yPages.push({ url: u, error: e.message }); } }
  }
  if (o.lighthouse && !['error', 'maintenance'].includes(status)) {
    // egy böngészőpéldányon a mérések egymás után futnak (párhuzamosan zavarnák egymást)
    const devices = o.device === 'both' ? ['mobile', 'desktop'] : [o.device === 'desktop' ? 'desktop' : 'mobile'];
    const measure = async (u, dev) => {
      let p = '/'; try { p = new URL(u).pathname; } catch {}
      onStep(`Lighthouse (${dev === 'desktop' ? 'asztali' : 'mobil'}): ${p}`);
      let r;
      try { r = await runLighthouse(br.port, u, { device: dev }); } catch (e) { r = { error: e.message }; }
      if (r.error && /időtúllépés/.test(r.error)) { log('Lighthouse időtúllépés: a böngésző újraindul'); try { await br.restart(); } catch (e) { log('Böngésző-újraindítás sikertelen: ' + e.message); } }
      delete r.screenshot; // méret miatt nem tároljuk
      return r;
    };
    onStep('Lighthouse: elérhetőség-ellenőrzés');
    await sleep(BROWSER_PAUSE_MS); // a HTTP-felmérés kéréssora után hagyunk időt, hogy a védelem megnyugodjon
    const blocked = await detectChallenge(br.browser, url).catch(() => null);
    if (blocked) {
      out.lighthouse = { error: `Nem mérhető: ${blocked}. A webhely védelme blokkolja a mérést (próbáld más hálózatról, vagy engedélyezd a mérő IP-jét).` };
      log(`Lighthouse kihagyva, ${blocked}`);
      return out;
    }
    // főoldal: lighthouse az elsődleges (mobil, ha mindkettő fut), lighthouseDesktop a kiegészítő asztali
    out.lighthouse = await measure(url, devices[0]);
    if (devices[1]) out.lighthouseDesktop = await measure(url, devices[1]);
    out.lighthousePages = [];
    for (const u of pageUrls) {
      if (shouldStop()) break;
      const page = { url: u };
      for (const dev of devices) page[dev] = await measure(u, dev);
      out.lighthousePages.push(page);
    }
  }
  return out;
}

// a feladat eredményének átvitele JSON-ban (a képernyőkép base64)
export const packResult = out => ({ ...out, screenshot: out.screenshot ? Buffer.from(out.screenshot).toString('base64') : undefined });
export const unpackResult = out => ({ ...out, screenshot: out.screenshot ? Buffer.from(out.screenshot, 'base64') : undefined });
