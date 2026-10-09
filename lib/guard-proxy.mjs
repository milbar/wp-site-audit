// Szűrő HTTP-proxy a Chrome elé (szerver módban): a böngésző csak nyilvános címekre kapcsolódhat.
// Védi a belső hálózatot (pl. az Ollama konténert, a gazdagépet) attól, hogy egy ellenséges, auditált oldal JavaScriptje onnan olvasson.
// A névfeloldást és a kapcsolódást a proxy végzi ugyanarra az ellenőrzött IP-re, ezért DNS-rebinding sem működik.
import http from 'node:http';
import net from 'node:net';
import dns from 'node:dns/promises';
import { isPrivate } from './http.mjs';

async function publicAddress(host) {
  host = host.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivate(a.address))) throw Object.assign(new Error('Privát / belső cím'), { blocked: true });
  return addrs[0];
}

export function startGuardProxy() {
  const server = http.createServer(async (req, res) => {
    try {
      const u = new URL(req.url);
      if (u.protocol !== 'http:') { res.writeHead(400).end(); return; }
      const a = await publicAddress(u.hostname);
      const headers = { ...req.headers }; delete headers['proxy-connection']; delete headers['proxy-authorization'];
      const up = http.request({ host: a.address, family: a.family, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers: { ...headers, host: u.host } }, ur => { res.writeHead(ur.statusCode, ur.headers); ur.pipe(res); });
      up.on('error', () => { if (!res.headersSent) res.writeHead(502); res.end(); });
      req.pipe(up);
    } catch (e) { if (!res.headersSent) res.writeHead(e.blocked ? 403 : 502); res.end(); }
  });
  server.on('connect', async (req, client, head) => {
    try {
      const m = req.url.match(/^(.*):(\d+)$/); if (!m) throw new Error('hibás cél');
      const a = await publicAddress(m[1]);
      const up = net.connect({ host: a.address, port: +m[2] }, () => { client.write('HTTP/1.1 200 Connection Established\r\n\r\n'); if (head?.length) up.write(head); up.pipe(client); client.pipe(up); });
      up.on('error', () => client.destroy()); client.on('error', () => up.destroy()); up.setTimeout(120000, () => up.destroy());
      up.on('close', () => client.destroy()); client.on('close', () => up.destroy()); // az egyik oldal lezárulásával a másik is
    } catch (e) { client.end(`HTTP/1.1 ${e.blocked ? 403 : 502} ${e.blocked ? 'Forbidden' : 'Bad Gateway'}\r\n\r\n`); }
  });
  // a nyitva maradt (keep-alive, alagút) kapcsolatokat leálláskor lezárjuk, különben a close() soha nem tér vissza
  const conns = new Set();
  server.on('connection', s => { conns.add(s); s.on('close', () => conns.delete(s)); });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok({ port: server.address().port, close: () => new Promise(r => { server.close(() => r()); for (const s of conns) s.destroy(); }) })));
}
