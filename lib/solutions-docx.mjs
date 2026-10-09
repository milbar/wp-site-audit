// „Javasolt megoldások” a docx-javaslatokban (a docx-segédfüggvényeket az export-docx.mjs adja át)
const len = s => [...String(s || '')].length;

export function solDocx(R, H) {
  const { p, bullet, table, cell, runsOf, Paragraph, TextRun, AlignmentType, W, FONT } = H;
  const sol = R.solutions || {}, ai = R.aiSuggest && !R.aiSuggest.error ? R.aiSuggest : null;
  const meta = ai?.meta || [], faq = ai?.faq || [];
  if (!(meta.length || faq.length || sol.speed?.length || sol.jsonld || sol.llms || ai?.speedText)) return [];
  const head = (t) => new Paragraph({ spacing: { before: 160, after: 80 }, children: [new TextRun({ text: t, font: FONT, size: 20, bold: true, color: H.brand })] });
  const sub = (t) => new Paragraph({ spacing: { before: 100, after: 40 }, children: [new TextRun({ text: t, font: FONT, size: 18, bold: true, color: '404040' })] });
  const code = (txt) => txt.split('\n').map(line => new Paragraph({ spacing: { after: 0, line: 240 }, shading: { type: 'clear', fill: 'F2F2F2', color: 'auto' }, children: [new TextRun({ text: line || ' ', font: 'Courier New', size: 15 })] }));
  const out = [head('Javasolt megoldások (vázlat, átnézendő)')];

  if (meta.length) {
    const cols = [1700, 1100, 3000, 3838];
    const rows = meta.flatMap(m => {
      const r = [];
      if (m.title.needed) r.push([cell(m.path, cols[0], { size: 15 }), cell('TITLE (oldalcím)', cols[1], { size: 15, bold: true, fill: 'D9E2F6' }), cell(`${m.title.old || '(hiányzik)'} (${len(m.title.old)} kar.)`, cols[2], { size: 15 }), cell(`${m.title.new} (${m.title.len} kar.${m.title.ok ? '' : ', hossz ellenőrzendő'})`, cols[3], { size: 15, bold: true, fill: m.title.ok ? 'E2EFDA' : 'FFF2CC' })]);
      if (m.desc.needed) r.push([cell(m.path, cols[0], { size: 15 }), cell('DESCRIPTION (meta leírás)', cols[1], { size: 15, bold: true, fill: 'E8DEF5' }), cell(`${m.desc.old || '(hiányzik)'} (${len(m.desc.old)} kar.)`, cols[2], { size: 15 }), cell(`${m.desc.new} (${m.desc.len} kar.${m.desc.ok ? '' : ', hossz ellenőrzendő'})`, cols[3], { size: 15, fill: m.desc.ok ? 'E2EFDA' : 'FFF2CC' })]);
      return r;
    });
    out.push(sub('Címek és leírások'));
    out.push(table(cols, ['Oldal', 'Mező', 'Jelenlegi', 'Javasolt'], rows));
    out.push(p('A javaslatok az oldal szövegéből készültek (helyi MI); a stílust és a pontosságot ember nézze át.', { run: { size: 15, color: '595959' } }));
  }

  if (sol.speed?.length || ai?.speedText) {
    out.push(sub('Sebesség: konkrét teendők'));
    if (ai?.speedText) ai.speedText.split(/\n+/).forEach(l => out.push(p(l, { run: { size: 17, color: '404040' } })));
    (sol.speedContext || []).forEach(c => out.push(p(c, { run: { size: 16, color: '595959' } })));
    for (const s of sol.speed || []) {
      out.push(new Paragraph({ spacing: { before: 80, after: 20 }, children: [new TextRun({ text: s.topic, font: FONT, size: 18, bold: true }), ...(s.savingsMs ? [new TextRun({ text: `  (kb. ${String(+(s.savingsMs / 1000).toFixed(1)).replace('.', ',')} s nyereség)`, font: FONT, size: 16, color: '595959' })] : [])] }));
      out.push(p(s.why, { run: { size: 16, color: '404040' }, para: { spacing: { after: 30 } } }));
      s.steps.forEach(x => out.push(bullet(x)));
    }
  }

  if (sol.jsonld) { out.push(sub('GEO: Organization JSON-LD vázlat')); out.push(...code(sol.jsonld.json)); out.push(p(sol.jsonld.note, { run: { size: 15, color: '595959' } })); }
  if (sol.llms) { out.push(sub('GEO: llms.txt vázlat')); out.push(...code(sol.llms.text)); out.push(p(sol.llms.note, { run: { size: 15, color: '595959' } })); }
  if (faq.length) { out.push(sub('GEO: GYIK-ötletek (ellenőrizendő)')); faq.forEach(q => out.push(bullet([{ text: q.question + ' ', bold: true }, q.answer]))); }
  return out;
}
