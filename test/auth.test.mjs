import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAuth, hashPassword, verifyPassword, canSee } from '../lib/auth.mjs';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wpa-auth-'));
const req = (headers = {}, ip = '1.2.3.4') => ({ headers, socket: { remoteAddress: ip } });
const basic = (n, p) => 'Basic ' + Buffer.from(`${n}:${p}`).toString('base64');

test('jelszó-hash: egyedi só, helyes ellenőrzés, hibás formátum elutasítva', () => {
  const a = hashPassword('titkos-jelszo-123'), b = hashPassword('titkos-jelszo-123');
  assert.notEqual(a, b, 'minden hash más sóval készül');
  assert.equal(verifyPassword('titkos-jelszo-123', a), true); assert.equal(verifyPassword('rossz', a), false);
  assert.equal(verifyPassword('x', 'nem-hash'), false); assert.equal(verifyPassword('x', undefined), false);
});

test('felhasználó felvétele: ellenőrzések, egyedi név, utolsó admin védelme', () => {
  const au = createAuth({ dir: tmp() });
  assert.throws(() => au.addUser('a', 'hosszujelszo123'), /2–40/);
  assert.throws(() => au.addUser('anna', 'rovid'), /10 karakter/);
  assert.throws(() => au.addUser('anna', 'hosszujelszo123', 'root'), /szerepkör/);
  const anna = au.addUser('Anna', 'hosszujelszo123', 'admin');
  assert.throws(() => au.addUser('anna', 'masikjelszo123'), /már van/);
  const bela = au.addUser('bela', 'hosszujelszo456', 'user');
  assert.throws(() => au.removeUser(anna.id), /utolsó admin/);
  assert.equal(au.removeUser(bela.id), true);
  assert.equal(au.listUsers().length, 1); assert.equal(au.listUsers()[0].hash, undefined, 'a hash nem kerül ki a listába');
});

test('belépés: sikeres, hibás, kis- és nagybetű, kizárás sok hiba után', () => {
  const au = createAuth({ dir: tmp() });
  au.addUser('anna', 'hosszujelszo123', 'admin');
  const ok = au.login('ANNA', 'hosszujelszo123', '9.9.9.9');
  assert.ok(ok.sid && ok.user.name === 'anna');
  assert.equal(au.login('anna', 'rossz', '8.8.8.8'), null);
  assert.equal(au.login('nincs', 'bármi', '8.8.8.8'), null);
  for (let i = 0; i < 10; i++) au.login('anna', 'rossz', '7.7.7.7');
  assert.deepEqual(au.login('anna', 'hosszujelszo123', '7.7.7.7'), { locked: true }, '10 hiba után a helyes jelszó sem ér semmit');
  assert.ok(au.login('anna', 'hosszujelszo123', '6.6.6.6').sid, 'másik címről működik');
});

test('munkamenet: lejárat, kilépés, jelszócsere után megszűnik', () => {
  let t = 1_000_000;
  const au = createAuth({ dir: tmp(), now: () => t });
  const u = au.addUser('anna', 'hosszujelszo123', 'admin');
  const { sid } = au.login('anna', 'hosszujelszo123', 'ip1');
  assert.equal(au.sessionUser(sid).name, 'anna');
  t += 11 * 3600 * 1000; assert.ok(au.sessionUser(sid), 'a használat meghosszabbítja');
  t += 13 * 3600 * 1000; assert.equal(au.sessionUser(sid), null, '12 óra tétlenség után lejár');
  const s2 = au.login('anna', 'hosszujelszo123', 'ip1').sid; au.logout(s2); assert.equal(au.sessionUser(s2), null);
  const s3 = au.login('anna', 'hosszujelszo123', 'ip1').sid; au.setPassword(u.id, 'ujjelszo-ujjelszo'); assert.equal(au.sessionUser(s3), null);
  assert.ok(au.login('anna', 'ujjelszo-ujjelszo', 'ip1').sid);
  assert.equal(au.sessionUser('nemletezo'), null);
});

test('munkamenetek és felhasználók újraindítás után is megvannak (fájlból), a sütiérték nem szerepel a fájlban', () => {
  const dir = tmp();
  const a1 = createAuth({ dir }); a1.addUser('anna', 'hosszujelszo123', 'admin');
  const { sid } = a1.login('anna', 'hosszujelszo123', 'ip');
  const a2 = createAuth({ dir });
  assert.equal(a2.sessionUser(sid).name, 'anna');
  assert.ok(!fs.readFileSync(path.join(dir, 'sessions.json'), 'utf8').includes(sid), 'csak a hash van eltárolva');
  assert.ok(!fs.readFileSync(path.join(dir, 'users.json'), 'utf8').includes('hosszujelszo123'));
});

