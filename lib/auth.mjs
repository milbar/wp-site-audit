// Hitelesítés: felhasználók (jelszó-hash), munkamenet-sütik, API-kulcsok (Bearer) és a környezeti változós alap-belépés (Basic)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const SESSION_TTL = 12 * 3600 * 1000, SESSION_MAX = 7 * 24 * 3600 * 1000;

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${crypto.scryptSync(String(pw), salt, 64).toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  const [alg, s, h] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !s || !h) return false;
  try { return eq(crypto.scryptSync(String(pw), Buffer.from(s, 'base64'), 64).toString('base64'), h); } catch { return false; }
}

export function createAuth({ dir, envUser = '', envPass = '', serverMode = false, now = () => Date.now() }) {
  const read = (f, d) => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch { return d; } };
  const stamp = f => { try { return fs.statSync(path.join(dir, f)).mtimeMs; } catch { return 0; } };
  const seen = {};
  const write = (f, v) => { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, f), JSON.stringify(v, null, 2), { mode: 0o600 }); seen[f] = stamp(f); };
  let users = read('users.json', []), tokens = read('tokens.json', []);
  let sessions = read('sessions.json', {}); // sid-hash → { userId, created, seen }
  for (const f of ['users.json', 'tokens.json', 'sessions.json']) seen[f] = stamp(f);
  // más folyamat (pl. a scripts/user.mjs parancssori eszköz) is módosíthatja a fájlokat: változáskor újraolvassuk őket, így nem kell újraindítani a szervert
  const fresh = () => {
    if (stamp('users.json') !== seen['users.json']) { users = read('users.json', []); seen['users.json'] = stamp('users.json'); }
    if (stamp('tokens.json') !== seen['tokens.json']) { tokens = read('tokens.json', []); seen['tokens.json'] = stamp('tokens.json'); }
    if (stamp('sessions.json') !== seen['sessions.json']) { sessions = read('sessions.json', {}); seen['sessions.json'] = stamp('sessions.json'); }
  };
  const fails = new Map(); // ip → { n, t }
  const envAdmin = envUser && envPass ? { id: 'env', name: envUser, role: 'admin' } : null;
  const pub = u => ({ id: u.id, name: u.name, role: u.role, createdAt: u.createdAt });
  const saveUsers = () => write('users.json', users), saveTokens = () => write('tokens.json', tokens);
  const saveSessions = () => { const cutoff = now() - SESSION_MAX; for (const k of Object.keys(sessions)) if (sessions[k].created < cutoff || sessions[k].seen < now() - SESSION_TTL) delete sessions[k]; write('sessions.json', sessions); };

  const locked = ip => { const f = fails.get(ip); return !!(f && f.n >= 10 && now() - f.t < 10 * 60 * 1000); };
  const fail = ip => { const f = fails.get(ip); fails.set(ip, { n: (f && now() - f.t < 10 * 60 * 1000 ? f.n : 0) + 1, t: now() }); };

  const api = {
    usersExist: () => users.length > 0,
    openMode: () => !serverMode && !envAdmin && users.length === 0, // helyi, egyfelhasználós használat: nincs belépés
    envAdminConfigured: () => !!envAdmin,
    isLocked: locked,

    // ---- felhasználók
    listUsers: () => users.map(pub),
    addUser(name, password, role = 'user') {
      name = String(name || '').trim();
      if (!/^[\p{L}\p{N}._@-]{2,40}$/u.test(name)) throw Object.assign(new Error('A név 2–40 karakter, betű, szám, pont, kötőjel, aláhúzás vagy @ lehet.'), { status: 400 });
      if (String(password || '').length < 10) throw Object.assign(new Error('A jelszó legalább 10 karakter legyen.'), { status: 400 });
      if (!['admin', 'user'].includes(role)) throw Object.assign(new Error('A szerepkör admin vagy user lehet.'), { status: 400 });
      if (users.some(u => u.name.toLowerCase() === name.toLowerCase())) throw Object.assign(new Error('Ilyen nevű felhasználó már van.'), { status: 409 });
      const u = { id: crypto.randomBytes(6).toString('hex'), name, role, hash: hashPassword(password), createdAt: new Date(now()).toISOString() };
      users.push(u); saveUsers(); return pub(u);
    },
    removeUser(id) {
      const u = users.find(x => x.id === id); if (!u) return false;
      if (u.role === 'admin' && users.filter(x => x.role === 'admin').length === 1) throw Object.assign(new Error('Az utolsó adminisztrátor nem törölhető.'), { status: 400 });
      users = users.filter(x => x.id !== id); tokens = tokens.filter(t => t.userId !== id);
      for (const k of Object.keys(sessions)) if (sessions[k].userId === id) delete sessions[k];
      saveUsers(); saveTokens(); saveSessions(); return true;
    },
    setPassword(id, password) {
      const u = users.find(x => x.id === id); if (!u) return false;
      if (String(password || '').length < 10) throw Object.assign(new Error('A jelszó legalább 10 karakter legyen.'), { status: 400 });
      u.hash = hashPassword(password);
      for (const k of Object.keys(sessions)) if (sessions[k].userId === id) delete sessions[k]; // jelszócsere után minden munkamenet megszűnik
      saveUsers(); saveSessions(); return true;
    },

    // ---- belépés és munkamenet
    login(name, password, ip) {
      if (locked(ip)) return { locked: true };
      if (envAdmin && eq(String(name || '').trim(), envUser) && eq(password || '', envPass)) { // a környezeti változós alap-belépés a belépő oldalon is használható
        fails.delete(ip);
        const sid = crypto.randomBytes(32).toString('base64url'); sessions[sha(sid)] = { userId: 'env', created: now(), seen: now() }; saveSessions();
        return { sid, user: envAdmin };
      }
      const u = users.find(x => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
      // a hash-ellenőrzés akkor is lefut, ha nincs ilyen felhasználó (időzítésből ne derüljön ki a név)
      const ok = verifyPassword(password, u?.hash || 'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA');
      if (!u || !ok) { fail(ip); return null; }
      fails.delete(ip);
      const sid = crypto.randomBytes(32).toString('base64url');
      sessions[sha(sid)] = { userId: u.id, created: now(), seen: now() }; saveSessions();
      return { sid, user: pub(u) };
    },
    logout(sid) { if (sid && sessions[sha(sid)]) { delete sessions[sha(sid)]; saveSessions(); } },
    sessionUser(sid) {
      const s = sid && sessions[sha(sid)]; if (!s) return null;
      if (now() - s.seen > SESSION_TTL || now() - s.created > SESSION_MAX) { delete sessions[sha(sid)]; saveSessions(); return null; }
      s.seen = now();
      if (s.userId === 'env') return envAdmin;
      const u = users.find(x => x.id === s.userId); return u ? pub(u) : null;
    },

    // ---- API-kulcsok
    createToken(userId, name) {
      const token = 'wsa_' + crypto.randomBytes(24).toString('base64url');
      const t = { id: crypto.randomBytes(4).toString('hex'), userId, name: String(name || 'API-kulcs').slice(0, 60), hash: sha(token), createdAt: new Date(now()).toISOString(), lastUsed: null };
      tokens.push(t); saveTokens(); return { id: t.id, name: t.name, token };
    },
    listTokens: userId => tokens.filter(t => !userId || t.userId === userId).map(t => ({ id: t.id, userId: t.userId, name: t.name, createdAt: t.createdAt, lastUsed: t.lastUsed })),
    revokeToken(id, userId) { const n = tokens.length; tokens = tokens.filter(t => !(t.id === id && (!userId || t.userId === userId))); if (tokens.length < n) { saveTokens(); return true; } return false; },
    tokenUser(token) {
      const h = sha(token); const t = tokens.find(x => eq(x.hash, h)); if (!t) return null;
      t.lastUsed = new Date(now()).toISOString();
      if (t.userId === 'env') return envAdmin;
      const u = users.find(x => x.id === t.userId); return u ? pub(u) : null;
    },

    // ---- a kérés hitelesítése: { user, via } vagy null
    authenticate(req) {
      const ip = req.socket?.remoteAddress || '?';
      if (api.openMode()) return { user: { id: 'local', name: 'helyi', role: 'admin' }, via: 'open' };
      if (locked(ip)) return { locked: true };
      const h = String(req.headers.authorization || '');
      if (/^Bearer /i.test(h)) {
        const u = api.tokenUser(h.slice(7).trim());
        if (u) return { user: u, via: 'token' }; fail(ip); return null;
      }
      const cookie = (String(req.headers.cookie || '').match(/(?:^|;\s*)sid=([A-Za-z0-9_-]+)/) || [])[1];
      if (cookie) { const u = api.sessionUser(cookie); if (u) return { user: u, via: 'session', sid: cookie }; }
      if (/^Basic /i.test(h)) {
        const [name, ...rest] = Buffer.from(h.slice(6), 'base64').toString('utf8').split(':'); const pw = rest.join(':');
        if (envAdmin && eq(name, envUser) && eq(pw, envPass)) { fails.delete(ip); return { user: envAdmin, via: 'basic' }; }
        const u = users.find(x => x.name.toLowerCase() === name.toLowerCase());
        if (u && verifyPassword(pw, u.hash)) { fails.delete(ip); return { user: pub(u), via: 'basic' }; }
        fail(ip);
      }
      return null;
    },
  };
  for (const k of Object.keys(api)) { const fn = api[k]; api[k] = (...a) => { fresh(); return fn(...a); }; }
  return api;
}

// az adott felhasználó láthatja-e a felmérést (az admin mindet; a régi, tulajdonos nélküli felmérések mindenkinek láthatók)
export const canSee = (runData, user) => !!user && (user.role === 'admin' || !runData?.owner || runData.owner === user.id);
