// WP Site Audit – webszerver (node server.mjs)
// Környezeti változók: PORT, HOST, AUTH_USER, AUTH_PASS, BLOCK_PRIVATE=1, MAX_DOMAINS, MAX_ACTIVE_RUNS, ALLOWED_HOSTS, DATA_DIR, CHROME_PATH,
// REQUEST_DELAY_MS, WEBHOOK_URL, COOKIE_SECURE=1, TRUST_PROXY=1, BROWSER_WORKERS / BROWSER_WORKER_HOST + WORKER_TOKEN, RESUME_RUNS=0, TZ
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createClient } from './lib/http.mjs';
import { createWporg } from './lib/wporg.mjs';
import { parseDomains } from './lib/probe.mjs';
import { Run } from './lib/runner.mjs';
import { analyze } from './lib/rules.mjs';
import { exportXlsx } from './lib/export-xlsx.mjs';
import { exportProposals, exportEmails } from './lib/export-docx.mjs';
import { exportHtml } from './lib/export-html.mjs';
import { aiStatus } from './lib/ai.mjs';
import { renderPdf } from './lib/pdf.mjs';
import { exportCsv } from './lib/export-csv.mjs';
import { createAuth, canSee } from './lib/auth.mjs';
import { createScheduler, buildAlertPayload } from './lib/scheduler.mjs';
import { createWorkerPool } from './lib/worker-pool.mjs';
import { w3cAvailable } from './lib/w3c.mjs';
import { spellAvailable } from './lib/spell.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const RUNS = path.join(DATA, 'runs');
const PORT = +(process.env.PORT || 4580);
const HOST = process.env.HOST || '127.0.0.1';
const SERVER_MODE = HOST !== '127.0.0.1' && HOST !== 'localhost';
const MAX_DOMAINS = +(process.env.MAX_DOMAINS || 200);
const MAX_ACTIVE = +(process.env.MAX_ACTIVE_RUNS || (SERVER_MODE ? 1 : 3));
const ALLOWED_HOSTS = String(process.env.ALLOWED_HOSTS || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
fs.mkdirSync(RUNS, { recursive: true });

const auth = createAuth({ dir: DATA, envUser: process.env.AUTH_USER || '', envPass: process.env.AUTH_PASS || '', serverMode: SERVER_MODE });
if (SERVER_MODE && !auth.envAdminConfigured() && !auth.usersExist()) { console.error('Nyilvános címen (HOST=' + HOST + ') csak AUTH_USER és AUTH_PASS megadásával (vagy létező felhasználóval: node scripts/user.mjs) indítható.'); process.exit(1); }

const client = createClient({ blockPrivate: SERVER_MODE || process.env.BLOCK_PRIVATE === '1' });
const wporg = globalThis.__WPORG_MOCK__ || createWporg(client, path.join(DATA, 'wporg-cache.json'));
const pool = createWorkerPool({ urls: String(process.env.BROWSER_WORKERS || '').split(',').map(x => x.trim()).filter(Boolean), host: process.env.BROWSER_WORKER_HOST || '', token: process.env.WORKER_TOKEN || '' });
if (pool.enabled()) pool.start();

const SETTINGS_FILE = path.join(DATA, 'settings.json');
const DEFAULTS = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'default-settings.json'), 'utf8'));
const loadSettings = () => { try { const s = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); return { ...DEFAULTS, ...s, author: { ...DEFAULTS.author, ...s.author }, hours: { ...DEFAULTS.hours, ...s.hours } }; } catch { return structuredClone(DEFAULTS); } };
let settings = loadSettings();

const active = new Map(); // id -> Run
const loadRun = id => { if (!/^[\w-]+$/.test(id)) return null; if (active.has(id)) return active.get(id).data; try { return JSON.parse(fs.readFileSync(path.join(RUNS, id, 'run.json'), 'utf8')); } catch { return null; } };
const listRuns = user => fs.readdirSync(RUNS).filter(d => fs.existsSync(path.join(RUNS, d, 'run.json'))).sort().reverse().map(id => { const r = loadRun(id); return r && canSee(r, user) && { id, createdAt: r.createdAt, count: r.domains.length, finished: r.finished, name: r.options?.name || '' }; }).filter(Boolean).slice(0, 50);

