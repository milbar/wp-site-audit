import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createAuth } from '../lib/auth.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let proc, port, dataDir, hook, hookPayloads = [];

const call = (method, p, { headers = {}, body, json } = {}) => new Promise((ok, bad) => {
  const payload = json !== undefined ? JSON.stringify(json) : body;
  const h = { host: `localhost:${port}`, ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...headers };
  const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: h, agent: false }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch {} ok({ status: res.statusCode, headers: res.headers, body: b, json: j }); }); });
  r.on('error', bad); if (payload) r.write(payload); r.end();
});
const login = async (name, password) => { const r = await call('POST', '/api/login', { json: { name, password } }); const m = String(r.headers['set-cookie'] || '').match(/sid=([^;]+)/); return { r, cookie: m ? `sid=${m[1]}` : null }; };

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-users-'));
  const au = createAuth({ dir: dataDir });
  au.addUser('anna', 'anna-jelszo-12345', 'admin'); au.addUser('bela', 'bela-jelszo-12345', 'user');
  hook = http.createServer((q, r) => { let b = ''; q.on('data', c => { b += c; }); q.on('end', () => { try { hookPayloads.push(JSON.parse(b)); } catch {} r.end('ok'); }); });
  await new Promise(ok => hook.listen(0, '127.0.0.1', ok));
  port = 20000 + Math.floor(Math.random() * 20000);
  proc = spawn(process.execPath, ['server.mjs'], { cwd: ROOT, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDir, REQUEST_DELAY_MS: '0', SCHEDULER: '0', AUTH_USER: '', AUTH_PASS: '' } });
  await new Promise((ok, bad) => { proc.stdout.on('data', d => { if (String(d).includes('fut')) ok(); }); proc.on('exit', c => bad(new Error('kilépett ' + c))); setTimeout(() => bad(new Error('nem indult el')), 40000); });
});
after(() => { proc?.kill(); hook?.close(); try { fs.rmSync(dataDir, { recursive: true, force: true }); } catch {} });

test('belépés nélkül: a felület a belépő oldalra irányít, az API 401-et ad, a belépő oldal nyilvános', async () => {
  const ui = await call('GET', '/'); assert.equal(ui.status, 302); assert.equal(ui.headers.location, '/login.html');
  const api = await call('GET', '/api/runs'); assert.equal(api.status, 401); assert.equal(api.json.login, '/login.html'); assert.equal(api.headers['www-authenticate'], undefined, 'felhasználói módban nincs böngésző-felugró');
  assert.equal((await call('GET', '/login.html')).status, 200); assert.equal((await call('GET', '/login.js')).status, 200);
});

test('belépés: hibás jelszó 401, helyes jelszó süti HttpOnly és SameSite=Strict jelzővel', async () => {
  assert.equal((await login('anna', 'rossz')).r.status, 401);
  const { r, cookie } = await login('anna', 'anna-jelszo-12345');
  assert.equal(r.status, 200); assert.ok(cookie);
  const sc = String(r.headers['set-cookie']); assert.match(sc, /HttpOnly/); assert.match(sc, /SameSite=Strict/);
  const me = await call('GET', '/api/me', { headers: { cookie } }); assert.equal(me.json.name, 'anna'); assert.equal(me.json.role, 'admin'); assert.equal(me.json.canLogout, true);
});

test('süti mellett a módosító kérés JSON-t és azonos Origin-t kíván (CSRF)', async () => {
  const { cookie } = await login('anna', 'anna-jelszo-12345');
  assert.equal((await call('POST', '/api/parse', { headers: { cookie, 'content-type': 'text/plain' }, body: '{"text":"a.hu"}' })).status, 415);
  assert.equal((await call('POST', '/api/parse', { headers: { cookie, origin: 'https://evil.example' }, json: { text: 'a.hu' } })).status, 403);
  assert.equal((await call('POST', '/api/parse', { headers: { cookie, origin: `http://localhost:${port}` }, json: { text: 'a.hu' } })).status, 200);
});

test('a felmérések tulajdonos szerint láthatók; az admin mindet látja', async () => {
  const anna = (await login('anna', 'anna-jelszo-12345')).cookie, bela = (await login('bela', 'bela-jelszo-12345')).cookie;
  const opts = { spam: false, gdpr: false, lighthouse: false, geo: false, a11y: false, links: false, dns: false };
  const mk = await call('POST', '/api/runs', { headers: { cookie: bela }, json: { text: 'belae.invalid', name: 'Béla felmérése', ...opts } });
  assert.equal(mk.status, 201, mk.body);
  const id = mk.json.id;
  assert.equal((await call('GET', `/api/runs/${id}`, { headers: { cookie: bela } })).status, 200);
  assert.equal((await call('GET', `/api/runs/${id}`, { headers: { cookie: anna } })).status, 200, 'az admin látja');
  const mk2 = await call('POST', '/api/runs', { headers: { cookie: anna }, json: { text: 'annae.invalid', name: 'Anna felmérése', ...opts } });
  assert.equal(mk2.status, 201);
  const id2 = mk2.json.id;
  assert.equal((await call('GET', `/api/runs/${id2}`, { headers: { cookie: bela } })).status, 404, 'Béla nem látja Annáét');
  assert.equal((await call('DELETE', `/api/runs/${id2}`, { headers: { cookie: bela }, json: {} })).status, 404, 'és nem is törölheti');
  assert.equal((await call('GET', `/api/runs/${id2}/export/html`, { headers: { cookie: bela } })).status, 404);
  const listB = (await call('GET', '/api/runs', { headers: { cookie: bela } })).json.map(x => x.id);
  assert.ok(listB.includes(id) && !listB.includes(id2));
  const listA = (await call('GET', '/api/runs', { headers: { cookie: anna } })).json.map(x => x.id);
  assert.ok(listA.includes(id) && listA.includes(id2));
});

