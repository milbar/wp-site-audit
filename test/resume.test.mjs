import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const get = (port, p) => new Promise((ok, bad) => { http.get({ host: '127.0.0.1', port, path: p, headers: { host: `localhost:${port}` } }, r => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => ok(JSON.parse(b))); }).on('error', bad); });

test('a megszakadt felmérés folytatódik: a kész domain megmarad, a félbehagyott újraindul', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-resume-'));
  const id = '2026-01-01-00-00-00-abcd';
  fs.mkdirSync(path.join(dataDir, 'runs', id), { recursive: true });
  const stub = { domain: 'kesz.invalid', status: 'ok', marker: 'ERINTETLEN', findings: [], totals: {}, flags: {} };
  fs.writeFileSync(path.join(dataDir, 'runs', id, 'run.json'), JSON.stringify({
    id, createdAt: new Date().toISOString(), finished: false, domains: ['kesz.invalid', 'felbehagyott.invalid'],
    options: { name: 'Teszt', gdpr: false, lighthouse: false, geo: false, ai: false, suggest: false, spam: false, device: 'mobile', pages: 0, concurrency: 2 },
    sites: { 'kesz.invalid': { domain: 'kesz.invalid', state: 'done', step: '', result: stub }, 'felbehagyott.invalid': { domain: 'felbehagyott.invalid', state: 'probing', step: 'pluginok', result: { partial: true } } },
  }));
  const port = 20000 + Math.floor(Math.random() * 20000);
  const proc = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, REQUEST_DELAY_MS: '0' } });
  try {
    await new Promise((ok, bad) => { let out = ''; proc.stdout.on('data', d => { out += d; if (out.includes('folytatása')) ok(); }); proc.on('exit', c => bad(new Error('kilépett ' + c))); setTimeout(() => bad(new Error('nem indult el a folytatás: ' + out)), 60000); });
    let r;
    for (let i = 0; i < 60; i++) { r = await get(port, `/api/runs/${id}`); if (r.finished) break; await new Promise(x => setTimeout(x, 1000)); }
    assert.equal(r.finished, true, 'a felmérés befejeződik');
    assert.equal(r.resumed, 1);
    assert.equal(r.sites['kesz.invalid'].result.marker, 'ERINTETLEN', 'a kész domain eredménye megmarad');
    const f = r.sites['felbehagyott.invalid'];
    assert.ok(['done', 'failed'].includes(f.state), 'a félbehagyott domain lezárult: ' + f.state);
    assert.equal(f.result?.partial, undefined, 'a részleges eredmény helyett új mérés készült');
  } finally { proc.kill(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});
