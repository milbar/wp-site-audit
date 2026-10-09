import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResults, alertsFor } from '../lib/compare.mjs';
import { compareHtml } from '../public/compare-ui.mjs';

const mk = (o = {}) => ({ status: 'ok', wp: { version: '6.1' }, server: { php: { ver: '8.1' } }, geo: { score: 80 }, lighthouse: { perf: 70 }, plugins: [{ outdated: true }, { outdated: true }, {}], flags: { critical: 1, high: 1 }, totals: { kotelezo: 6 }, findings: [{ id: 'a', title: 'Régi hiba', sev: 'magas' }, { id: 'b', title: 'Marad', sev: 'közepes' }], ...o });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('az összehasonlítás kiszámolja a változásokat és az új / megoldott hibákat', () => {
  const prev = mk();
  const cur = mk({ geo: { score: 92 }, lighthouse: { perf: 55 }, plugins: [{ outdated: true }], flags: { critical: 0, high: 1 }, totals: { kotelezo: 4 }, wp: { version: '6.5' },
    findings: [{ id: 'b', title: 'Marad', sev: 'közepes' }, { id: 'c', title: 'Új hiba', sev: 'kritikus' }] });
  const c = compareResults(cur, prev, { runId: 'r1', date: '2026-01-01T00:00:00Z' });
  const d = k => c.deltas.find(x => x.key === k);
  assert.equal(d('geo').delta, 12); assert.equal(d('geo').better, true);
  assert.equal(d('lhm').delta, -15); assert.equal(d('lhm').better, false);
  assert.equal(d('outdated').delta, -1); assert.equal(d('outdated').better, true);
  assert.equal(d('crit').delta, -1); assert.equal(d('hours').delta, -2);
  assert.equal(d('wp').text, true); assert.equal(d('wp').cur, '6.5');
  assert.deepEqual(c.newFindings.map(f => f.id), ['c']);
  assert.deepEqual(c.resolvedFindings.map(f => f.id), ['a']);
  assert.match(c.summary, /1 hiba megoldódott, 1 új/);
});

test('hiányzó mérés nem ad hamis változást, hiányzó előző felmérés null', () => {
  assert.equal(compareResults(mk(), null), null);
  const c = compareResults(mk({ geo: undefined }), mk());
  assert.equal(c.deltas.find(x => x.key === 'geo'), undefined);
});

test('riasztás: nagy romlás, új súlyos hiba, közelgő SSL-lejárat', () => {
  const prev = mk(), cur = mk({ geo: { score: 60 }, lighthouse: { perf: 40 }, cert: { daysLeft: 5 }, findings: [{ id: 'z', title: 'Feltört', sev: 'kritikus' }] });
  const a = alertsFor(compareResults(cur, prev), cur);
  assert.ok(a.some(x => /GEO-pont 20 ponttal/.test(x))); assert.ok(a.some(x => /Lighthouse/.test(x)));
  assert.ok(a.some(x => /Új kritikus/.test(x))); assert.ok(a.some(x => /SSL/.test(x)));
  assert.deepEqual(alertsFor(null, cur), []);
});

test('a változás-blokk HTML-je escape-el és jelöli az irányt', () => {
  const cur = mk({ findings: [{ id: 'x', title: '<img src=x onerror=alert(1)>', sev: 'magas' }] });
  const R = { compare: compareResults(cur, mk(), { date: '2026-01-01' }) };
  const h = compareHtml(R, { esc });
  assert.ok(!h.includes('<img'), 'a hibacím escape-elve van');
  assert.match(h, /&lt;img/);
  assert.equal(compareHtml({}, { esc }), '');
});