test('a beállításokat csak az admin írhatja; a felhasználókat csak az admin kezeli', async () => {
  const anna = (await login('anna', 'anna-jelszo-12345')).cookie, bela = (await login('bela', 'bela-jelszo-12345')).cookie;
  assert.equal((await call('PUT', '/api/settings', { headers: { cookie: bela }, json: { senderOrg: 'X' } })).status, 403);
  assert.equal((await call('PUT', '/api/settings', { headers: { cookie: anna }, json: { senderOrg: 'X Kft.' } })).status, 200);
  assert.equal((await call('GET', '/api/users', { headers: { cookie: bela } })).status, 403);
  const users = await call('GET', '/api/users', { headers: { cookie: anna } });
  assert.equal(users.status, 200); assert.ok(users.json.every(u => !('hash' in u)));
  assert.equal((await call('POST', '/api/users', { headers: { cookie: anna }, json: { name: 'cili', password: 'rovid' } })).status, 400);
  assert.equal((await call('POST', '/api/users', { headers: { cookie: anna }, json: { name: 'cili', password: 'cili-jelszo-12345' } })).status, 201);
});

test('API-kulcs: Bearer-rel JSON-tartalomtípus nélkül is működik, visszavonás után nem', async () => {
  const anna = (await login('anna', 'anna-jelszo-12345')).cookie;
  const tk = await call('POST', '/api/tokens', { headers: { cookie: anna }, json: { name: 'teszt' } });
  assert.equal(tk.status, 201); const bearer = { authorization: `Bearer ${tk.json.token}` };
  assert.equal((await call('GET', '/api/runs', { headers: bearer })).status, 200);
  assert.equal((await call('POST', '/api/parse', { headers: { ...bearer, 'content-type': 'text/plain' }, body: '{"text":"a.hu"}' })).status, 200);
  assert.equal((await call('GET', '/api/runs', { headers: { authorization: 'Bearer wsa_hamis' } })).status, 401);
  assert.equal((await call('DELETE', `/api/tokens/${tk.json.id}`, { headers: { cookie: anna }, json: {} })).status, 200);
  assert.equal((await call('GET', '/api/runs', { headers: bearer })).status, 401);
});

test('webhook: a felmérés végén a kért címre érkezik az összegzés (Slack-kompatibilis „text” mezővel)', async () => {
  const anna = (await login('anna', 'anna-jelszo-12345')).cookie;
  const opts = { spam: false, gdpr: false, lighthouse: false, geo: false, a11y: false, links: false, dns: false };
  const mk = await call('POST', '/api/runs', { headers: { cookie: anna }, json: { text: 'webhook.invalid', name: 'Webhook teszt', webhookUrl: `http://127.0.0.1:${hook.address().port}/hook`, ...opts } });
  assert.equal(mk.status, 201);
  for (let i = 0; i < 30 && !hookPayloads.length; i++) await new Promise(r => setTimeout(r, 500));
  assert.equal(hookPayloads.length, 1, 'megérkezett a webhook');
  assert.match(hookPayloads[0].text, /Webhook teszt/); assert.equal(hookPayloads[0].runId, mk.json.id); assert.ok(Array.isArray(hookPayloads[0].alerts));
});

test('ütemezés: létrehozás, saját láthatóság, futtatás most, törlés', async () => {
  const anna = (await login('anna', 'anna-jelszo-12345')).cookie, bela = (await login('bela', 'bela-jelszo-12345')).cookie;
  const body = { name: 'Heti teszt', text: 'utemezett.invalid', every: 'weekly', weekday: 2, time: '07:30', options: { dns: false, spam: false } };
  const s = await call('POST', '/api/schedules', { headers: { cookie: bela }, json: body });
  assert.equal(s.status, 201); assert.equal(s.json.every, 'weekly'); assert.equal(s.json.weekday, 2); assert.ok(s.json.nextRunAt);
  assert.equal((await call('GET', '/api/schedules', { headers: { cookie: anna } })).json.some(x => x.id === s.json.id), true, 'az admin látja');
  const run = await call('POST', `/api/schedules/${s.json.id}/run`, { headers: { cookie: bela }, json: {} });
  assert.equal(run.status, 201); assert.ok(run.json.id);
  const info = await call('GET', `/api/runs/${run.json.id}`, { headers: { cookie: bela } });
  assert.equal(info.status, 200); assert.equal(info.json.scheduleId, s.json.id);
  assert.equal((await call('DELETE', `/api/schedules/${s.json.id}`, { headers: { cookie: anna }, json: {} })).status, 200);
  assert.equal((await call('POST', '/api/schedules', { headers: { cookie: bela }, json: { name: 'x', text: 'nincs domain itt' } })).status, 400);
});

test('kilépés után a munkamenet érvénytelen', async () => {
  const { cookie } = await login('bela', 'bela-jelszo-12345');
  assert.equal((await call('GET', '/api/me', { headers: { cookie } })).status, 200);
  const out = await call('POST', '/api/logout', { headers: { cookie }, json: {} });
  assert.equal(out.status, 200); assert.match(String(out.headers['set-cookie']), /Max-Age=0/);
  assert.equal((await call('GET', '/api/me', { headers: { cookie } })).status, 401);
});
