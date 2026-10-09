import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { nextRun, cleanSchedule, createScheduler, buildAlertPayload } from '../lib/scheduler.mjs';

const at = (s) => new Date(s); // helyi idő szerinti dátum-szöveg

test('következő futás: naponta', () => {
  assert.equal(nextRun({ every: 'daily', time: '06:00' }, at('2026-03-10T05:00:00')).getTime(), at('2026-03-10T06:00:00').getTime(), 'ma még előttünk van');
  assert.equal(nextRun({ every: 'daily', time: '06:00' }, at('2026-03-10T06:00:00')).getTime(), at('2026-03-11T06:00:00').getTime(), 'pont a futás idején a következő nap');
  assert.equal(nextRun({ every: 'daily', time: '23:30' }, at('2026-03-10T23:45:00')).getTime(), at('2026-03-11T23:30:00').getTime());
});
test('következő futás: hetente (0 = vasárnap) és havonta', () => {
  // 2026-03-10 kedd
  assert.equal(nextRun({ every: 'weekly', weekday: 1, time: '07:15' }, at('2026-03-10T10:00:00')).getTime(), at('2026-03-16T07:15:00').getTime(), 'a következő hétfő');
  assert.equal(nextRun({ every: 'weekly', weekday: 2, time: '12:00' }, at('2026-03-10T10:00:00')).getTime(), at('2026-03-10T12:00:00').getTime(), 'ma, ha a nap egyezik és még nem telt le');
  assert.equal(nextRun({ every: 'weekly', weekday: 2, time: '08:00' }, at('2026-03-10T10:00:00')).getTime(), at('2026-03-17T08:00:00').getTime(), 'ma már lejárt: jövő hét');
  assert.equal(nextRun({ every: 'weekly', weekday: 0, time: '09:00' }, at('2026-03-10T10:00:00')).getTime(), at('2026-03-15T09:00:00').getTime(), 'vasárnap');
  assert.equal(nextRun({ every: 'monthly', monthday: 15, time: '06:00' }, at('2026-03-10T10:00:00')).getTime(), at('2026-03-15T06:00:00').getTime());
  assert.equal(nextRun({ every: 'monthly', monthday: 5, time: '06:00' }, at('2026-03-10T10:00:00')).getTime(), at('2026-04-05T06:00:00').getTime(), 'a hónap napja már elmúlt');
  assert.equal(nextRun({ every: 'monthly', monthday: 31, time: '06:00' }, at('2026-01-31T10:00:00')).getTime(), at('2026-02-28T06:00:00').getTime(), 'legfeljebb a 28. (februárban is létezik)');
});

test('ütemezés ellenőrzése: ismeretlen kulcsok kihullanak, értékek korlátosak', () => {
  const s = cleanSchedule({ name: 'x'.repeat(200), text: 'a.hu', every: 'hetente?', time: '25:99', weekday: 99, monthday: 99, webhookUrl: 'javascript:alert(1)', evil: '<x>', options: { gdpr: 1, device: 'tablet', pages: 99, geoPages: 0, concurrency: 99, ai: 'igen' } });
  assert.equal(s.name.length, 80); assert.equal(s.every, 'weekly'); assert.equal(s.time, '06:00'); assert.equal(s.weekday, 6); assert.equal(s.monthday, 28);
  assert.equal(s.webhookUrl, ''); assert.equal(s.evil, undefined);
  assert.deepEqual([s.options.device, s.options.pages, s.options.geoPages, s.options.concurrency, s.options.ai, s.options.gdpr], ['mobile', 10, 30, 8, true, true]);
  assert.equal(cleanSchedule({ webhookUrl: 'https://hooks.example.com/x' }).webhookUrl, 'https://hooks.example.com/x');
});

