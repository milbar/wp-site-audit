import test from 'node:test';
import assert from 'node:assert/strict';
import { inRange, wpvulnAffecting, wpvulnVulns, collectVulns, vulnsEnabled } from '../lib/vulns.mjs';

test('WPVulnerability: verziótartomány-illesztés (lt, le, ge, gt, tartomány nélkül)', () => {
  const op = (min, mino, max, maxo) => ({ min_version: min, min_operator: mino, max_version: max, max_operator: maxo });
  assert.equal(inRange(op(null, null, '3.6.3', 'lt'), '3.6.2'), true);
  assert.equal(inRange(op(null, null, '3.6.3', 'lt'), '3.6.3'), false, '„< 3.6.3”: a 3.6.3 már javított');
  assert.equal(inRange(op(null, null, '3.6.3', 'le'), '3.6.3'), true, '„<= 3.6.3”: a 3.6.3 még érintett');
  assert.equal(inRange(op('4.3.0', 'ge', '4.3.2', 'lt'), '4.3.1'), true);
  assert.equal(inRange(op('4.3.0', 'ge', '4.3.2', 'lt'), '4.2.9'), false);
  assert.equal(inRange(op('4.3.0', 'gt', '4.3.2', 'lt'), '4.3.0'), false, 'gt: a határérték nem érintett');
  assert.equal(inRange(op(null, null, null, null), '1.0'), false, 'tartomány nélküli rekord nem találat');
  assert.equal(inRange(null, '1.0'), false);
});

test('WPVulnerability: találatok súlyosság szerint, CVE-vel, javított verzióval, HTML-entitások nélkül', () => {
  const rec = (name, max, mo, sev, cve, unfixed = '0') => ({
    uuid: name, name, operator: { min_version: null, min_operator: null, max_version: max, max_operator: mo, unfixed },
    impact: { cvss3: { severity: sev, score: sev === 'critical' ? '9.8' : '5.4' } },
    source: [{ id: 'abc123', name: 'Patchstack bejegyzés', description: 'x' }, ...(cve ? [{ id: cve, name: cve, link: 'https://www.cve.org/CVERecord?id=' + cve, description: '[en] Fájlfeltöltés &#8211; veszélyes' }] : [])],
  });
  const v = [rec('kozepes', '3.0', 'lt', 'medium', 'CVE-2020-1'), rec('kritikus', '3.0', 'lt', 'critical', 'CVE-2020-2'), rec('mar-javitott', '1.0', 'lt', 'high', 'CVE-2019-9'),
    rec('javitatlan', '9.9', 'le', 'high', 'CVE-2021-3', '1'), rec('le-tartomany', '2.5', 'le', 'low', 'CVE-2021-4'), rec('ismetlodo', '3.0', 'lt', 'medium', 'CVE-2020-1')];
  const a = wpvulnAffecting(v, '2.0');
  assert.deepEqual(a.map(x => x.cve[0]), ['CVE-2020-2', 'CVE-2021-3', 'CVE-2020-1', 'CVE-2021-4'], 'súlyosság szerint, az ismétlődő CVE egyszer');
  assert.equal(a[0].severity, 'kritikus'); assert.equal(a[0].fixedIn, '3.0'); assert.equal(a[0].cvss, 9.8);
  const unfixed = a.find(x => x.cve[0] === 'CVE-2021-3'); assert.equal(unfixed.unfixed, true); assert.equal(unfixed.fixedIn, null);
  assert.equal(a.find(x => x.cve[0] === 'CVE-2021-4').fixedAfter, '2.5');
  assert.ok(!a[0].title.includes('&#8211;') && !a[0].title.startsWith('[en]'), a[0].title);
});

