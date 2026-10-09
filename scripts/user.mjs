// Felhasználókezelés a parancssorból (a Docker-konténerben: docker compose exec wp-site-audit node scripts/user.mjs ...)
//   node scripts/user.mjs add <név> <jelszó> [admin|user]
//   node scripts/user.mjs list
//   node scripts/user.mjs passwd <név> <új jelszó>
//   node scripts/user.mjs remove <név>
// Az adatkönyvtárat a DATA_DIR környezeti változó adja (alapértelmezés: ./data).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAuth } from '../lib/auth.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const auth = createAuth({ dir: path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data')) });
const [cmd, name, pass, role] = process.argv.slice(2);
const byName = n => auth.listUsers().find(u => u.name.toLowerCase() === String(n || '').toLowerCase());
const fail = m => { console.error(m); process.exit(1); };
try {
  if (cmd === 'add') {
    if (!name || !pass) fail('Használat: node scripts/user.mjs add <név> <jelszó> [admin|user]');
    const u = auth.addUser(name, pass, role || (auth.usersExist() ? 'user' : 'admin'));
    console.log(`Felhasználó létrehozva: ${u.name} (${u.role})`);
  } else if (cmd === 'list') {
    const l = auth.listUsers(); if (!l.length) console.log('Nincs felhasználó.'); for (const u of l) console.log(`${u.name}\t${u.role}\t${u.createdAt}`);
  } else if (cmd === 'passwd') {
    const u = byName(name); if (!u) fail('Nincs ilyen felhasználó.');
    auth.setPassword(u.id, pass); console.log('A jelszó megváltozott, a meglévő munkamenetek megszűntek.');
  } else if (cmd === 'remove') {
    const u = byName(name); if (!u) fail('Nincs ilyen felhasználó.');
    auth.removeUser(u.id); console.log('Törölve.');
  } else fail('Parancsok: add, list, passwd, remove');
} catch (e) { fail(e.message); }
