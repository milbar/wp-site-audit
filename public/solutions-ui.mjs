// A „Javasolt megoldások” blokk HTML-je: a felület oldalpanelje és a html-riport közösen használja.
// interactive: másolás gombok (csak a felületen); a riportban statikus szöveg.
const fmtS = ms => String(+(ms / 1000).toFixed(1)).replace('.', ',');

export function solHtml(R, { esc, interactive = false } = {}) {
  const sol = R.solutions || {}, ai = R.aiSuggest || null;
  const meta = (ai && !ai.error && ai.meta) || [], faq = (ai && !ai.error && ai.faq) || [];
  const has = meta.length || faq.length || sol.speed?.length || sol.jsonld || sol.llms || ai?.speedText || ai?.error;
  if (!has) return '';
  const copy = txt => (interactive ? `<button type="button" class="cp" data-copy="${esc(txt)}" title="Másolás a vágólapra">Másolás</button>` : '');
  const code = (txt, label) => `<div class="codebox"><div class="codehead"><span>${esc(label)}</span>${interactive ? `<button type="button" class="cp" data-copy-pre="1">Másolás</button>` : ''}</div><pre>${esc(txt)}</pre></div>`;
  let h = '<h4 class="grp">Javasolt megoldások <span class="hint">vázlat, átnézendő</span></h4>';
  if (ai?.error) h += `<p class="hint">${esc(ai.error)}</p>`;

  if (meta.length) {
    const spellNote = m => (m.spell?.length ? ` <span class="chip c-warn" title="A Hunspell magyar szótár nem ismeri ezeket a szavakat">helyesírás ellenőrizendő: ${esc(m.spell.join(', '))}</span>` : (m.spellChecked ? ' <span class="chip c-ok" title="A magyar szótár nem talált hibát">helyesírás rendben</span>' : ''));
    const fieldTag = f => (f === 'title' ? '<span class="ftag ftag-t">TITLE</span><small class="sub">oldalcím</small>' : '<span class="ftag ftag-d">DESCRIPTION</span><small class="sub">meta leírás</small>');
    const lenChip = (len, ok) => `<span class="chip ${ok ? 'c-ok' : 'c-warn'}" title="${ok ? 'a hossz megfelelő' : 'a hossz nem esik a javasolt tartományba'}">${len} kar.</span>`;
    h += '<h5>Címek és leírások (MI-vázlat)</h5>';
    h += `<div class="wrapx"><table class="mini"><thead><tr><th>Oldal</th><th>Mező</th><th>Jelenlegi</th><th>Javasolt</th></tr></thead><tbody>${meta.map(m => {
      const rows = [];
      if (m.title.needed) rows.push(`<tr><td title="${esc(m.url)}">${esc(m.path)}</td><td>${fieldTag('title')}</td><td>${esc(m.title.old || '(hiányzik)')}<small class="sub">${[...(m.title.old || '')].length} kar.</small></td><td><b>${esc(m.title.new)}</b> ${lenChip(m.title.len, m.title.ok)}${spellNote(m)} ${copy(m.title.new)}</td></tr>`);
      if (m.desc.needed) rows.push(`<tr><td title="${esc(m.url)}">${esc(m.path)}</td><td>${fieldTag('description')}</td><td>${esc(m.desc.old || '(hiányzik)')}<small class="sub">${[...(m.desc.old || '')].length} kar.</small></td><td>${esc(m.desc.new)} ${lenChip(m.desc.len, m.desc.ok)} ${copy(m.desc.new)}</td></tr>`);
      return rows.join('');
    }).join('')}</tbody></table></div>`;
    h += '<p class="hint">A javaslatok az oldal szövegéből készültek; tényt nem tartalmazhatnak, de a stílust és a pontosságot ember nézze át. A sárga hossz-jelzés azt jelenti, hogy a modell háromszori próbára sem találta el a tartományt.</p>';
  }

  if (sol.speed?.length || ai?.speedText) {
    h += '<h5>Sebesség: konkrét teendők</h5>';
    if (ai?.speedText) h += `<div class="verdict"><b>Javasolt sorrend (MI)</b><p style="white-space:pre-line">${esc(ai.speedText)}</p></div>`;
    for (const c of sol.speedContext || []) h += `<p class="hint">${esc(c)}</p>`;
    h += (sol.speed || []).map(s => `<div class="fix"><b>${esc(s.topic)}</b>${s.savingsMs ? ` <span class="hint">(a Lighthouse becslése: kb. ${fmtS(s.savingsMs)} s nyereség)</span>` : ''}<p>${esc(s.why)}</p><ul>${s.steps.map(x => `<li>${esc(x)}</li>`).join('')}</ul>${s.seen?.length ? `<small class="sub">Érintett: ${esc(s.seen.join(', '))}</small>` : ''}</div>`).join('');
  }

  if (sol.jsonld || sol.llms || faq.length) {
    h += '<h5>GEO: kész vázlatok</h5>';
    if (sol.jsonld) h += code(sol.jsonld.json, 'Organization JSON-LD') + `<p class="hint">${esc(sol.jsonld.note)}</p>`;
    if (sol.llms) h += code(sol.llms.text, 'llms.txt') + `<p class="hint">${esc(sol.llms.note)}</p>`;
    if (faq.length) h += `<p><b>GYIK-ötletek</b> <span class="hint">(csak az oldal szövegében szereplő információból; ellenőrizd a válaszokat)</span></p><ul class="faq">${faq.map(q => `<li><b>${esc(q.question)}</b><br>${esc(q.answer)}</li>`).join('')}</ul>`;
  }
  return h;
}
