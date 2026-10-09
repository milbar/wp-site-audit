// PDF-export: a html-riportot a gépen lévő Chrome-mal nyomtatjuk PDF-be
import { startBrowser } from './browser.mjs';

let chain = Promise.resolve(); // egyszerre egy PDF készül (a Chrome-indítás költséges)

export function renderPdf(html) {
  const job = chain.then(async () => {
    const br = await startBrowser({ blockPrivate: false });
    try {
      const page = await br.browser.newPage();
      // a riport önálló: semmilyen külső hálózati kérést nem engedünk, és szkript sem fut
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', r => (/^(data|about|blob):/.test(r.url()) ? r.continue() : r.abort()));
      await page.setContent(html, { waitUntil: 'load', timeout: 60000 });
      const buf = await page.pdf({
        format: 'A4', printBackground: true, margin: { top: '14mm', bottom: '16mm', left: '11mm', right: '11mm' },
        displayHeaderFooter: true, headerTemplate: '<span></span>',
        footerTemplate: '<div style="width:100%;font-size:8px;color:#777;text-align:right;padding-right:11mm"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      });
      return Buffer.from(buf);
    } finally { await br.close(); }
  });
  chain = job.catch(() => {});
  return job;
}
