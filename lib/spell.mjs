// Magyar helyesírás-ellenőrzés a gépen lévő Hunspell programmal (Dockerben a hunspell + hunspell-hu csomag).
// Ha a program vagy a szótár nincs telepítve, az ellenőrzés csendben kimarad.
import { spawn } from 'node:child_process';

const DICT = process.env.HUNSPELL_DICT || 'hu_HU';
let availability = null;

function run(args, input, timeoutMs = 8000, mergeErr = false) {
  return new Promise(ok => {
    let out = '', done = false;
    const fin = v => { if (!done) { done = true; clearTimeout(t); ok(v); } };
    let p; try { p = spawn('hunspell', args, { stdio: ['pipe', 'pipe', 'pipe'] }); } catch { return ok(null); }
    const t = setTimeout(() => { try { p.kill(); } catch {} fin(null); }, timeoutMs);
    p.on('error', () => fin(null));
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { if (mergeErr) out += d; });
    p.on('close', code => fin(mergeErr || code === 0 || code === null ? out : null)); // a „-D” lista hibakóddal zárulhat, de a kimenet használható
    try { p.stdin.on('error', () => {}); p.stdin.end(input || ''); } catch { fin(null); }
  });
}

export async function spellAvailable() {
  if (availability !== null) return availability;
  const out = await run(['-D'], '', 5000, true); // a telepített szótárak listája
  availability = !!(out && out.includes(DICT));
  return availability;
}

// a szövegben található, a szótárban nem szereplő szavak (egyedi lista)
export async function misspelled(text) {
  if (!(await spellAvailable())) return null;
  const out = await run(['-d', DICT, '-i', 'utf-8', '-l'], String(text || ''));
  if (out == null) return null;
  return [...new Set(out.split(/\r?\n/).map(w => w.trim().replace(/^[("'„]+|[.,;:!?)"'”]+$/g, '')).filter(w => w.length > 2))];
}
