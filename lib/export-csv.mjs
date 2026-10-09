// A javasolt szövegek (title, description) CSV-ben: UTF-8 BOM-mal, hogy az Excel is jól olvassa.
// Megjegyzés: ez általános táblázat, nem egy konkrét SEO-bővítmény importformátuma (a Yoast / Rank Math nem fogad ilyen fájlt közvetlenül);
// WP-CLI, WP All Import vagy kézi bevitel alapja lehet.
import { sortSites } from './summary.mjs';

// a képletként értelmezhető kezdőkarakterek (=, +, -, @) elé aposztróf kerül: a táblázatkezelő ne futtasson le semmit
const cell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };

export function exportCsv(run) {
  const rows = [['Domain', 'Ügyfél', 'Oldal (URL)', 'Mező', 'Jelenlegi', 'Javasolt (MI-vázlat)', 'Jelenlegi hossz', 'Javasolt hossz', 'Helyesírás ellenőrizendő']];
  for (const site of sortSites(run.sites)) {
    for (const m of site.result?.aiSuggest?.meta || []) {
      for (const [field, f] of [['title', m.title], ['description', m.desc]]) {
        if (!f.needed) continue;
        rows.push([site.domain, site.client || '', m.url, field, f.old || '', f.new, [...(f.old || '')].length, f.len, (m.spell || []).join(', ')]);
      }
    }
  }
  return '﻿' + rows.map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
}