test('az ütemező az esedékes ütemezést elindítja, a következőt későbbre teszi, a sikertelent 15 perc múlva újrapróbálja', async () => {
  let clock = at('2026-03-10T05:59:00').getTime();
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sch-')), 's.json');
  const started = [], runs = new Map(); let fail = false, notified = [];
  const sch = createScheduler({ file, now: () => new Date(clock),
    startRun: spec => { if (fail) throw new Error('épp fut a megengedett számú felmérés'); const id = 'run' + (started.length + 1); started.push(spec); runs.set(id, new EventEmitter()); return id; },
    getRun: id => runs.get(id), notify: (s, id) => notified.push([s.name, id]), log: () => {} });
  const s = sch.add({ name: 'Heti', text: 'a.hu', every: 'daily', time: '06:00' }, 'anna');
  await sch.tick(); assert.equal(started.length, 0, '06:00 előtt nem fut');
  clock = at('2026-03-10T06:00:30').getTime();
  await sch.tick(); assert.equal(started.length, 1); assert.equal(started[0].owner, 'anna'); assert.equal(started[0].scheduleId, s.id);
  await sch.tick(); assert.equal(started.length, 1, 'ugyanaz a futás nem indul kétszer');
  runs.get('run1').emit('done'); await new Promise(r => setTimeout(r, 5));
  assert.deepEqual(notified, [['Heti', 'run1']], 'a futás végén értesítés');
  assert.equal(new Date(sch.get(s.id).nextDue).getTime(), at('2026-03-11T06:00:00').getTime(), 'a következő nap 06:00');
  clock = at('2026-03-11T06:00:10').getTime(); fail = true;
  await sch.tick(); assert.equal(started.length, 1, 'az indítás elbukott');
  assert.equal(new Date(sch.get(s.id).nextDue).getTime(), clock + 15 * 60000, '15 perc múlva újrapróbálja');
  fail = false; clock += 16 * 60000; await sch.tick(); assert.equal(started.length, 2);
  // újraindítás: az ütemezések fájlból megvannak
  const sch2 = createScheduler({ file, startRun() {}, getRun() {}, notify() {} });
  assert.equal(sch2.list().length, 1); assert.equal(sch2.remove(s.id), true); assert.equal(sch2.list().length, 0);
});

test('szüneteltetett ütemezés nem fut; riasztás-összeállítás a romlásokból', async () => {
  let clock = at('2026-03-10T06:30:00').getTime(); let n = 0;
  const sch = createScheduler({ file: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sch-')), 's.json'), now: () => new Date(clock), startRun: () => 'r' + (++n), getRun: () => null, notify() {}, log: () => {} });
  const s = sch.add({ name: 'x', text: 'a.hu', every: 'daily', time: '06:00', enabled: false });
  clock = at('2026-03-12T06:30:00').getTime(); await sch.tick(); assert.equal(n, 0);
  sch.update(s.id, { enabled: true }); clock = at('2026-03-14T06:30:00').getTime(); await sch.tick(); assert.equal(n, 1);

  const run = { id: 'r1', options: { name: 'Havi' }, finishedAt: 'x', sites: {
    'a.hu': { domain: 'a.hu', client: 'Kovács Kft.', result: { status: 'ok', flags: {}, cert: { daysLeft: 5 }, compare: { deltas: [{ key: 'geo', label: 'GEO', prev: 90, cur: 60, delta: -30 }], newFindings: [{ id: 'z', title: 'Új hiba', sev: 'kritikus' }], resolvedFindings: [] } } },
    'b.hu': { domain: 'b.hu', result: { status: 'ok', flags: {}, compare: { deltas: [], newFindings: [], resolvedFindings: [] } } },
    'c.hu': { domain: 'c.hu', result: { status: 'blocked' } } } };
  const p = buildAlertPayload({ id: 's1', name: 'Havi' }, run);
  assert.deepEqual(p.alerts.map(a => a.domain), ['a.hu', 'c.hu']);
  assert.match(p.text, /a\.hu \(Kovács Kft\.\)/); assert.match(p.text, /GEO-pont 30 ponttal/); assert.match(p.text, /SSL/);
  assert.equal(p.schedule.id, 's1');
  const quiet = buildAlertPayload(null, { id: 'r2', options: {}, sites: { 'b.hu': run.sites['b.hu'] } });
  assert.equal(quiet.alerts.length, 0); assert.match(quiet.text, /Nincs új romlás/);
});
