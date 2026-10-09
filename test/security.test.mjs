import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { isPrivate, createClient, guardedLookup } from '../lib/http.mjs';
import { startGuardProxy } from '../lib/guard-proxy.mjs';

const listen = (handler) => new Promise(ok => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => ok(s)); });

test('isPrivate: belső és speciális címek tiltva, nyilvánosak engedve', () => {
  const priv = ['127.0.0.1', '10.1.2.3', '172.20.0.5', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe', 'nem-ip'];
  const pub = ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'];
  for (const ip of priv) assert.equal(isPrivate(ip), true, ip + ' privát kellene legyen');
  for (const ip of pub) assert.equal(isPrivate(ip), false, ip + ' nyilvános kellene legyen');
});

test('guardedLookup: a localhost névfeloldás kapcsolódáskor elutasítva', async () => {
  const err = await new Promise(res => guardedLookup('localhost', {}, e => res(e)));
  assert.match(String(err?.message), /Privát/);
});

test('védett kliens nem éri el a helyi szervert, a nem védett igen', async () => {
  const s = await listen((q, r) => r.end('titok'));
  const url = `http://127.0.0.1:${s.address().port}/`;
  try {
    const blocked = await createClient({ blockPrivate: true, delayMs: 0 }).tryGet(url);
    assert.equal(blocked.status, 0); assert.match(blocked.error, /Privát/);
    const open = await createClient({ blockPrivate: false, delayMs: 0 }).tryGet(url);
    assert.equal(open.status, 200); assert.equal(open.body, 'titok');
  } finally { s.close(); }
});

test('védett kliens a localhost nevet átirányításon keresztül sem éri el', async () => {
  const target = await listen((q, r) => r.end('belső'));
  const redir = await listen((q, r) => { r.writeHead(302, { location: `http://localhost:${target.address().port}/` }); r.end(); });
  try {
    // a védett kliens már a kiinduló címet sem engedi, a lánc ellenőrzése külön a névfeloldásnál történik
    const r = await createClient({ blockPrivate: true, delayMs: 0 }).tryGet(`http://127.0.0.1:${redir.address().port}/`);
    assert.equal(r.status, 0);
  } finally { target.close(); redir.close(); }
});

test('védett kliens TLS-lekérdezése sem éri el a belső címet', async () => {
  const c = createClient({ blockPrivate: true, delayMs: 0 });
  const r = await c.cert('localhost');
  assert.equal(r.authorized, false);
  assert.match(String(r.error), /Privát/);
});

test('csak http és https engedett', async () => {
  const r = await createClient({ blockPrivate: false, delayMs: 0 }).tryGet('file:///etc/passwd');
  assert.equal(r.status, 0); assert.match(r.error, /http/);
});

test('szűrő-proxy: belső címre sem HTTP, sem CONNECT nem megy át', async () => {
  const target = await listen((q, r) => r.end('belső'));
  const proxy = await startGuardProxy();
  const tport = target.address().port;
  try {
    const status = await new Promise((ok, bad) => {
      const q = http.request({ host: '127.0.0.1', port: proxy.port, method: 'GET', path: `http://127.0.0.1:${tport}/`, headers: { host: `127.0.0.1:${tport}` } }, r => { r.resume(); ok(r.statusCode); });
      q.on('error', bad); q.end();
    });
    assert.equal(status, 403);
    const line = await new Promise((ok, bad) => {
      const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`CONNECT 127.0.0.1:${tport} HTTP/1.1\r\nHost: 127.0.0.1:${tport}\r\n\r\n`));
      s.once('data', d => { ok(d.toString().split('\r\n')[0]); s.destroy(); }); s.on('error', bad);
    });
    assert.match(line, /403/);
    const dnsName = await new Promise((ok, bad) => {
      const s = net.connect(proxy.port, '127.0.0.1', () => s.write(`CONNECT localhost:${tport} HTTP/1.1\r\nHost: localhost:${tport}\r\n\r\n`));
      s.once('data', d => { ok(d.toString().split('\r\n')[0]); s.destroy(); }); s.on('error', bad);
    });
    assert.match(dnsName, /403/);
  } finally { target.close(); await proxy.close(); }
});

test('szűrő-proxy: nyitva hagyott kapcsolattal is leáll (nem akasztja meg a felmérés lezárását)', async () => {
  const proxy = await startGuardProxy();
  const idle = net.connect(proxy.port, '127.0.0.1'); // keep-alive jellegű, soha le nem zárt kapcsolat
  await new Promise(ok => idle.once('connect', ok));
  const t0 = Date.now();
  await Promise.race([proxy.close(), new Promise((_, bad) => setTimeout(() => bad(new Error('a close() nem tért vissza')), 4000))]);
  assert.ok(Date.now() - t0 < 3000);
  idle.destroy();
});
