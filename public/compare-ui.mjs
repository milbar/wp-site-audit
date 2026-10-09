// „Változás az előző felméréshez képest” blokk (felület és html-riport)
const fmt = v => (typeof v === 'number' ? String(+v.toFixed(2)).replace('.', ',') : String(v ?? '–'));

export function compareHtml(R, { esc }) {
  const c = R.compare; if (!c) return '';
  const date = c.prevDate ? String(c.prevDate).slice(0, 10) : '';
  let h = `<h4 class="grp">Változás az előző felméréshez képest <span class="hint">${esc(date)}</span></h4>`;
  h += `<p class="hint">${esc(c.summary)}</p>`;
  if (c.deltas.length) h += `<div class="wrapx"><table class="mini"><thead><tr><th>Mutató</th><th>Előző</th><th>Mostani</th><th>Változás</th></tr></thead><tbody>${c.deltas.map(d => {
    const cls = d.better === true ? 'c-ok' : d.better === false ? 'c-bad' : '';
    const ch = d.text ? 'megváltozott' : (d.delta > 0 ? '+' : '') + fmt(d.delta);
    return `<tr><td>${esc(d.label)}</td><td class="num">${esc(fmt(d.prev))}</td><td class="num">${esc(fmt(d.cur))}</td><td class="num"><span class="chip ${cls}">${esc(d.delta === 0 ? 'változatlan' : ch)}</span></td></tr>`;
  }).join('')}</tbody></table></div>`;
  const list = (t, a) => (a.length ? `<p><b>${t}</b></p><ul class="faq">${a.map(f => `<li>${esc(f.title)} <span class="hint">(${esc(f.sev)})</span></li>`).join('')}</ul>` : '');
  h += list('Megoldódott hibák', c.resolvedFindings) + list('Új hibák', c.newFindings);
  return h;
}