// az adott domain legutóbbi, korábbi felmérése (összehasonlításhoz)
function findPrevious(currentId, domain) {
  let ids = []; try { ids = fs.readdirSync(RUNS).filter(x => /^[\w-]+$/.test(x) && x < currentId).sort().reverse().slice(0, 60); } catch {}
  for (const id of ids) {
    const r = loadRun(id); const res = r?.sites?.[domain]?.result;
    if (res && res.checkedAt && res.status !== 'blocked') return { runId: id, date: r.createdAt, result: res };
  }
  return null;
}

const stamp = () => new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
const activeCount = () => [...active.values()].filter(r => !r.data.finished).length;

// a felmérés beállításainak ellenőrzése (az API-ból és az ütemezésből is ide jön)
function cleanOptions(b) {
  const wh = String(b.webhookUrl || '').trim().slice(0, 500);
  return { name: String(b.name || '').slice(0, 80), gdpr: !!b.gdpr, lighthouse: !!b.lighthouse, geo: !!b.geo, a11y: !!b.a11y, a11yAll: !!b.a11yAll, a11yMax: Math.min(300, Math.max(5, Math.floor(+b.a11yMax) || 100)), links: !!b.links, w3c: b.w3c !== false, dns: b.dns !== false, ai: !!b.ai, suggest: !!b.suggest,
    suggestPages: Math.min(25, Math.max(1, Math.floor(+b.suggestPages) || 10)), geoPages: Math.min(50, Math.max(1, Math.floor(+b.geoPages) || 30)), spam: b.spam !== false,
    device: ['desktop', 'both'].includes(b.device) ? b.device : 'mobile', pages: Math.min(10, Math.max(0, Math.floor(+b.pages) || 0)), concurrency: Math.min(8, Math.max(1, +b.concurrency || 4)),
    webhookUrl: /^https?:\/\//i.test(wh) ? wh : '' };
}

// értesítés a felmérés végén (webhook): a Slack / Teams-kompatibilis „text” mező és a részletes JSON együtt
async function notifyRun(schedule, id) {
  const data = loadRun(id); if (!data) return;
  const url = schedule?.webhookUrl || data.options?.webhookUrl || process.env.WEBHOOK_URL || '';
  if (!url) return;
  const payload = buildAlertPayload(schedule, data);
  const explicit = schedule?.webhookUrl || data.options?.webhookUrl;
  // a globális WEBHOOK_URL és az ütemezések csak riasztáskor értesítenek (kivéve a „mindig értesítsen” beállítást); a kifejezetten kért webhook mindig
  if (!payload.alerts.length && !(schedule?.notifyAlways) && !(explicit && !schedule)) return;
  const r = await client.postJson(url, payload);
  if (!r.status || r.status >= 400) console.error(`Webhook sikertelen (${r.status || r.error}): ${url.replace(/\?.*$/, '')}`);
}

// felmérés indítása (kézi, ütemezett és API-s indítás közös útja)
function createRun({ name, text, clients = {}, options = {}, owner = null, scheduleId = null }) {
  const domains = parseDomains(text);
  if (!domains.length) throw Object.assign(new Error('Nincs érvényes domain.'), { status: 400 });
  if (domains.length > MAX_DOMAINS) throw Object.assign(new Error(`Legfeljebb ${MAX_DOMAINS} domain adható meg egyszerre.`), { status: 400 });
  if (activeCount() >= MAX_ACTIVE) throw Object.assign(new Error(`Legfeljebb ${MAX_ACTIVE} felmérés futhat egyszerre.`), { status: 429 });
  const id = stamp() + '-' + crypto.randomBytes(2).toString('hex');
  const opts = cleanOptions({ ...options, name: name ?? options.name });
  const cl = {}; if (clients && typeof clients === 'object') for (const d of domains) if (typeof clients[d] === 'string' && clients[d].trim()) cl[d] = clients[d].trim().slice(0, 80);
  const run = new Run({ id, dir: path.join(RUNS, id), domains, options: opts, client, wporg, settings, previousFor: d => findPrevious(id, d), clients: cl, owner, pool });
  if (scheduleId) run.data.scheduleId = scheduleId;
  active.set(id, run);
  run.on('done', () => setTimeout(() => { if (active.get(id) === run) active.delete(id); }, 30000));
  if (!scheduleId) run.once('done', () => notifyRun(null, id).catch(e => console.error('Értesítés sikertelen: ' + e.message)));
  run.start().catch(e => { run.data.error = e.message; run.data.finished = true; run.save(); run.emit('done', { id }); });
  return id;
}

const scheduler = createScheduler({
  file: path.join(DATA, 'schedules.json'),
  startRun: spec => createRun(spec),
  getRun: id => active.get(id),
  notify: (s, id) => notifyRun(s, id),
  log: m => console.error(m),
});
if (process.env.SCHEDULER !== '0') scheduler.start();

// a megszakadt (pl. konténer-újraindulás miatt félbemaradt) felmérések folytatása indításkor; legfeljebb 3 folytatás felmérésenként
function resumeInterrupted() {
  if (process.env.RESUME_RUNS === '0') return;
  let ids = []; try { ids = fs.readdirSync(RUNS); } catch {}
  for (const id of ids) {
    const r = loadRun(id); if (!r || r.finished || active.has(id)) continue;
    if ((r.resumed || 0) >= 3) { r.finished = true; r.error = 'Többszöri megszakadás után nem folytatható.'; try { fs.writeFileSync(path.join(RUNS, id, 'run.json'), JSON.stringify(r)); } catch {} continue; }
    const run = new Run({ id, dir: path.join(RUNS, id), domains: r.domains, options: r.options, client, wporg, settings, restored: r, previousFor: d => findPrevious(id, d), pool });
    active.set(id, run);
    run.on('done', () => setTimeout(() => { if (active.get(id) === run) active.delete(id); }, 30000));
    run.start().catch(e => { run.data.error = e.message; run.data.finished = true; run.save(); run.emit('done', { id }); });
    console.log('Megszakadt felmérés folytatása: ' + id);
  }
}

const MIME = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.png': 'image/png', '.ico': 'image/x-icon' };
// a felület csak saját forrásból tölthet be szkriptet; a stílus-attribútumokhoz 'unsafe-inline' kell a stílusoknál
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const send = (res, code, body, type = 'application/json; charset=utf-8', extra = {}) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': CSP, 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', ...extra }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)); };
const readBody = req => new Promise((ok, bad) => { let b = ''; req.on('data', c => { b += c; if (b.length > 2e6) { bad(Object.assign(new Error('túl nagy kérés'), { status: 413 })); req.destroy(); } }); req.on('end', () => { try { ok(b ? JSON.parse(b) : {}); } catch { bad(Object.assign(new Error('érvénytelen JSON'), { status: 400 })); } }); });
const fileName = (r, only, ext, kind) => `${[r.options?.name || 'felmeres', only?.length === 1 ? only[0] : ''].filter(Boolean).join('_').replace(/[^\p{L}\p{N}_-]+/gu, '_')}_${kind}_${r.createdAt.slice(0, 10)}.${ext}`;
const sidCookie = (req, sid, maxAge) => `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.COOKIE_SECURE === '1' || (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : ''}`;
const PUBLIC_PATHS = new Set(['/login.html', '/login.js', '/style.css', '/favicon.ico']);

