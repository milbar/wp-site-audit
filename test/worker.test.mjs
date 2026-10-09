import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkerPool } from '../lib/worker-pool.mjs';
import { findChrome } from '../lib/browser.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = 'teszt-token-legalabb-16-karakter';

// mesterséges munkás: NDJSON-ban lépéseket és eredményt küld
function fakeWorker({ delay = 30, mode = 'ok' } = {}) {
  let busy = false, jobs = 0;
  const srv = http.createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401).end(); return; }
    if (mode === 'busy' || busy) { res.writeHead(429).end(); return; }
    busy = true; jobs++;
    let body = ''; for await (const c of req) body += c;
    const { job } = JSON.parse(body);
    res.writeHead(200, { 'content-type': 'application/x-ndjson' });
    if (mode === 'fail') { res.write(JSON.stringify({ error: 'a feladat hibás' }) + '\n'); busy = false; res.end(); return; }
    res.write(JSON.stringify({ step: 'első lépés' }) + '\n');
    await new Promise(r => setTimeout(r, delay));
    res.write(JSON.stringify({ step: 'második lépés' }) + '\n');
    res.write(JSON.stringify({ result: { gdpr: { banner: true, domain: job.domain }, screenshot: Buffer.from('JPEGADAT').toString('base64') } }) + '\n');
    busy = false; res.end();
  });
  return new Promise(ok => srv.listen(0, '127.0.0.1', () => ok({ srv, url: `http://127.0.0.1:${srv.address().port}`, jobs: () => jobs })));
}

test('munkás-készlet: lépés-üzenetek, eredmény és képernyőkép átvitele', async () => {
  const w = await fakeWorker();
  const pool = createWorkerPool({ urls: [w.url], token: TOKEN });
  try {
    assert.equal(pool.enabled(), true); assert.equal(pool.size(), 1);
    const steps = [];
    const out = await pool.run({ domain: 'a.hu', url: 'https://a.hu/', options: {} }, { onStep: s => steps.push(s) });
    assert.deepEqual(steps, ['első lépés', 'második lépés']);
    assert.equal(out.gdpr.domain, 'a.hu');
    assert.equal(Buffer.isBuffer(out.screenshot), true); assert.equal(out.screenshot.toString(), 'JPEGADAT');
  } finally { w.srv.close(); }
});

test('munkás-készlet: több feladat két munkáson oszlik el, a többi vár', async () => {
  const [a, b] = [await fakeWorker({ delay: 120 }), await fakeWorker({ delay: 120 })];
  const pool = createWorkerPool({ urls: [a.url, b.url], token: TOKEN });
  try {
    const t0 = Date.now();
    const rs = await Promise.all(['1', '2', '3', '4'].map(d => pool.run({ domain: d + '.hu', url: `https://${d}.hu/`, options: {} })));
    assert.equal(rs.length, 4);
    assert.equal(a.jobs() + b.jobs(), 4); assert.ok(a.jobs() >= 1 && b.jobs() >= 1, 'mindkét munkás kapott feladatot');
    assert.ok(Date.now() - t0 >= 200, 'négy feladat két munkán legalább két körben fut');
  } finally { a.srv.close(); b.srv.close(); }
});

test('munkás-készlet: a foglalt munkás helyett másikat használ, a leállt munkást kerüli', async () => {
  const busy = await fakeWorker({ mode: 'busy' }), good = await fakeWorker();
  const dead = 'http://127.0.0.1:9'; // nem figyel rajta senki
  const pool = createWorkerPool({ urls: [dead, busy.url, good.url], token: TOKEN });
  try {
    const out = await pool.run({ domain: 'x.hu', url: 'https://x.hu/', options: {} }, { attempts: 5 });
    assert.equal(out.gdpr.domain, 'x.hu');
    assert.equal(good.jobs(), 1);
  } finally { busy.srv.close(); good.srv.close(); }
});

test('munkás-készlet: a hibás feladat hibája átjön, rossz token nem újrapróbálható', async () => {
  const f = await fakeWorker({ mode: 'fail' });
  try {
    await assert.rejects(createWorkerPool({ urls: [f.url], token: TOKEN }).run({ domain: 'x.hu', url: 'https://x.hu/', options: {} }), /a feladat hibás/);
    const bad = createWorkerPool({ urls: [f.url], token: 'rossz-token-rossz-token' });
    await assert.rejects(bad.run({ domain: 'x.hu', url: 'https://x.hu/', options: {} }, { attempts: 1 }), /WORKER_TOKEN/);
    assert.equal(bad.size(), 0, 'a rossz tokenes munkás kikerül a készletből');
  } finally { f.srv.close(); }
});

test('munkás-készlet: hosztnévből (DNS) feloldott munkások, nem engedélyezett token nélkül', async () => {
  const w = await fakeWorker();
  const port = new URL(w.url).port;
  const pool = createWorkerPool({ host: `worker:${port}`, token: TOKEN, resolve: async () => [{ address: '127.0.0.1', family: 4 }] });
  try {
    await pool.refresh();
    assert.equal(pool.size(), 1);
    assert.equal(createWorkerPool({ host: 'worker:4590', token: '' }).enabled(), false, 'token nélkül a készlet nem aktív');
  } finally { w.srv.close(); }
});

test('valódi worker.mjs: token nélkül nem indul, tokennel kiszolgál (Chrome szükséges)', async (t) => {
  const noTok = spawn(process.execPath, ['worker.mjs'], { cwd: ROOT, env: { ...process.env, WORKER_TOKEN: '' } });
  const code = await new Promise(ok => noTok.on('exit', ok));
  assert.equal(code, 1);
  if (!findChrome()) return t.skip('nincs Chrome ezen a gépen');
  const port = 30000 + Math.floor(Math.random() * 10000);
  const w = spawn(process.execPath, ['worker.mjs'], { cwd: ROOT, env: { ...process.env, WORKER_TOKEN: TOKEN, WORKER_PORT: String(port) } });
  try {
    await new Promise((ok, bad) => { w.stdout.on('data', d => { if (String(d).includes('fut')) ok(); }); w.on('exit', c => bad(new Error('kilépett ' + c))); setTimeout(() => bad(new Error('nem indult')), 30000); });
    const h = await (await fetch(`http://127.0.0.1:${port}/health`)).json(); assert.equal(h.ok, true);
    assert.equal((await fetch(`http://127.0.0.1:${port}/job`, { method: 'POST', body: '{}' })).status, 401, 'token nélkül elutasítja');
    const pool = createWorkerPool({ urls: [`http://127.0.0.1:${port}`], token: TOKEN });
    const steps = [];
    // a munkás védett módban fut: belső címre nem enged kapcsolódni, ez a hiba a feladat eredményében látszik
    const out = await pool.run({ domain: 'helyi', url: 'http://127.0.0.1:1/', status: 'ok', options: { gdpr: true } }, { onStep: s => steps.push(s) });
    assert.ok(steps.includes('GDPR / süti-mérés'));
    assert.ok(out.gdpr, 'a feladat lefutott');
  } finally { w.kill(); }
});
