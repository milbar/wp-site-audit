// Ütemezett felmérések: napi / heti / havi futtatás, és riasztás (webhook), ha az előző felméréshez képest romlás történt
import fs from 'node:fs';
import crypto from 'node:crypto';
import { alertsFor } from './compare.mjs';

export const EVERY = ['daily', 'weekly', 'monthly'];

// a következő futás időpontja (a szerver helyi ideje szerint; a TZ környezeti változóval állítható)
export function nextRun(s, from = new Date()) {
  const [hh, mm] = String(s.time || '06:00').split(':').map(n => +n || 0);
  const d = new Date(from); d.setSeconds(0, 0); d.setHours(hh, mm, 0, 0);
  if (s.every === 'weekly') {
    const wd = Number.isInteger(s.weekday) ? s.weekday : 1; // 0 = vasárnap
    d.setDate(d.getDate() + ((wd - d.getDay() + 7) % 7));
    if (d <= from) d.setDate(d.getDate() + 7);
  } else if (s.every === 'monthly') {
    const md = Math.min(28, Math.max(1, +s.monthday || 1));
    d.setDate(md);
    if (d <= from) { d.setMonth(d.getMonth() + 1); d.setDate(md); }
  } else if (d <= from) d.setDate(d.getDate() + 1);
  return d;
}

// bemenet ellenőrzése (az API-ból érkezik): ismert kulcsok, korlátok
export function cleanSchedule(b, existing = {}) {
  const str = (v, n) => String(v ?? '').trim().slice(0, n);
  const out = { ...existing };
  out.name = str(b.name ?? out.name, 80) || 'Ütemezett felmérés';
  if ('text' in b) out.text = str(b.text, 100000);
  if ('clients' in b && b.clients && typeof b.clients === 'object') out.clients = Object.fromEntries(Object.entries(b.clients).slice(0, 500).map(([k, v]) => [str(k, 255), str(v, 80)]));
  if ('options' in b && b.options && typeof b.options === 'object') {
    const o = b.options;
    out.options = { gdpr: !!o.gdpr, lighthouse: !!o.lighthouse, geo: !!o.geo, a11y: !!o.a11y, links: !!o.links, w3c: o.w3c !== false, dns: o.dns !== false, ai: !!o.ai, suggest: !!o.suggest, spam: o.spam !== false,
      device: ['desktop', 'both'].includes(o.device) ? o.device : 'mobile', pages: Math.min(10, Math.max(0, Math.floor(+o.pages) || 0)), geoPages: Math.min(50, Math.max(1, Math.floor(+o.geoPages) || 30)),
      suggestPages: Math.min(25, Math.max(1, Math.floor(+o.suggestPages) || 10)), concurrency: Math.min(8, Math.max(1, Math.floor(+o.concurrency) || 4)) };
  }
  if ('every' in b) out.every = EVERY.includes(b.every) ? b.every : 'weekly';
  if ('time' in b) out.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(b.time)) ? String(b.time) : '06:00';
  if ('weekday' in b) out.weekday = Math.min(6, Math.max(0, Math.floor(+b.weekday) || 0));
  if ('monthday' in b) out.monthday = Math.min(28, Math.max(1, Math.floor(+b.monthday) || 1));
  if ('webhookUrl' in b) { const u = str(b.webhookUrl, 500); out.webhookUrl = /^https?:\/\//i.test(u) ? u : ''; }
  if ('notifyAlways' in b) out.notifyAlways = !!b.notifyAlways;
  if ('enabled' in b) out.enabled = !!b.enabled;
  out.every ||= 'weekly'; out.time ||= '06:00'; out.options ||= {}; out.enabled ??= true;
  return out;
}