const server = http.createServer(async (req, res) => {
  try {
    // Host-ellenőrzés (DNS-rebinding ellen): helyi módban csak a localhost-nevek; szerver módban az ALLOWED_HOSTS, ha meg van adva
    const reqHost = String(req.headers.host || '').toLowerCase();
    const hostName = reqHost.replace(/:\d+$/, '');
    const allowedHosts = ALLOWED_HOSTS.length ? ALLOWED_HOSTS : (SERVER_MODE ? null : LOCAL_HOSTS);
    if (allowedHosts && !allowedHosts.includes(hostName)) return send(res, 403, 'Nem engedélyezett Host', 'text/plain; charset=utf-8');
    const u = new URL(req.url, 'http://x');
    const p = u.pathname;
    const isLogin = p === '/api/login' && req.method === 'POST';

    // hitelesítés (a belépő oldal és a belépés végpontja nyilvános)
    let user = null, via = null, sid = null;
    if (!PUBLIC_PATHS.has(p) && !isLogin) {
      const a = auth.authenticate(req);
      if (a?.locked) return send(res, 429, { error: 'Túl sok hibás bejelentkezés, próbáld később.' });
      if (!a) {
        if (p.startsWith('/api/')) return send(res, 401, { error: 'Bejelentkezés szükséges', login: auth.usersExist() ? '/login.html' : null }, 'application/json; charset=utf-8', auth.envAdminConfigured() && !auth.usersExist() ? { 'www-authenticate': 'Basic realm="wp-site-audit"' } : {});
        if (auth.usersExist()) { res.writeHead(302, { location: '/login.html' }); return res.end(); }
        return send(res, 401, 'Bejelentkezés szükséges', 'text/plain; charset=utf-8', { 'www-authenticate': 'Basic realm="wp-site-audit"' });
      }
      ({ user, via, sid } = a);
    }
    // CSRF ellen: módosító kérés csak JSON tartalomtípussal (ezt idegen oldal preflight nélkül nem küldheti), és az Origin egyezzen a Host-tal.
    // Az API-kulcsos (Bearer) kérést nem a böngésző küldi magától, ezért arra nem vonatkozik.
    if (!['GET', 'HEAD'].includes(req.method) && via !== 'token') {
      if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) return send(res, 415, { error: 'Content-Type: application/json szükséges' });
      const origin = req.headers.origin;
      if (origin) { let oh = ''; try { oh = new URL(origin).host.toLowerCase(); } catch {} if (oh !== reqHost) return send(res, 403, { error: 'Idegen eredetű kérés' }); }
    }
    const isAdmin = user?.role === 'admin';
    const needAdmin = () => { if (!isAdmin) throw Object.assign(new Error('Ehhez adminisztrátori jogosultság kell.'), { status: 403 }); };

    // ---- belépés, kilépés, saját adatok
    if (isLogin) {
      const b = await readBody(req);
      const r = auth.login(b.name, b.password, req.socket.remoteAddress || '?');
      if (r?.locked) return send(res, 429, { error: 'Túl sok hibás bejelentkezés, próbáld később.' });
      if (!r) return send(res, 401, { error: 'Hibás név vagy jelszó.' });
      return send(res, 200, { user: r.user }, 'application/json; charset=utf-8', { 'set-cookie': sidCookie(req, r.sid, 12 * 3600) });
    }
    if (p === '/api/logout' && req.method === 'POST') { auth.logout(sid); return send(res, 200, { ok: true }, 'application/json; charset=utf-8', { 'set-cookie': sidCookie(req, '', 0) }); }
    if (p === '/api/me' && req.method === 'GET') return send(res, 200, { ...user, via, usersMode: auth.usersExist(), canLogout: via === 'session', workers: pool.enabled() ? pool.size() : 0, capabilities: { w3c: await w3cAvailable(), hunspell: await spellAvailable() } });

    // ---- felhasználók és API-kulcsok
    if (p === '/api/users' && req.method === 'GET') { needAdmin(); return send(res, 200, auth.listUsers()); }
    if (p === '/api/users' && req.method === 'POST') { needAdmin(); const b = await readBody(req); return send(res, 201, auth.addUser(b.name, b.password, b.role)); }
    let m;
    if ((m = p.match(/^\/api\/users\/([\w-]+)$/)) && req.method === 'DELETE') { needAdmin(); return send(res, auth.removeUser(m[1]) ? 200 : 404, { ok: true }); }
    if ((m = p.match(/^\/api\/users\/([\w-]+)\/password$/)) && req.method === 'PUT') { if (!isAdmin && user.id !== m[1]) needAdmin(); const b = await readBody(req); return send(res, auth.setPassword(m[1], b.password) ? 200 : 404, { ok: true }); }
    if (p === '/api/tokens' && req.method === 'GET') return send(res, 200, auth.listTokens(isAdmin ? null : user.id));
    if (p === '/api/tokens' && req.method === 'POST') { const b = await readBody(req); return send(res, 201, auth.createToken(user.id, b.name)); }
    if ((m = p.match(/^\/api\/tokens\/([\w-]+)$/)) && req.method === 'DELETE') return send(res, auth.revokeToken(m[1], isAdmin ? null : user.id) ? 200 : 404, { ok: true });

    // ---- beállítások (írni csak az admin tud)
    if (p === '/api/ai/status' && req.method === 'GET') return send(res, 200, await aiStatus());
    if (p === '/api/settings' && req.method === 'GET') return send(res, 200, settings);
    if (p === '/api/settings' && req.method === 'PUT') {
      needAdmin();
      const b = await readBody(req);
      const str = (v, n = 200) => String(v ?? '').slice(0, n);
      const next = structuredClone(settings);
      if (b.author && typeof b.author === 'object') for (const k of ['name', 'company', 'email', 'phone']) if (k in b.author) next.author[k] = str(b.author[k]);
      if ('senderOrg' in b) next.senderOrg = str(b.senderOrg);
      if ('showHours' in b) next.showHours = !!b.showHours;
      if ('hourlyRate' in b) next.hourlyRate = Math.min(1e7, Math.max(0, +b.hourlyRate || 0));
      if ('vatPercent' in b) next.vatPercent = Math.min(100, Math.max(0, +b.vatPercent || 0));
      if ('currency' in b) next.currency = str(b.currency, 8) || 'Ft';
      if ('brandColor' in b) next.brandColor = /^#[0-9a-f]{6}$/i.test(String(b.brandColor)) ? String(b.brandColor).toLowerCase() : '#1f3864';
      if ('logo' in b) next.logo = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(String(b.logo)) && String(b.logo).length <= 400000 ? String(b.logo) : '';
      if (b.hours && typeof b.hours === 'object') for (const k of Object.keys(DEFAULTS.hours)) if (k in b.hours) next.hours[k] = Math.min(1000, Math.max(0, +b.hours[k] || 0));
      settings = next;
      fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2));
      return send(res, 200, settings);
    }
    if (p === '/api/settings/reset' && req.method === 'POST') { needAdmin(); settings = structuredClone(DEFAULTS); try { fs.unlinkSync(SETTINGS_FILE); } catch {} return send(res, 200, settings); }
    if (p === '/api/parse' && req.method === 'POST') { const b = await readBody(req); return send(res, 200, { domains: parseDomains(b.text) }); }

    // ---- ütemezések (mindenki a sajátját látja, az admin mindet)
    if (p === '/api/schedules' && req.method === 'GET') return send(res, 200, scheduler.list().filter(s => isAdmin || !s.owner || s.owner === user.id));
    if (p === '/api/schedules' && req.method === 'POST') {
      const b = await readBody(req);
      if (!parseDomains(b.text).length) return send(res, 400, { error: 'Nincs érvényes domain.' });
      return send(res, 201, scheduler.add({ ...b, options: cleanOptions(b.options || {}) }, user.id));
    }
    const ownSched = id => { const s = scheduler.get(id); return s && (isAdmin || !s.owner || s.owner === user.id) ? s : null; };
    if ((m = p.match(/^\/api\/schedules\/([\w-]+)$/)) && req.method === 'PUT') { if (!ownSched(m[1])) return send(res, 404, {}); const b = await readBody(req); if ('options' in b) b.options = cleanOptions(b.options || {}); return send(res, 200, scheduler.update(m[1], b)); }
    if ((m = p.match(/^\/api\/schedules\/([\w-]+)$/)) && req.method === 'DELETE') { if (!ownSched(m[1])) return send(res, 404, {}); scheduler.remove(m[1]); return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/schedules\/([\w-]+)\/run$/)) && req.method === 'POST') { if (!ownSched(m[1])) return send(res, 404, {}); const id = await scheduler.runNow(m[1]); return id ? send(res, 201, { id }) : send(res, 409, { error: 'Az ütemezés már fut, vagy nem indítható.' }); }

    // ---- felmérések
    if (p === '/api/runs' && req.method === 'GET') return send(res, 200, listRuns(user));
    if (p === '/api/runs' && req.method === 'POST') {
      const b = await readBody(req);
      const id = createRun({ name: b.name, text: b.text, clients: b.clients, options: b, owner: user.id });
      return send(res, 201, { id });
    }
    const mine = id => { const r = loadRun(id); return r && canSee(r, user) ? r : null; };
    if ((m = p.match(/^\/api\/runs\/([\w-]+)$/)) && req.method === 'GET') { const r = mine(m[1]); return r ? send(res, 200, r) : send(res, 404, { error: 'nincs ilyen felmérés' }); }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)$/)) && req.method === 'DELETE') {
      const id = m[1]; if (!mine(id)) return send(res, 404, {});
      const a = active.get(id); if (a) { a.cancelled = true; active.delete(id); }
      fs.rmSync(path.join(RUNS, id), { recursive: true, force: true }); return send(res, 200, { ok: true });
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/cancel$/)) && req.method === 'POST') { if (!mine(m[1])) return send(res, 404, {}); const a = active.get(m[1]); if (a) a.cancelled = true; return send(res, 200, { ok: true }); }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/reanalyze$/)) && req.method === 'POST') {
      const r = mine(m[1]); if (!r) return send(res, 404, {});
      for (const s of Object.values(r.sites)) if (s.result) analyze(s.result, settings);
      fs.writeFileSync(path.join(RUNS, m[1], 'run.json'), JSON.stringify(r)); return send(res, 200, r);
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/events$/))) {
      if (!mine(m[1])) return send(res, 404, {});
      const run = active.get(m[1]);
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
      const ev = (e, d) => res.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`);
      const snap = loadRun(m[1]); ev('snapshot', snap);
      if (!run || run.data.finished) { ev('done', {}); return res.end(); }
      const onSite = s => ev('site', s), onLog = l => ev('log', l), onDone = () => { ev('done', {}); cleanup(); res.end(); };
      const ka = setInterval(() => res.write(': ka\n\n'), 20000);
      const cleanup = () => { clearInterval(ka); run.off('site', onSite); run.off('log', onLog); run.off('done', onDone); };
      run.on('site', onSite); run.on('log', onLog); run.on('done', onDone); req.on('close', cleanup);
      return;
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/shot\/([\w.-]+\.jpg)$/))) {
      if (!mine(m[1])) return send(res, 404, '');
      const f = path.join(RUNS, m[1], m[2]); if (!f.startsWith(path.join(RUNS, m[1]) + path.sep)) return send(res, 400, '');
      return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), 'image/jpeg') : send(res, 404, '');
    }
    if ((m = p.match(/^\/api\/runs\/([\w-]+)\/export\/(xlsx|javaslatok|emailek|html|pdf|csv)$/))) {
      const r = mine(m[1]); if (!r) return send(res, 404, {});
      const only = (u.searchParams.get('sites') || '').split(',').filter(Boolean);
      const view = only.length ? { ...r, sites: Object.fromEntries(Object.entries(r.sites).filter(([d]) => only.includes(d))) } : r;
      const opts = { settings, shotDir: path.join(RUNS, m[1]) };
      const dl = (ext, kind) => ({ 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName(r, only, ext, kind))}` });
      if (m[2] === 'xlsx') return send(res, 200, await exportXlsx(view, opts), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', dl('xlsx', 'felmeres'));
      if (m[2] === 'javaslatok') return send(res, 200, await exportProposals(view, opts), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dl('docx', 'javitasi_javaslatok'));
      if (m[2] === 'emailek') return send(res, 200, await exportEmails(view, opts), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dl('docx', 'sablon_emailek'));
      if (m[2] === 'pdf') return send(res, 200, await renderPdf(exportHtml(view, { ...opts, print: true })), 'application/pdf', dl('pdf', 'riport'));
      if (m[2] === 'csv') return send(res, 200, exportCsv(view), 'text/csv; charset=utf-8', dl('csv', 'javasolt_szovegek'));
      return send(res, 200, exportHtml(view, opts), 'text/html; charset=utf-8', dl('html', 'riport'));
    }
    if (p.startsWith('/api/')) return send(res, 404, { error: 'ismeretlen végpont' });

    // ---- statikus UI
    const f = path.join(ROOT, 'public', p === '/' ? 'index.html' : p);
    if (!f.startsWith(path.join(ROOT, 'public') + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'Nem található', 'text/plain; charset=utf-8');
    return send(res, 200, fs.readFileSync(f), MIME[path.extname(f)] || 'application/octet-stream');
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Szerverhiba' });
  }
});

server.listen(PORT, HOST, () => {
  resumeInterrupted();
  const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/`;
  console.log(`WP Site Audit fut: ${url}`);
  if (!SERVER_MODE && process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open ${url}` : `xdg-open ${url}`;
    import('node:child_process').then(cp => cp.exec(cmd));
  }
});
export default server;
