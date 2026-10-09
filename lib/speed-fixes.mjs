// Lighthouse-tételek → konkrét, WordPress-specifikus javítási lépések (kézzel írt tudásbázis, nem MI-találgatás).
// A lépések szándékosan nem hivatkoznak pontos menüútvonalakra, mert azok verziónként változnak.
import { lhRows, rate } from '../public/lh-explain.mjs';

const IMG = 'Képoptimalizáló plugin (pl. ShortPixel, Imagify, EWWW) beállítása, és a meglévő médiatár tömeges átalakítása.';
export const FIXES = {
  'modern-image-formats': { topic: 'Képek korszerű formátumban (WebP / AVIF)', why: 'A JPEG és PNG képek jóval nagyobbak, mint a WebP vagy AVIF változatuk; ez a leggyakoribb oka a lassú betöltésnek.', steps: [IMG, 'A WebP/AVIF változatot a plugin automatikusan szolgálja ki; ellenőrizd a főoldal legnagyobb képein.', 'Az oldalépítőben (pl. Elementor) beállított háttér- és hero-képeket külön ellenőrizd, mert ezeket nem minden plugin éri el.'] },
  'uses-optimized-images': { topic: 'Képek hatékony tömörítése', why: 'A tömörítetlen képek feleslegesen sok adatot vinnek át.', steps: [IMG, 'Jó kiindulás a 75–85%-os minőség, ami szemmel alig látható különbséget ad.', 'Feltöltés előtt a képeket a megjelenítési méretre kell vágni (ne legyen 4000 px széles kép egy 800 px-es helyen).'] },
  'uses-responsive-images': { topic: 'Megfelelő méretű képek', why: 'A böngésző a kelleténél nagyobb képet tölt le, főleg mobilon.', steps: ['A témában és az oldalépítőben a képek a megfelelő WordPress-képméretet használják (nem az „eredeti” méretet).', 'Kisméretű képek újragenerálása (Regenerate Thumbnails jellegű eszközzel), ha új méreteket állítottatok be.'] },
  'offscreen-images': { topic: 'Képernyőn kívüli képek késleltetett betöltése (lazy-load)', why: 'A látogató csak a képernyő alsó részén látható képeket is letölti azonnal.', steps: ['A WordPress alapból késlelteti a képeket; ellenőrizd, hogy az oldalépítő vagy a téma nem kapcsolja-e ki.', 'A gyorsítótár- vagy optimalizáló plugin lazy-load funkciója is bekapcsolható.', 'Az oldal tetején lévő (első képernyős) képet ne késleltesd, mert az az LCP-t rontja.'] },
  'render-blocking-resources': { topic: 'Megjelenést blokkoló CSS és JavaScript', why: 'A böngésző nem tud rajzolni, amíg ezeket be nem tölti.', steps: ['Gyorsítótár-plugin (WP Rocket, FlyingPress, LiteSpeed Cache) „kritikus CSS” és „JS késleltetés” funkciója.', 'Minden változtatás után teszt a főbb oldalakon és űrlapokon (a késleltetés elronthat menüket, csúszkákat).'] },
  'unused-javascript': { topic: 'Nem használt JavaScript', why: 'Sok plugin minden oldalon betölti a szkriptjét, akkor is, ha ott nincs rá szükség.', steps: ['Pluginok átnézése: ami nem szükséges, ki kell venni.', 'Oldalanként kapcsolható betöltés (pl. Asset CleanUp vagy Perfmatters jellegű eszköz), pl. az űrlapplugin csak a kapcsolat oldalon töltsön.', 'Követő- és marketingkódok Google Tag Managerből, hozzájárulás után (ez GDPR szempontból is helyes).'] },
  'unused-css-rules': { topic: 'Nem használt CSS', why: 'A téma és az oldalépítő sok olyan stílust tölt be, amit az adott oldal nem használ.', steps: ['A gyorsítótár-plugin „nem használt CSS eltávolítása” funkciója (óvatosan, teszttel).', 'Az oldalépítő CSS-betöltési beállításainak átnézése (külső fájl vs. beágyazott).'] },
  'unminified-css': { topic: 'Tömörítetlen CSS', why: 'A szóközökkel és megjegyzésekkel teli fájl nagyobb a kelleténél.', steps: ['CSS minifikálás bekapcsolása a gyorsítótár-pluginban.'] },
  'unminified-javascript': { topic: 'Tömörítetlen JavaScript', why: 'A tömörítetlen szkriptek nagyobbak és lassabban töltődnek.', steps: ['JS minifikálás bekapcsolása a gyorsítótár-pluginban; összefűzést csak teszt után használj.'] },
  'uses-text-compression': { topic: 'Szöveges fájlok tömörítése (Gzip / Brotli)', why: 'A HTML, CSS és JS tömörítés nélkül sokkal nagyobb.', steps: ['Gzip vagy Brotli bekapcsolása a szerveren (a tárhelyszolgáltatónál kérhető, vagy .htaccess / szerverbeállítás).', 'CDN használatakor ott is érdemes bekapcsolni.'] },
  'server-response-time': { topic: 'Lassú szerverválasz', why: 'Ha a szerver lassan küldi az első adatot, minden további mérőszám is romlik.', steps: ['Oldal-gyorsítótár bekapcsolása, ha még nincs.', 'PHP-verzió frissítése a támogatott legújabbra.', 'Objektum-gyorsítótár (Redis / Memcached), ha a tárhely támogatja.', 'Adatbázis tisztítása (régi revíziók, átmeneti adatok); ha ez sem elég, gyorsabb tárhely.'] },
  'redirects': { topic: 'Átirányítási láncok', why: 'Minden felesleges átirányítás plusz várakozás.', steps: ['A belső hivatkozásokat és a mérőkódot a végleges címre kell javítani.', 'A HTTP→HTTPS és a www/nem-www átirányítás egyetlen lépésben történjen.'] },
  'uses-long-cache-ttl': { topic: 'Statikus fájlok gyorsítótár-ideje', why: 'A képek, CSS és JS minden látogatáskor újra letöltődnek.', steps: ['Hosszú (pl. 1 éves) gyorsítótár-fejléc a statikus fájlokra (szerverbeállítás vagy gyorsítótár-plugin).', 'Külső szolgáltatások fájljai fölött nincs befolyás; azokat érdemes helyből kiszolgálni.'] },
  'font-display': { topic: 'Webfontok betöltése', why: 'Míg a betűtípus nem tölt be, a szöveg láthatatlan vagy ugrál.', steps: ['Betűtípusok helyi tárolása (GDPR szempontból is helyes), csak a használt vastagságokkal.', 'font-display: swap beállítás.'] },
  'dom-size': { topic: 'Túl nagy oldalszerkezet (DOM)', why: 'A sok egymásba ágyazott elem lassítja a megjelenítést és a kezelhetőséget.', steps: ['Az oldalépítőben a felesleges beágyazott szakaszok és oszlopok csökkentése.', 'Nagyon hosszú oldalak szétvágása vagy lapozása.'] },
  'third-party-summary': { topic: 'Harmadik féltől származó szkriptek', why: 'A követők, chat-ablakok, térképek és videók jelentős terhet adnak.', steps: ['Csak a valóban használt külső szolgáltatások maradjanak.', 'A nem azonnal szükségesek betöltése késleltetve vagy kattintásra (pl. térkép, videó helyett előnézeti kép).'] },
  'bootup-time': { topic: 'Nehéz JavaScript-futtatás', why: 'A telefon sokáig dolgozik a szkripteken, ezalatt az oldal nem reagál.', steps: ['Nehéz pluginok, animációk és csúszkák elhagyása vagy cseréje.', 'Oldalspecifikus betöltés, szkriptek késleltetése.', 'Követőkódok mennyiségének csökkentése.'] },
  'unsized-images': { topic: 'Képek mérete nincs megadva (elmozdulás)', why: 'A késve betöltődő kép lelöki a szöveget, ami zavaró ugrálást okoz.', steps: ['A képeken szélesség és magasság megadása (a WordPress ezt általában megteszi; ellenőrizd az oldalépítő és a téma képeit).', 'A beágyazások (videó, térkép) számára előre fenntartott hely.'] },
  'lcp-lazy-loaded': { topic: 'Az első képernyős kép is késleltetve töltődik', why: 'Az LCP-elem késleltetése közvetlenül lassítja a „betöltöttnek érzett” időt.', steps: ['A főoldal legfelső nagy képét kivenni a lazy-load alól.', 'Elsőbbségi betöltés (preload / fetchpriority) a hero-képre.'] },
  'efficient-animated-content': { topic: 'Animált GIF-ek', why: 'Az animált GIF sokszorosa a videó vagy WebP méretének.', steps: ['GIF cseréje MP4/WebM videóra vagy animált WebP-re.'] },
  'total-byte-weight': { topic: 'Nagy teljes oldalméret', why: 'Mobilnetről a sok megabájt lassú és drága a látogatónak.', steps: ['Elsősorban a képek (lásd fent), másodsorban a betűtípusok és a szkriptek csökkentése.', 'Videók helyett külső szolgáltatás beágyazása, kattintásra betöltve.'] },
};