test('WPVulnerability: lekérdezés, gyorsítótár, részleges és teljes hiba', async () => {
  const resp = { error: 0, data: { vulnerability: [{ uuid: 'u1', name: 'X', operator: { max_version: '2.0', max_operator: 'lt', unfixed: '0' }, impact: { cvss3: { severity: 'high' } }, source: [{ id: 'CVE-2022-1', name: 'CVE-2022-1', description: 'hiba' }] }] } };
  let calls = 0; const mem = new Map();
  const cache = { get: k => mem.get(k), set: (k, v) => mem.set(k, v) };
  const client = { tryGet: async url => {
    calls++;
    if (/plugin\/rossz\//.test(url)) return { status: 500, body: '' };
    if (/plugin\/ures\//.test(url)) return { status: 200, body: JSON.stringify({ error: 0, data: { vulnerability: null } }) };
    return { status: 200, body: JSON.stringify(resp) };
  } };
  const R = { plugins: [{ slug: 'regi', name: 'Régi', version: '1.0' }, { slug: 'ures', name: 'Üres', version: '1.0' }, { slug: 'rossz', name: 'Rossz', version: '1.0' }, { slug: 'nincs-verzio', name: 'N' }], theme: [{ slug: 'tema', name: 'Téma', version: '1.5' }] };
  const out = await wpvulnVulns(client, R, { cache });
  assert.equal(out.items.length, 2, 'a régi plugin és a téma érintett');
  assert.deepEqual(out.items.map(i => i.source), ['WPVulnerability', 'WPVulnerability']);
  assert.equal(out.limited, true, 'egy lekérdezés hibás volt: a lista hiányos lehet');
  assert.equal(calls, 4, 'a verzió nélküli komponens nem kerül lekérdezésre');
  const before = calls; await wpvulnVulns(client, R, { cache });
  assert.equal(calls, before + 1, 'csak a hibás (nem gyorsítótárazott) lekérdezés ismétlődik');
  const down = await wpvulnVulns({ tryGet: async () => ({ status: 0, body: '', error: 'timeout' }) }, R, {});
  assert.match(down.error, /nem érhető el/); assert.equal(down.items, undefined);
  assert.deepEqual(await wpvulnVulns(client, { plugins: [], theme: [] }, {}), { source: 'WPVulnerability', items: [], limited: false, requests: 0 });
});

test('összevont ellenőrzés: kulcs nélkül csak WPVulnerability, kulccsal egyesít, a WPScan hibája nem rontja el', async () => {
  const wpv = { error: 0, data: { vulnerability: [{ uuid: 'u', name: 'X', operator: { max_version: '2.0', max_operator: 'lt', unfixed: '0' }, impact: {}, source: [{ id: 'CVE-2022-1', name: 'CVE-2022-1', description: 'közös hiba' }] }] } };
  const scan = { regi: { vulnerabilities: [{ id: 1, title: 'közös hiba', fixed_in: '2.0', references: { cve: ['2022-1'] } }, { id: 2, title: 'csak a WPScan-ben', fixed_in: '2.0', references: { cve: ['2022-9'] } }] } };
  const client = { tryGet: async url => (url.includes('wpvulnerability.net') ? { status: 200, body: JSON.stringify(wpv) } : url.includes('/plugins/regi') ? { status: 200, body: JSON.stringify(scan) } : { status: 404, body: '' }) };
  const R = { wp: { version: '6.5' }, plugins: [{ slug: 'regi', name: 'Régi', version: '1.0' }], theme: [] };
  delete process.env.WPSCAN_API_TOKEN; delete process.env.VULN_CHECK;
  try {
    const only = await collectVulns(client, R, {});
    assert.equal(only.source, 'WPVulnerability'); assert.equal(only.items.length, 1);
    process.env.WPSCAN_API_TOKEN = 'teszt';
    const both = await collectVulns(client, R, {});
    assert.equal(both.source, 'WPVulnerability + WPScan'); assert.equal(both.items.length, 2, 'a közös CVE egyszer szerepel');
    assert.deepEqual(both.items.map(i => i.source).sort(), ['WPScan', 'WPVulnerability']);
    const badKey = await collectVulns({ tryGet: async url => (url.includes('wpvulnerability.net') ? { status: 200, body: JSON.stringify(wpv) } : { status: 401, body: '' }) }, R, {});
    assert.equal(badKey.items.length, 1); assert.match(badKey.note || '', /WPScan/);
    process.env.VULN_CHECK = '0'; assert.equal(vulnsEnabled(), false);
  } finally { delete process.env.WPSCAN_API_TOKEN; delete process.env.VULN_CHECK; }
  assert.equal(vulnsEnabled(), true, 'alapból be van kapcsolva');
});
