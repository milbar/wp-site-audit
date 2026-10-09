// Arculat (szín, logó) és árajánlat-számítás az exportokhoz
export const brandHex = settings => (/^#[0-9a-f]{6}$/i.test(settings?.brandColor || '') ? settings.brandColor.slice(1).toUpperCase() : '1F3864');

// logó: data URI → { buf, type: 'png'|'jpg', width, height } (a magasságot 36 px-re skálázzuk); nem támogatott formátumnál null
export function logoInfo(settings) {
  const m = String(settings?.logo || '').match(/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  let w = 0, h = 0;
  if (m[1] === 'png') { if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') { w = buf.readUInt32BE(16); h = buf.readUInt32BE(20); } }
  else { // JPEG: SOF0/SOF2 jelölő keresése
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const mk = buf[i + 1];
      if (mk === 0xC0 || mk === 0xC2) { h = buf.readUInt16BE(i + 5); w = buf.readUInt16BE(i + 7); break; }
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  if (!w || !h) return null;
  const height = 36;
  return { buf, type: m[1] === 'png' ? 'png' : 'jpg', width: Math.round(w * height / h), height };
}

// árajánlat: az óraszámokból és az óradíjból; csak akkor készül, ha van óradíj
export function buildQuote(summaries, settings) {
  const rate = +settings?.hourlyRate || 0;
  if (rate <= 0) return null;
  const vat = +settings?.vatPercent || 0, cur = settings?.currency || 'Ft';
  const money = n => Math.round(n).toLocaleString('hu-HU') + ' ' + cur;
  const rows = summaries.filter(s => s.totals && (s.totals.kotelezo || s.totals.gdpr || s.totals.seo || s.totals.tartalom)).map(s => {
    const hb = s.totals.kotelezo || 0, ho = (s.totals.gdpr || 0) + (s.totals.seo || 0) + (s.totals.tartalom || 0);
    return { domain: s.domain, hoursBase: hb, hoursOpt: ho, netBase: hb * rate, netOpt: ho * rate };
  });
  const sum = k => rows.reduce((a, r) => a + r[k], 0);
  const total = { hoursBase: sum('hoursBase'), hoursOpt: sum('hoursOpt'), netBase: sum('netBase'), netOpt: sum('netOpt') };
  total.vatBase = total.netBase * vat / 100; total.grossBase = total.netBase + total.vatBase;
  total.vatOpt = total.netOpt * vat / 100; total.grossOpt = total.netOpt + total.vatOpt;
  return { rate, vat, cur, money, rows, total };
}
