// Távoli böngésző-munkások (worker konténerek) készlete: a koordinátor innen osztja ki a böngészős feladatokat.
// A munkások címe megadható listával (BROWSER_WORKERS) vagy egy hosztnévvel (BROWSER_WORKER_HOST=worker:4590): utóbbit a Docker Compose DNS-e
// a skálázott konténerek mindegyikére feloldja, így a `--scale worker=N` automatikusan bővíti a készletet.
import dns from 'node:dns/promises';
import { unpackResult } from './browser-job.mjs';

export function createWorkerPool({ urls = [], host = '', token = '', refreshMs = 15000, fetchImpl = fetch, resolve = (h) => dns.lookup(h, { all: true }) } = {}) {
  const workers = new Map(); // url → { busy, badUntil }
  const waiters = [];
  let timer = null;
  for (const u of urls) workers.set(u.replace(/\/+$/, ''), { busy: false, badUntil: 0 });

  async function refresh() {
    if (!host) return;
    const [h, port = '4590'] = host.split(':');
    try {
      const addrs = await resolve(h);
      const live = new Set(addrs.map(a => `http://${a.family === 6 ? `[${a.address}]` : a.address}:${port}`));
      for (const u of live) if (!workers.has(u)) workers.set(u, { busy: false, badUntil: 0 });
      for (const [u, w] of workers) if (!live.has(u) && !w.busy) workers.delete(u);
    } catch { /* a névfeloldás átmenetileg sikertelen: a meglévő lista marad */ }
  }
  const healthy = () => [...workers.entries()].filter(([, w]) => w.badUntil <= Date.now());
  const wake = () => { const w = waiters.shift(); if (w) w(); };

  async function acquire(timeoutMs) {
    const t0 = Date.now();
    for (;;) {
      const free = healthy().find(([, w]) => !w.busy);
      if (free) { free[1].busy = true; return free[0]; }
      if (Date.now() - t0 > timeoutMs) throw new Error('Nincs szabad böngésző-munkás');
      await new Promise(r => { waiters.push(r); setTimeout(r, 1000); });
    }
  }

  // egy feladat futtatása: a munkás NDJSON-ban küld lépés-üzeneteket, a végén az eredményt
  async function runOn(url, job, onStep, signal) {
    const res = await fetchImpl(`${url}/job`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ job }), signal });
    if (res.status === 429) { const e = new Error('foglalt'); e.busy = true; throw e; }
    if (res.status === 401) { const e = new Error('A munkás elutasította a WORKER_TOKEN-t'); e.fatal = true; throw e; }
    if (!res.ok) throw new Error('A munkás HTTP ' + res.status + ' választ adott');
    let buf = '', result = null, error = null;
    const dec = new TextDecoder();
    for await (const chunk of res.body) {
      buf += dec.decode(chunk, { stream: true });
      let i; while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m.step) onStep?.(m.step); else if (m.result) result = m.result; else if (m.error) error = m.error;
      }
    }
    if (error) throw Object.assign(new Error(error), { remote: true });
    if (!result) throw new Error('A munkás lezárta a kapcsolatot eredmény nélkül');
    return unpackResult(result);
  }

  return {
    refresh,
    start() { refresh(); if (!timer) { timer = setInterval(refresh, refreshMs); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
    enabled: () => !!token && (!!host || workers.size > 0),
    size: () => healthy().length,
    status: () => [...workers.entries()].map(([url, w]) => ({ url, busy: w.busy, healthy: w.badUntil <= Date.now() })),
    async run(job, { onStep, timeoutMs = 25 * 60 * 1000, attempts = 3 } = {}) {
      let last;
      for (let a = 0; a < attempts; a++) {
        const url = await acquire(timeoutMs);
        const w = workers.get(url);
        try {
          return await runOn(url, job, onStep, AbortSignal.timeout(timeoutMs));
        } catch (e) {
          last = e;
          if (e.busy) { if (w) w.badUntil = Date.now() + 3000; /* a foglalt munkást néhány másodpercre kihagyjuk */ }
          else if (e.remote) throw e; // a munkás lefuttatta, de a feladat hibás: újrapróbálás nem segít
          else if (w) w.badUntil = Date.now() + (e.fatal ? 5 * 60 * 1000 : 30 * 1000);
        } finally { if (w) w.busy = false; wake(); }
      }
      throw last || new Error('A böngészős feladat nem futott le');
    },
  };
}
