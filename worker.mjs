// Böngésző-munkás: egyszerre egy böngészős feladatot futtat (GDPR, akadálymentesség, Lighthouse), a koordinátor kéri tőle.
// Csak a belső hálózaton fut, a WORKER_TOKEN ismerete nélkül nem használható. Indítás: node worker.mjs
import http from 'node:http';
import crypto from 'node:crypto';
import { startBrowser } from './lib/browser.mjs';
import { runBrowserJob, packResult } from './lib/browser-job.mjs';

const PORT = +(process.env.WORKER_PORT || 4590);
const TOKEN = process.env.WORKER_TOKEN || '';
if (!TOKEN || TOKEN.length < 16) { console.error('A WORKER_TOKEN (legalább 16 karakter) kötelező.'); process.exit(1); }
const JOB_TIMEOUT_MS = +(process.env.WORKER_JOB_TIMEOUT_MS || 20 * 60 * 1000);

let br = null, busy = false;
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

// a munkás mindig védett módban fut: a Chrome forgalma szűrő-proxyn megy át, így a belső hálózat nem érhető el
async function ensureBrowser() { if (!br) br = await startBrowser({ blockPrivate: true }); return br; }
async function dropBrowser() { try { await br?.close(); } catch {} br = null; }

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, busy })); }
  if (req.method !== 'POST' || req.url !== '/job') { res.writeHead(404); return res.end(); }
  if (!eq(req.headers.authorization || '', `Bearer ${TOKEN}`)) { res.writeHead(401); return res.end(); }
  if (busy) { res.writeHead(429); return res.end(); }
  let body = ''; for await (const c of req) { body += c; if (body.length > 300000) { res.writeHead(413); return res.end(); } }
  let job; try { job = JSON.parse(body).job; } catch { res.writeHead(400); return res.end(); }
  // a címet itt is ellenőrizzük: csak http(s), és nem lehet IP-literál belső tartományból (a proxy a hosztneveket védi)
  try { const u = new URL(job.url); if (!/^https?:$/.test(u.protocol)) throw new Error('séma'); } catch { res.writeHead(400); return res.end(JSON.stringify({ error: 'érvénytelen cím' })); }
  busy = true; const t0 = Date.now(); console.log(`feladat indul: ${job.domain}`);
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  const send = o => res.write(JSON.stringify(o) + '\n');
  const timer = setTimeout(() => { send({ error: 'A munkás időkorlátja lejárt' }); dropBrowser().finally(() => res.end()); }, JOB_TIMEOUT_MS);
  try {
    const b = await ensureBrowser();
    const out = await runBrowserJob(b, job, { onStep: step => send({ step }), log: m => console.log(`[${job.domain}] ${m}`) });
    send({ result: packResult(out) });
  } catch (e) { send({ error: e.message || String(e) }); await dropBrowser(); }
  finally { clearTimeout(timer); busy = false; res.end(); console.log(`feladat kész: ${job.domain} (${Math.round((Date.now() - t0) / 1000)} mp)`); }
});
server.listen(PORT, '0.0.0.0', () => console.log(`Böngésző-munkás fut: ${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await dropBrowser(); process.exit(0); });