// Lighthouse-opportunity azonosító → a tudásbázis kulcsa (az ismeretlenek kimaradnak)
const known = id => FIXES[id] ? id : null;

export function speedPlan(R) {
  const rows = lhRows(R).filter(r => r.x && !r.x.error);
  if (!rows.length) return { items: [], context: [] };
  const byId = new Map();
  const touch = (id, ms, where) => { const k = known(id); if (!k) return; const e = byId.get(k) || { id: k, savingsMs: 0, seen: new Set() }; e.savingsMs = Math.max(e.savingsMs, ms || 0); e.seen.add(where); byId.set(k, e); };
  for (const r of rows) {
    const where = `${r.page} (${r.device === 'desktop' ? 'asztali' : 'mobil'})`;
    for (const o of r.x.opportunities || []) touch(o.id, o.savingsMs, where);
    // mérőszám-alapú kiegészítések (ha a Lighthouse nem listázta külön)
    if (rate('serverMs', r.x.serverMs) === 'bad') touch('server-response-time', 0, where);
    if (rate('totalKB', r.x.totalKB) === 'bad') touch('total-byte-weight', 0, where);
    if (rate('tbt', r.x.tbt) === 'bad') touch('bootup-time', 0, where);
    if (rate('cls', r.x.cls) === 'bad') touch('unsized-images', 0, where);
  }
  if ((R.reach?.ttfb || 0) > 800) touch('server-response-time', 0, 'főoldal');
  const items = [...byId.values()].map(e => ({ id: e.id, ...FIXES[e.id], savingsMs: e.savingsMs, seen: [...e.seen].slice(0, 6) })).sort((a, b) => b.savingsMs - a.savingsMs || a.topic.localeCompare(b.topic));

  const d = R.detected || {}, ctx = [];
  const caches = d.cache || [];
  if (caches.length) ctx.push(`Már telepített gyorsítótár / optimalizáló: ${caches.join(', ')}. A fenti beállításokat elsősorban ott keresd.`);
  else if (items.length) ctx.push(R.server?.litespeed ? 'Nincs látható gyorsítótár-plugin; a szerver LiteSpeed, ezért a LiteSpeed Cache plugin az első választás.' : 'Nincs látható gyorsítótár-plugin; érdemes telepíteni egyet (pl. WP Rocket, FlyingPress vagy LiteSpeed Cache, ha a szerver LiteSpeed).');
  if ((d.builder || []).some(b => /elementor/i.test(b))) ctx.push('Az oldal Elementorral készült: az oldalépítő sok CSS-t és JavaScriptet tölt be. Az Elementor teljesítménnyel kapcsolatos beállításait (CSS/JS betöltés, késleltetett betöltés) érdemes átnézni.');
  if (R.server?.php?.isEol) ctx.push('A PHP-verzió elavult; a frissítés a szerverválaszt is javítja.');
  return { items, context: ctx };
}
