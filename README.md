# WP Site Audit

WordPress-oldalak felmérése bejelentkezés nélkül. A domaineket egy szövegmezőbe (vagy CSV-ből) kell megadni. Az eszköz minden oldalról javítási javaslatokat, becsült óraszámokat, árajánlatot és az ügyfeleknek szóló sablon e-maileket készít.

> **Felelős használat:** az eszköz idegen weboldalak nyilvános végpontjait kérdezi le (böngészővel is betölti őket, linkeket és fájlokat keres). **Csak olyan oldalakat vizsgálj, amelyek tulajdonosa megbízást vagy engedélyt adott rá.** A szoftver „ahogy van” készül, a használatáért és az eredmények értelmezéséért a felhasználó felel. A GDPR-, akadálymentességi és biztonsági megállapítások tájékoztató jellegűek, nem jogi vagy hivatalos auditvéleményt jelentenek. Licenc: [MIT](LICENSE).

## Indítás

### Windows, Docker nélkül
1. Telepítsd a [Node.js](https://nodejs.org) 20-as vagy újabb verzióját, valamint a Google Chrome-ot vagy a Microsoft Edge-et (a böngészős mérésekhez).
2. Futtasd a `start.bat` fájlt. Első induláskor telepíti a függőségeket (1–2 perc), utána megnyitja a felületet: <http://127.0.0.1:4580/>.
3. A leállításhoz zárd be a konsolablakot. macOS / Linux alatt: `./start.sh`.

Ebben a helyi módban nincs belépés. Ha mégis felvesz valaki felhasználót (lásd lent), onnantól a belépés kötelező.

### Docker (ajánlott szerverre)
```bash
echo "AUTH_PASS=válassz-egy-erős-jelszót" > .env
docker compose up -d --build
```
Megnyitás: <http://127.0.0.1:4580/>, felhasználónév `admin` (az `AUTH_USER`-rel módosítható). Windows PowerShellben az `.env` fájlt UTF-8-ban írd (`Set-Content .env "AUTH_PASS=..." -Encoding ascii`), a `>` UTF-16-ot ír, amit a Docker nem olvas.

A csomag három szolgáltatást indít: az alkalmazást, egy helyi MI-szervert (Ollama) és egy egyszeri modell-letöltőt (első indításkor ~3 GB). Az adatok a `audit-data` kötetben vannak, a letöltött modellek az `ollama-models` kötetben.

## Mit vizsgál

| Terület | Mit néz |
|---|---|
| Elérhetőség | HTTP-állapot, átirányítási lánc, TTFB, karbantartás mód, átirányító domain mögött élő WP, **bot-védelem** (várakozással többször újrapróbálja, majd „blokkolva” állapotot ad levélsablonnal az IP-engedélyezéshez) |
| SSL | lejárat, érvényesség, HTTP→HTTPS átirányítás |
| WordPress | core-verzió és a legújabbhoz mért lemaradás |
| Téma, pluginok | verzió, legújabb verzió (WordPress.org), kockázatos pluginok, **ismert sebezhetőségek** a plugin- és témaverziókra (kulcs nélküli [WPVulnerability](https://www.wpvulnerability.net) adatbázis, CVE-azonosítóval és javított verzióval; a WordPress-magra az adatbázis nem megbízható, ott az „elavult verzió” jelzés az irányadó); opcionálisan kiegészíthető a WPScan-nel |
| PHP | verzió, támogatási határidő |
| Biztonság | REST `/users`, `?author=1`, XML-RPC, readme.html, nyilvános `debug.log`, `.git`, könyvtárlistázás, biztonsági fejlécek |
| Spam / feltörés | kulcsszavas keresés a bejegyzésekben, aktív támadás jelzése |
| GDPR | süti-sáv, elutasítás, süti-fal, mi töltődik be hozzájárulás előtt, beágyazások, Google Fonts, Consent Mode v2, képernyőkép; adatkezelési tájékoztató, impresszum |
| SEO | title és description hossza és értékelése oldalanként, ismétlődések, H1, canonical, OG, robots.txt, sitemap, mérőkódok |
| GEO (AI-keresők) | 100 pontos pontszám hat területen, AI-botok elérése és robots.txt, `llms.txt`, strukturált adat, szöveg a HTML-ben, megbízhatósági jelek; oldalanként legfeljebb 50 oldal a sitemapből |
| Lighthouse | mobil és asztali profil egyszerre, főoldal és sitemapből választott aloldalak, táblázat színekkel és magyar magyarázattal; opcionálisan valós látogatói adat (CrUX) |
| Akadálymentesség (WCAG) | axe-core, **WCAG 2.2 AA**: a főoldal és két aloldal; minden hibához a WCAG-kritérium száma és szintje, magyar szabálynevek és javítási tanácsok. Az automata teszt a kritériumok kb. 30–40%-át fedi, megfelelőségi igazolásnak nem elég |
| HTML-validálás (W3C) | a hivatalos Nu Html Checkerrel (Java kell hozzá, a Docker-képben benne van): a főoldal és négy másik oldal hibái és figyelmeztetései, a gyakori hibákhoz magyar magyarázattal. A CSS-validálás nem része |
| Linkek | törött belső és külső linkek, hosszú átirányítási láncok |
| E-mail és domain | MX, SPF, DKIM, DMARC; domain-lejárat (RDAP, ahol a végződéshez van szolgáltatás; a .hu-hoz jelenleg nincs) |

## Kimenetek

Letölthető az egész felmérésről és **domainenként** is (az oldalpanel tetején).
- **Javítási javaslatok (docx):** összefoglaló, árajánlat, oldalanként a megállapítások, táblázatok, magyarázatok.
- **Sablon e-mailek (docx):** oldalanként egy előre kitöltött levél az ügyfélnek, a `{{MEZŐK}}` kitöltendők.
- **Táblázat (xlsx):** összesítő, javaslatok, pluginok, GDPR, GEO, SEO és GEO oldalak, Lighthouse, további mérések, változás, javasolt szövegek, magyarázat.
- **Riport (html és pdf):** egyfájlos, megosztható, a logóval és az arculati színnel.
- **Szövegek (csv):** a javasolt title / description szövegek (általános táblázat, nem konkrét SEO-bővítmény importformátuma).

A **Beállítások**ban adható meg a készítő neve, az e-mailek küldője, az óradíj (nettó), az ÁFA, a pénznem, az arculati szín és a logó, valamint minden tétel becsült óraszáma. Óradíj megadásakor árajánlat is készül.

## Változás az előző felméréshez képest

Ha egy domain már szerepelt korábbi felmérésben, az új eredmény mellett megjelenik, mi javult és mi romlott (pontszámok, hibák száma, elavult pluginok, óraszám), mely hibák oldódtak meg, és melyek újak.

## MI-segítség (helyi, az adat nem hagyja el a gépet)

- **MI-összefoglaló:** részletes, magyar nyelvű összefoglaló a megállapításokból.
- **MI-javaslatok:** új title és description a gyenge oldalakhoz (hosszellenőrzéssel és Hunspell magyar helyesírás-ellenőrzéssel), GYIK-ötletek az oldal szövegéből. A sebességi teendők, a JSON-LD és az `llms.txt` vázlat szabályokból készül, a modell nem találhat ki semmit.
- Az MI szövege **vázlat**: mindig át kell nézni. A Gemma 3 4B magyar nyelvtana nem hibátlan. Jobb minőség: `OLLAMA_SUGGEST_MODEL=gemma3:12b` a `.env` fájlban (~8 GB RAM, lassabb).

## Felhasználók és belépés

Alapból egyetlen „tartalék” adminisztrátor van (`AUTH_USER` / `AUTH_PASS`, Basic hitelesítés). Több felhasználóhoz:
```bash
docker compose exec wp-site-audit node scripts/user.mjs add anna 'hosszú-jelszó-123' admin
docker compose exec wp-site-audit node scripts/user.mjs add bela 'másik-jelszó-123' user
```
Ezután a felület belépő oldalt mutat. A felhasználók csak a saját felméréseiket látják, az admin mindet. A beállításokat és a felhasználókat csak az admin kezeli (a Beállítások ablakban is). A munkamenet 12 órás, a süti `HttpOnly` és `SameSite=Strict`. Reverse proxy mögött HTTPS-sel állítsd be a `COOKIE_SECURE=1` értéket.

## Ütemezés és értesítés

Az „Új felmérés” űrlap alján az „Ütemezés és értesítés” résznél a beállított felmérést naponta, hetente vagy havonta futtathatod. Az „Ütemezések” gombbal kezelhető (futtatás most, szünet, törlés). A felmérés végén a megadott **webhook-címre** (Slack, Teams, Zapier, Make) értesítés megy: ütemezésnél csak romlás esetén (GEO- vagy Lighthouse-pont esése, új súlyos hiba, lejáró SSL, leállt vagy blokkolt oldal), kivéve ha a „mindig értesítsen” be van pipálva. Az időpontokat a `TZ` változó szerinti helyi idő adja (alapérték: Europe/Budapest).

## API

Az API-kulcsot a Beállítások → API-kulcsok alatt hozhatod létre (csak egyszer látszik). A kulccsal a `Authorization: Bearer wsa_…` fejléc elég, külön tartalomtípus nem kell.
```bash
# felmérés indítása
curl -X POST https://audit.example.com/api/runs -H "Authorization: Bearer wsa_…" -H "Content-Type: application/json" \
  -d '{"text":"pelda.hu\nmasik.hu","name":"Heti ellenőrzés","geo":true,"a11y":true,"webhookUrl":"https://hooks.example.com/x"}'
# eredmény (JSON), a "finished": true jelzi a végét
curl https://audit.example.com/api/runs/<id> -H "Authorization: Bearer wsa_…"
# letöltés: /api/runs/<id>/export/{xlsx|javaslatok|emailek|html|pdf|csv}?sites=pelda.hu
```
Egyéb végpontok: `GET /api/runs`, `DELETE /api/runs/<id>`, `GET/POST /api/schedules`, `POST /api/schedules/<id>/run`, `GET /api/me`.

## Skálázás: böngésző-munkások

A Chrome-os mérések (GDPR, akadálymentesség, Lighthouse) a leglassabbak. Több domainnél külön munkás-konténerekre oszthatók:
```bash
# Linux / macOS:  echo "WORKER_TOKEN=$(openssl rand -hex 16)" >> .env
# Windows PowerShell: Add-Content .env ("WORKER_TOKEN=" + -join ((1..16) | ForEach-Object { "{0:x2}" -f (Get-Random -Max 256) })) -Encoding ascii
docker compose --profile scale up -d --scale worker=3
```
Az alkalmazás magától felfedezi a munkásokat (`BROWSER_WORKER_HOST`), és a böngészős feladatokat szétosztja köztük; munkás nélkül a saját Chrome-ját használja. Minden munkás fix CPU- és memóriakeretet kap (`WORKER_CPUS`, `WORKER_MEM`), ami a Lighthouse-pontszámokat reprodukálhatóbbá teszi. A munkások nem érhetők el kívülről. Az automatikus (terheléstől függő) skálázás nincs beépítve, a darabszámot kézzel állítod.

## Biztonság

- **SSRF-védelem szerver módban:** a belső és speciális IP-tartományok nem vizsgálhatók; a védelem kapcsolódáskor ellenőriz (DNS-rebinding ellen), a TLS-lekérdezésre és az átirányításokra is vonatkozik. A Chrome forgalma egy szűrő-proxyn megy át, ezért egy ellenséges oldal JavaScriptje sem érheti el a belső hálózatot (az Ollamát, a gazdagépet).
- **Böngészőből érkező támadások ellen:** Host- és Origin-ellenőrzés, módosító kéréshez JSON tartalomtípus, CSP, `SameSite=Strict` süti.
- **Hitelesítés:** scrypt jelszó-hash, időzítés-biztos összehasonlítás, 10 hibás próba után 10 percre tiltás IP-nként, az API-kulcsokból és munkamenetekből csak a hash tárolt.
- Az auditált oldalakról származó szövegek mindenhol escape-elve jelennek meg. Az MI az ilyen szövegeket adatként kapja, utasításként nem kezeli, de a kimenetét ember nézze át.
- A felmérés csak publikus végpontokat kérdez le. **Csak olyan oldalakat vizsgálj, amelyekre megbízásod van.**

## Környezeti változók

| Változó | Jelentés |
|---|---|
| `AUTH_USER`, `AUTH_PASS` | tartalék admin-belépés (szerver módban kötelező, ha nincs felhasználó) |
| `HOST`, `PORT` | figyelési cím és port; `HOST` nem 127.0.0.1 → szerver mód (belépés kötelező, belső címek tiltva) |
| `DATA_DIR` | adatkönyvtár (alapérték `./data`) |
| `MAX_DOMAINS`, `MAX_ACTIVE_RUNS` | domainek száma felmérésenként (200), egyszerre futó felmérések (szerver módban 1) |
| `REQUEST_DELAY_MS`, `BROWSER_PAUSE_MS` | kéréskésleltetés ugyanarra a hosztra (500), szünet a böngészős mérés előtt (3000); bot-védelem esetén növeld |
| `ALLOWED_HOSTS` | engedélyezett Host-fejlécek (vesszővel), reverse proxy mögött ajánlott |
| `COOKIE_SECURE`, `TRUST_PROXY` | `Secure` süti HTTPS mögött (`TRUST_PROXY=1` az `X-Forwarded-Proto` alapján) |
| `WEBHOOK_URL` | globális webhook (csak riasztáskor értesít) |
| `VULN_CHECK=0` | az ismert sebezhetőségek vizsgálatának kikapcsolása (alapból be van kapcsolva, kulcs nem kell hozzá) |
| `WPSCAN_API_TOKEN`, `WPSCAN_MAX_REQUESTS` | opcionális kiegészítés (WPScan, a WordPress-magra is); az ingyenes csomag napi kerete kicsi, a keret nyilvántartása nincs beépítve |
| `GOOGLE_API_KEY` | valós látogatói adat (Chrome UX Report API) |
| `OLLAMA_URL`, `OLLAMA_MODEL`, `OLLAMA_SUGGEST_MODEL` | helyi MI |
| `BROWSER_WORKER_HOST`, `BROWSER_WORKERS`, `WORKER_TOKEN` | böngésző-munkások |
| `CHROME_PATH`, `CHROME_FLAGS` | Chrome elérési útja és plusz kapcsolók |
| `RESUME_RUNS=0`, `SCHEDULER=0` | a megszakadt felmérések folytatásának, illetve az ütemezőnek a kikapcsolása |
| `TZ` | időzóna az ütemezéshez |

A konténer újraindulásakor a félbemaradt felmérések automatikusan folytatódnak (a már kész domainek eredménye megmarad).

## Tesztek

```bash
npm install
npm test
```
A tesztek lefedik a biztonsági részeket (SSRF-szűrés, szűrő-proxy, Host/Origin/CSRF, belépés, jogosultság), a pontozást, az exportokat, az ütemezést, a munkás-protokollt és az új méréseket. A Hunspell-teszt kimarad, ha a program nincs telepítve (a Docker-képben van).

## Korlátok

- Bejelentkezés nélkül nem látszik a teljes plugin-lista, a mentések állapota és a jogosultságok; a PHP-verzió rejtve marad, ha a szerver nem küldi.
- A plugin-verziók becsültek, prémium bővítményeknél a legújabb verzió nem ismert.
- A spam-szűrés kulcsszavas, a „≥” jelölés alsó becslés. A süti-mérés első látogatóként, interakció nélkül történik; nem jogi vélemény.
- A GEO-pontszám az AI-keresők számára való felkészültséget méri, azt nem, hogy a ChatGPT vagy a Perplexity tényleg idéz-e az oldalból.
- Az automatikus akadálymentességi teszt a hibák kb. harmadát találja meg; kézi ellenőrzést nem helyettesít.
- A Lighthouse-értékek futásonként ±5–10 ponttal szórhatnak.
- Domain-lejárat csak azokhoz a végződésekhez érhető el, amelyekhez van RDAP-szolgáltatás (a .hu-hoz jelenleg nincs).