test('API-kulcs: létrehozás, használat, visszavonás; csak a hash tárolt', () => {
  const dir = tmp(); const au = createAuth({ dir });
  const u = au.addUser('anna', 'hosszujelszo123', 'admin');
  const { token, id } = au.createToken(u.id, 'CRM');
  assert.match(token, /^wsa_/);
  assert.ok(!fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8').includes(token));
  assert.equal(au.authenticate(req({ authorization: `Bearer ${token}` })).via, 'token');
  assert.equal(au.authenticate(req({ authorization: 'Bearer wsa_rossz' })), null);
  assert.equal(au.listTokens(u.id)[0].lastUsed != null, true);
  assert.equal(au.revokeToken(id, 'masik-felhasznalo'), false); assert.equal(au.revokeToken(id, u.id), true);
  assert.equal(au.authenticate(req({ authorization: `Bearer ${token}` })), null);
});

test('hitelesítési módok: nyitott helyi, környezeti Basic, felhasználói Basic, süti', () => {
  assert.equal(createAuth({ dir: tmp() }).authenticate(req()).via, 'open', 'helyi, felhasználó nélkül: nyitott');
  assert.equal(createAuth({ dir: tmp(), serverMode: true }).authenticate(req()), null, 'szerver módban sosem nyitott');
  const env = createAuth({ dir: tmp(), envUser: 'admin', envPass: 'env-jelszo-123' });
  assert.equal(env.authenticate(req()), null);
  assert.equal(env.authenticate(req({ authorization: basic('admin', 'env-jelszo-123') })).user.role, 'admin');
  assert.equal(env.authenticate(req({ authorization: basic('admin', 'rossz') })), null);
  const au = createAuth({ dir: tmp(), envUser: 'admin', envPass: 'env-jelszo-123' });
  au.addUser('bela', 'hosszujelszo456', 'user');
  assert.equal(au.authenticate(req()), null, 'felhasználó létrejötte után a helyi mód is zárt');
  assert.equal(au.authenticate(req({ authorization: basic('bela', 'hosszujelszo456') })).user.name, 'bela');
  const { sid } = au.login('bela', 'hosszujelszo456', 'x');
  assert.equal(au.authenticate(req({ cookie: `egyeb=1; sid=${sid}` })).via, 'session');
  assert.equal(au.login('admin', 'env-jelszo-123', 'y').user.role, 'admin', 'a környezeti belépés a belépő oldalon is működik');
});

test('láthatóság: admin mindent, felhasználó a sajátját és a tulajdonos nélkülit', () => {
  const admin = { id: 'a', role: 'admin' }, bela = { id: 'b', role: 'user' }, cili = { id: 'c', role: 'user' };
  assert.equal(canSee({ owner: 'b' }, admin), true); assert.equal(canSee({ owner: 'b' }, bela), true); assert.equal(canSee({ owner: 'b' }, cili), false);
  assert.equal(canSee({}, cili), true, 'régi, tulajdonos nélküli felmérés'); assert.equal(canSee({ owner: 'b' }, null), false);
});

test('a más folyamat (CLI) által felvett felhasználót és kulcsot a futó példány is észreveszi', () => {
  const dir = tmp();
  const server = createAuth({ dir });
  assert.equal(server.usersExist(), false); assert.equal(server.openMode(), true);
  const cli = createAuth({ dir }); // a parancssori eszköz külön folyamat, ugyanazon a könyvtáron
  const u = cli.addUser('anna', 'hosszujelszo123', 'admin');
  assert.equal(server.usersExist(), true, 'a futó példány látja az új felhasználót');
  assert.equal(server.openMode(), false);
  const { sid } = server.login('anna', 'hosszujelszo123', 'ip');
  assert.equal(server.sessionUser(sid).name, 'anna');
  cli.setPassword(u.id, 'masik-jelszo-12345'); // a CLI jelszócseréje a futó példány munkameneteit is megszünteti
  assert.equal(server.sessionUser(sid), null);
  const { token } = cli.createToken(u.id, 'cli-kulcs');
  assert.equal(server.authenticate(req({ authorization: `Bearer ${token}` })).via, 'token');
});
