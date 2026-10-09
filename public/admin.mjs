// Adminisztrációs felület: saját fiók, felhasználók (admin), API-kulcsok, ütemezések
const DAYS = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
const EVERY_HU = { daily: 'naponta', weekly: 'hetente', monthly: 'havonta' };

export function initAdmin({ $, api, esc, formBody }) {
  let me = null;
  const dt = iso => (iso ? new Date(iso).toLocaleString('hu-HU', { dateStyle: 'short', timeStyle: 'short' }) : '–');

  async function loadMe() {
    try { me = await api('/api/me'); } catch { return null; }
    const who = $('#who');
    if (me.usersMode || me.via === 'session') { who.textContent = `${me.name} (${me.role === 'admin' ? 'admin' : 'felhasználó'})`; who.classList.remove('hidden'); }
    $('#btnLogout').classList.toggle('hidden', !me.canLogout);
    if (me.role !== 'admin') { for (const id of ['#sSave', '#sReset']) $(id).disabled = true; $('#accessNote').textContent = 'A beállításokat csak adminisztrátor módosíthatja.'; }
    return me;
  }
  $('#btnLogout').addEventListener('click', async () => { try { await api('/api/logout', { method: 'POST' }); } catch {} location.href = '/login.html'; });

  // ---- hozzáférés a beállítások ablakban: API-kulcsok mindenkinek, felhasználók az adminnak
  async function renderAccess() {
    const box = $('#accessBox'); if (!box) return;
    let html = '';
    try {
      const tokens = await api('/api/tokens');
      html += `<h4>API-kulcsok</h4><p class="hint">Programból (pl. <code>Authorization: Bearer …</code>) indíthatsz felmérést és kérheted le az eredményt. A kulcs csak létrehozáskor látszik.</p>
        <ul class="acl">${tokens.map(t => `<li><span><b>${esc(t.name)}</b> <small>${esc(dt(t.createdAt))}${t.lastUsed ? ', utoljára: ' + esc(dt(t.lastUsed)) : ''}</small></span><button type="button" class="ghost" data-revoke="${esc(t.id)}">Visszavonás</button></li>`).join('') || '<li class="hint">Még nincs API-kulcs.</li>'}</ul>
        <div class="row"><input id="tkName" type="text" placeholder="A kulcs neve (pl. CRM)" maxlength="60"><button type="button" class="ghost" id="tkAdd">Új API-kulcs</button></div><div id="tkShow" class="hint"></div>`;
    } catch {}
    if (me?.role === 'admin') {
      try {
        const users = await api('/api/users');
        html += `<h4>Felhasználók</h4><ul class="acl">${users.map(u => `<li><span><b>${esc(u.name)}</b> <small>${esc(u.role)}</small></span><span><button type="button" class="ghost" data-pw="${esc(u.id)}">Új jelszó</button> <button type="button" class="ghost" data-deluser="${esc(u.id)}">Törlés</button></span></li>`).join('') || '<li class="hint">Még nincs felhasználó: a belépés jelenleg a környezeti változós (AUTH_USER) jelszóval vagy nyitva működik.</li>'}</ul>
          <div class="row"><input id="uName" type="text" placeholder="Név" maxlength="40"><input id="uPass" type="password" placeholder="Jelszó (legalább 10 karakter)" autocomplete="new-password"><select id="uRole"><option value="user">felhasználó</option><option value="admin">admin</option></select><button type="button" class="ghost" id="uAdd">Hozzáadás</button></div>
          <p class="hint">A felhasználók csak a saját felméréseiket látják, az admin mindet.</p>`;
      } catch {}
    }
    box.innerHTML = html;
  }
  document.addEventListener('click', async e => {
    const t = e.target.closest?.('button'); if (!t) return;
    try {
      if (t.dataset.revoke) { await api('/api/tokens/' + t.dataset.revoke, { method: 'DELETE' }); renderAccess(); }
      else if (t.id === 'tkAdd') { const r = await api('/api/tokens', { method: 'POST', body: JSON.stringify({ name: $('#tkName').value }) }); await renderAccess(); $('#tkShow').innerHTML = `Új kulcs (most másold ki, később nem látható): <code>${esc(r.token)}</code>`; }
      else if (t.dataset.deluser) { if (confirm('Biztosan törlöd a felhasználót?')) { await api('/api/users/' + t.dataset.deluser, { method: 'DELETE' }); renderAccess(); } }
      else if (t.dataset.pw) { const pw = prompt('Új jelszó (legalább 10 karakter):'); if (pw) { await api(`/api/users/${t.dataset.pw}/password`, { method: 'PUT', body: JSON.stringify({ password: pw }) }); alert('A jelszó megváltozott.'); } }
      else if (t.id === 'uAdd') { await api('/api/users', { method: 'POST', body: JSON.stringify({ name: $('#uName').value, password: $('#uPass').value, role: $('#uRole').value }) }); await loadMe(); renderAccess(); }
    } catch (ex) { alert(ex.message); }
  });

  // ---- ütemezések
  async function renderSchedules() {
    const list = await api('/api/schedules');
    $('#schedList').innerHTML = list.length ? list.map(s => `<li><div><b>${esc(s.name)}</b> <small>${esc(EVERY_HU[s.every] || s.every)}${s.every === 'weekly' ? ', ' + esc(DAYS[s.weekday ?? 1]) : s.every === 'monthly' ? ', ' + (s.monthday || 1) + '.' : ''}, ${esc(s.time)}</small>
        <div class="meta">következő: ${esc(dt(s.nextRunAt))} · utolsó: ${esc(dt(s.lastRunAt))}${s.webhookUrl ? ' · webhook' : ''}${s.enabled ? '' : ' · szüneteltetve'}</div></div>
        <div><button class="ghost" type="button" data-srun="${esc(s.id)}">Futtatás most</button> ${s.lastRunId ? `<a class="btn" href="#${esc(s.lastRunId)}" data-sopen="${esc(s.lastRunId)}">Utolsó eredmény</a> ` : ''}<button class="ghost" type="button" data-stoggle="${esc(s.id)}" data-en="${s.enabled ? 1 : 0}">${s.enabled ? 'Szünet' : 'Folytatás'}</button> <button class="ghost" type="button" data-sdel="${esc(s.id)}">Törlés</button></div></li>`).join('') : '<li class="empty">Még nincs ütemezett felmérés. Az „Új felmérés” űrlapon, az „Ütemezés” résznél hozhatsz létre egyet.</li>';
  }
  $('#btnSched').addEventListener('click', async () => { try { await renderSchedules(); } catch (ex) { alert(ex.message); return; } $('#dlgSched').showModal(); });
  $('#schClose').addEventListener('click', () => $('#dlgSched').close());
  $('#dlgSched').addEventListener('click', async e => {
    const t = e.target.closest('button,a'); if (!t) return;
    try {
      if (t.dataset.srun) { await api(`/api/schedules/${t.dataset.srun}/run`, { method: 'POST' }); await renderSchedules(); alert('A felmérés elindult. Az eredményt a „Korábbi felmérések” között találod.'); }
      else if (t.dataset.sdel) { if (confirm('Törlöd az ütemezést?')) { await api('/api/schedules/' + t.dataset.sdel, { method: 'DELETE' }); renderSchedules(); } }
      else if (t.dataset.stoggle) { await api('/api/schedules/' + t.dataset.stoggle, { method: 'PUT', body: JSON.stringify({ enabled: t.dataset.en !== '1' }) }); renderSchedules(); }
      else if (t.dataset.sopen) { $('#dlgSched').close(); location.hash = t.dataset.sopen; location.reload(); }
    } catch (ex) { alert(ex.message); }
  });
  $('#schEvery').addEventListener('change', () => { const v = $('#schEvery').value; $('#schWeekdayRow').classList.toggle('hidden', v !== 'weekly'); $('#schMonthdayRow').classList.toggle('hidden', v !== 'monthly'); });
  $('#btnSchedSave').addEventListener('click', async () => {
    const f = formBody();
    if (!f.text.trim()) { alert('Előbb adj meg domaineket az űrlapon.'); return; }
    try {
      const { text, clients, name, webhookUrl, ...options } = f;
      await api('/api/schedules', { method: 'POST', body: JSON.stringify({ name: name || 'Ütemezett felmérés', text, clients, options, webhookUrl: $('#optWebhook').value, every: $('#schEvery').value, weekday: +$('#schWeekday').value, monthday: +$('#schMonthday').value || 1, time: $('#schTime').value || '06:00', notifyAlways: $('#schAlways').checked }) });
      alert('Az ütemezés elmentve. Az „Ütemezések” gombbal kezelheted.');
    } catch (ex) { alert(ex.message); }
  });
  return { loadMe, renderAccess };
}
