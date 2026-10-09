import test from 'node:test';
import assert from 'node:assert/strict';
import { probeSite } from '../lib/probe.mjs';
import { analyze } from '../lib/rules.mjs';
import { isChallenge } from '../lib/challenge.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const settings = JSON.parse(fs.readFileSync(path.join(path.dirname(path.dirname(fileURLToPath(import.meta.url))), 'config', 'default-settings.json'), 'utf8'));
const challengePage = '<html><head><title>One moment, please...</title></head><body>Checking your browser</body></html>';

test('védelmi oldal felismerése', () => {
  assert.equal(isChallenge({ status: 200, body: challengePage }), true);
  assert.equal(isChallenge({ status: 200, body: '<title>Kis türelmet…</title>' }), true);
  assert.equal(isChallenge({ status: 403, body: '<html>Attention: cloudflare ray id</html>' }), true);
  assert.equal(isChallenge({ status: 200, body: '<title>Kezdőlap</title>' }), false);
  assert.equal(isChallenge({ status: 404, body: '<title>Nem található</title>' }), false);
  assert.equal(isChallenge({ status: 0, body: '' }), false);
});

test('tartós bot-védelem: újrapróbálás után „blocked” állapot és javaslat', async () => {
  let homeCalls = 0;
  const client = {
    tryGet: async (url) => { homeCalls++; return { status: 200, body: challengePage, headers: {}, finalUrl: url, chain: [], bytes: 100, ttfb: 10 }; },
    tryRaw: async () => ({ status: 200, body: '', headers: {} }),
    cert: async () => ({ authorized: true, issuer: 'Teszt', daysLeft: 50 }),
  };
  const R = await probeSite('vedett.example', { client, wporg: {}, challengeWaits: [0, 0] });
  assert.equal(R.status, 'blocked');
  assert.equal(homeCalls, 3, 'az első lekérés + 2 újrapróbálás');
  assert.match(R.reach.blockedBy, /One moment/);
  analyze(R, settings);
  assert.ok(R.findings.some(f => f.id === 'blocked' && f.group === 'info'));
  assert.equal(R.totals.kotelezo, 0, 'nem becsülhető munkaigény');
});

test('átmeneti védelem: az újrapróbálás után a valódi oldalt méri', async () => {
  let n = 0;
  const real = '<html><head><title>Valódi oldal</title></head><body>tartalom</body></html>';
  const client = {
    tryGet: async (url) => { n++; return { status: 200, body: n === 1 ? challengePage : real, headers: {}, finalUrl: url, chain: [], bytes: 100, ttfb: 10 }; },
    tryRaw: async () => ({ status: 404, body: '', headers: {} }),
    cert: async () => ({ authorized: true }),
  };
  const R = await probeSite('atmeneti.example', { client, wporg: { core: async () => null }, spamScan: false, challengeWaits: [0, 0] });
  assert.notEqual(R.status, 'blocked');
});