export function createScheduler({ file, startRun, getRun, notify, now = () => new Date(), log = () => {} }) {
  let list = []; try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(list, null, 2)); } catch (e) { log('Az ütemezés mentése sikertelen: ' + e.message); } };
  const withNext = s => ({ ...s, nextRunAt: s.enabled ? nextRun(s, now()).toISOString() : null });
  let timer = null; const running = new Set();

  async function runNow(s) {
    if (running.has(s.id)) return null;
    running.add(s.id);
    try {
      const id = await startRun({ name: s.name, text: s.text, clients: s.clients, options: { ...s.options, webhookUrl: s.webhookUrl || '' }, scheduleId: s.id, owner: s.owner || null });
      s.lastRunAt = now().toISOString(); s.lastRunId = id; save();
      // az eredményre várva riasztunk
      const run = getRun(id);
      if (run) run.once('done', () => { running.delete(s.id); Promise.resolve(notify(s, id)).catch(e => log('Értesítés sikertelen: ' + e.message)); });
      else running.delete(s.id);
      return id;
    } catch (e) { running.delete(s.id); log('Ütemezett felmérés indítása sikertelen: ' + e.message); return null; }
  }

  return {
    list: () => list.map(withNext),
    get: id => list.find(s => s.id === id),
    add(b, owner = null) { const s = cleanSchedule(b); s.owner = owner; s.id = crypto.randomBytes(4).toString('hex'); s.createdAt = now().toISOString(); s.nextDue = nextRun(s, now()).toISOString(); list.push(s); save(); return withNext(s); },
    update(id, b) { const i = list.findIndex(s => s.id === id); if (i < 0) return null; list[i] = cleanSchedule(b, list[i]); list[i].nextDue = nextRun(list[i], now()).toISOString(); save(); return withNext(list[i]); },
    remove(id) { const n = list.length; list = list.filter(s => s.id !== id); save(); return list.length < n; },
    runNow: id => { const s = list.find(x => x.id === id); return s ? runNow(s) : null; },
    // egy időzítő-ütem: lefuttatja az esedékes ütemezéseket (tesztelhető)
    async tick() {
      for (const s of list) {
        if (!s.enabled || running.has(s.id)) continue;
        if (!s.nextDue) s.nextDue = nextRun(s, now()).toISOString();
        if (new Date(s.nextDue) <= now()) {
          const id = await runNow(s);
          // ha az indítás nem sikerült (pl. épp fut a megengedett számú felmérés), 15 perc múlva újra próbáljuk, a következő esedékes nap helyett
          s.nextDue = (id ? nextRun(s, now()) : new Date(now().getTime() + 15 * 60000)).toISOString(); save();
        }
      }
    },
    start(ms = 60000) { if (!timer) { timer = setInterval(() => this.tick().catch(e => log('Ütemező hiba: ' + e.message)), ms); timer.unref?.(); } },
    stop() { clearInterval(timer); timer = null; },
  };
}

// riasztási szöveg a felmérés eredményéből: domainenként a romlások (az előző felméréshez képest)
export function buildAlertPayload(schedule, runData) {
  const alerts = [];
  for (const s of Object.values(runData.sites || {})) {
    const R = s.result; if (!R) continue;
    const msgs = alertsFor(R.compare, R);
    if (R.status === 'blocked') msgs.push('A bot-védelem blokkolta a mérést.');
    if (R.status === 'down' && !msgs.length) msgs.push('Az oldal nem érhető el.');
    if (msgs.length) alerts.push({ domain: s.domain, client: s.client || '', messages: msgs });
  }
  const lines = alerts.map(a => `• ${a.domain}${a.client ? ' (' + a.client + ')' : ''}: ${a.messages.join(' ')}`);
  const title = schedule ? `Ütemezett felmérés: ${schedule.name}` : `Felmérés: ${runData.options?.name || runData.id}`;
  return {
    text: alerts.length ? `${title}\n${alerts.length} domainnél romlás vagy figyelmeztetés:\n${lines.join('\n')}` : `${title}\nNincs új romlás vagy figyelmeztetés (${Object.keys(runData.sites || {}).length} domain).`,
    runId: runData.id, schedule: schedule ? { id: schedule.id, name: schedule.name } : null, alerts, domains: Object.keys(runData.sites || {}).length, finishedAt: runData.finishedAt || null,
  };
}
