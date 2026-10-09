import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let proc, port, dataDir;
const req = (method, p, { headers = {}, body } = {}) => new Promise((ok, bad) => {
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => ok({ status: res.statusCode, headers: res.headers, body: b })); });
  r.on('error', bad); if (body) r.write(body); r.end();
});
const J = { 'content-type': 'application/json', host: '' };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-test-'));
  port = 20000 + Math.floor(Math.random() * 20000);
  proc = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, AUTH_USER: '', AUTH_PASS: '' } });
  await new Promise((ok, bad) => { proc.stdout.on('data', d => { if (String(d).includes('fut')) ok(); }); proc.on('exit', c => bad(new Error('a szerver kilépett: ' + c))); setTimeout(() => bad(new Error('időtúllépés')), 40000); });
});
after(() => { proc?.kill(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });

const hdr = (extra = {}) => ({ host: `localhost:${port}`, ...extra });

test('a felület kiszolgálása biztonsági fejlécekkel', async () => {
  const r = await req('GET', '/', { headers: hdr() });
  assert.equal(r.status, 200);
  assert.match(r.headers['content-security-policy'], /script-src 'self'/);
  assert.equal(r.headers['x-frame-options'], 'DENY');
});

test('idegen Host fejléc (DNS-rebinding) elutasítva helyi módban', async () => {
  const r = await req('GET', '/api/settings', { headers: { host: 'evil.example.com' } });
  assert.equal(r.status, 403);
});

test('módosító kérés JSON tartalomtípus nélkül elutasítva (CSRF)', async () => {
  const r = await req('POST', '/api/runs', { headers: hdr({ 'content-type': 'text/plain' }), body: '{"text":"example.com"}' });
  assert.equal(r.status, 415);
});

test('módosító kérés idegen Origin-nel elutasítva (CSRF)', async () => {
  const r = await req('POST', '/api/parse', { headers: hdr({ 'content-type': 'application/json', origin: 'https://evil.example.com' }), body: '{"text":"example.com"}' });
  assert.equal(r.status, 403);
});

test('azonos Origin-nel és JSON-nal a kérés átmegy', async () => {
  const r = await req('POST', '/api/parse', { headers: hdr({ 'content-type': 'application/json', origin: `http://localhost:${port}` }), body: '{"text":"Example.com, https://foo.hu/x"}' });
  assert.equal(r.status, 200);
  assert.deepEqual(JSON.parse(r.body).domains, ['example.com', 'foo.hu']);
});

test('érvénytelen JSON 400-at ad, nem 500-at', async () => {
  const r = await req('POST', '/api/parse', { headers: hdr({ 'content-type': 'application/json' }), body: '{nem json' });
  assert.equal(r.status, 400);
});

test('a beállítások csak ismert kulcsokat fogadnak el, korlátozott értékekkel', async () => {
  const r = await req('PUT', '/api/settings', { headers: hdr({ 'content-type': 'application/json' }), body: JSON.stringify({ evil: '<script>', hours: { onboarding: 99999, nincsIlyen: 5, ssl: -3 }, author: { name: 'x'.repeat(500), titkos: 1 }, showHours: 'igen' }) });
  assert.equal(r.status, 200);
  const s = JSON.parse(r.body);
  assert.equal(s.evil, undefined);
  assert.equal(s.hours.nincsIlyen, undefined);
  assert.equal(s.hours.onboarding, 1000);
  assert.equal(s.hours.ssl, 0);
  assert.equal(s.author.name.length, 200);
  assert.equal(s.author.titkos, undefined);
  assert.equal(s.showHours, true);
});

test('útvonal-bejárási kísérlet a statikus fájloknál nem ad ki fájlt', async () => {
  for (const p of ['/../server.mjs', '/..%2fserver.mjs', '/%2e%2e/package.json']) {
    const r = await req('GET', p, { headers: hdr() });
    assert.notEqual(r.status, 200, p);
  }
});
