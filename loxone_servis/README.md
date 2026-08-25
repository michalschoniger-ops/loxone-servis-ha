# Evora Smart Hub

Evora Smart Hub je interní servisní centrum EVORA Smart pro správu Loxone Miniserverů a monitoring Home Assistant instalací. Na jednom místě spojuje flotilu zařízení, firmware, živý stav prvků, diagnostiku, projektová data, bezpečné exporty, podporu a přístupy. Běžný monitoring probíhá automaticky a postupně; aktualizace, restarty a další rizikové zásahy zůstávají potvrzované a auditované.

## Jak aplikace funguje

HA Práce je jediný vlastník databáze a jediný uzel, který komunikuje s Miniservery. Po minutovém zahřátí plánovač zařazuje vždy jeden Miniserver s nejméně 30sekundovým rozestupem, takže se 137 zařízení nedotazuje naráz. Firmware, dostupnost, `/data/status` a aktuální hodnoty se obnovují v průběžném dvouhodinovém cyklu; Health Check nejvýše jednou za 12 hodin, LoxAPP3 jednou za 24 hodin a 1‑Wire teploty jednou za 10 minut pro každý příslušný Miniserver. Ruční tlačítka zůstávají dostupná pro okamžitou kontrolu.

Rozhraní vždy zobrazuje poslední úspěšně uložený stav a čas jeho vzniku. Přesné fotografie prvků se vybírají podle názvu produktu nebo šestimístného produktového čísla, které skutečně vrátí Miniserver. Obrázky pocházejí z oficiálního produktového CDN Loxone Shop (`pim.loxone.com`) a vedou na český e‑shop; u obecného typu `TreeDevice` nebo `AirDevice` se fotografie nehádá. Air RSSI, počet skoků a baterie se zobrazí jen tehdy, když je daný firmware zveřejní v `/data/status`.

Každá provozní informace rozlišuje, zda se právě načítá, je aktuální nebo zastaralá, zda Miniserver neodpovídá, odmítl přihlášení, nemá nastavený přístup, zdroj údaj neposkytl, nebo nastala interní chyba Hubu. Tyto stavy se neslévají do jednoho neurčitého „offline“ výsledku.

## Hlavní funkce

- seznam 137 Miniserverů s editací projektu, typu, přístupů a aktualizační politiky
- stable, beta a alpha verze načítané z oficiálního `updatecheck.xml`
- rozložená automatická kontrola po jednom Miniserveru, nejméně 30 sekund od sebe, v dvouhodinovém cyklu
- Remote Connect s CloudDNS fallbackem a přesnými stavy `nedostupné` / `bez přístupu`
- stav prvků z `/data/status`, diagnostika PLC/CPU/SD a změny LoxAPP3
- automatická struktura Gateway/Client z LoxAPP3 s bezpečným ručním přepsáním
- libovolně vnořené složky projektů a hierarchické zobrazení systémů s více Miniservery
- klíček pro okamžité kopírování hesla a samostatné tlačítko pro otevření Loxone App s přístupy
- účty `@evorasmart.cz`, samoobslužná změna hesla, role, TOTP 2FA, rate limiting a audit
- responzivní rozhraní pro desktop, Home Assistant i iPhone
- přehled více Home Assistant instalací s dvouhodinovou kontrolou, odezvou, verzí Core a přímým otevřením
- Home Assistant Fleet s přehledem aktualizací Core, Supervisoru, OS, add-onů a integrací, potvrzovanou instalací a restartem
- bezpečný Config Bridge s odpovídající verzí Loxone Configu, projektem, adresou a kopírováním přístupů
- osobní Windows Config Launcher, který podle firmwaru spustí přesnou instalovanou verzi Configu a bezpečně vyplní ruční připojení
- Evora Smart Menu 3.0.17 pro macOS a nativní Evora Smart Menu 3.0.17 pro Windows se shodným pořadím hlavních kategorií, globálním hledáním s přímými výsledky Miniserverů, docházkou, verzí Hubu, NVR diagnostikou a akcemi Loxone App/Config. macOS ukládá token do Klíčenky; Windows používá DPAPI aktuálního uživatele a bezkonzolovou tray aplikaci s ověřovanou automatickou aktualizací.
- Milesight NVR v privátní síti HA Práce s minutovou neblokující kontrolou, podrobným stavem poslední kontroly, úspěchu a chyby a úplným inventářem online i offline kanálů včetně názvu, čísla, modelu a firmwaru, pokud je NVR skutečně poskytne. Publikovaný je jediný stabilní kanál 7 `Parkoviště a brána`: Hub jej z přímého RTSP zdroje bezpečně přebaluje do HLS, průběžně předehřívá a browser i macOS Menu ověřují postupující dekódovaný obraz. RTSP adresa ani přístupy nikdy neopouštějí server a aktivní cesta nepoužívá MJPEG. Datový model dovoluje více NVR a obsahuje oddělenou provider hranici; proprietární Milesight P2P zůstává vypnuté, dokud nebude dostupné oficiální licencované NVR SDK.
- správcovské centrum Evora Intranetu: aktuální pracovní stav, běžící čas, příchod a odchod, Home office, služební cesta, měsíční souhrny, dvouměsíční historie, kontakty kolegů a žádosti o dovolenou či absenci
- barevné složky a podsložky, přesné fotografie z oficiálního Loxone Shop CDN, dostupná kvalita Air signálu a profilové fotografie uživatelů
- čitelný konverzační přehled ticketů s lokální cache, přílohami, bezpečným založením a odpovědí správce
- centrum incidentů, které slučuje opakované závady, hlídá závažnost, odpovědnou osobu, SLA, komentáře a historii
- interní servisní úkoly s hodinovým čtecím Microsoft Graph importem organizačního Excelu; přesun řádku i drobná změna aktualizují stejný úkol bez duplikátu, zatímco zápis zpět do Excelu je vypnutý
- servisní profily Gateway a samostatných Miniserverů se smlouvou, zárukou, další kontrolou, vlastními poli, tagy a kontaktem; Client kontakt bezpečně dědí z Gateway
- krokový tester DNS/sítě, Remote Connectu, Miniserveru, TLS, přihlášení, `/data/status`, LoxAPP3/Health, Portálu a Windows Launcheru
- bezpečný katalog historických programových záloh z SD karty Miniserveru a stažení ověřeného `.Loxone` nebo původního ZIPu
- XML i binární V2 statistiky z aktuálního LoxAPP3 včetně nového formátu `statisticV2.groups[].dataPoints[]`
- anonymizovaný servisní balíček: identita/FW, 25 Health snímků, inventář prvků, 500 událostí dostupnosti, 100 změn projektu a `def.log`; nikdy hesla ani tokeny, odkaz platí 24 hodin
- integrovaný rozcestník LOXONE Partner Portalu, ticketů a české podpory
- animované přihlášení a lokálně cachovaný aktualizační stav bez ukládání API odpovědí nebo přihlašovacích dat
- globální hledání Hubu, které bez ohledu na diakritiku prohledá obrazovky a podsekce i aktuální Miniservery, složky, úkoly, incidenty, tickety a uživatele v rozsahu přihlášené role a otevře přímo nalezený záznam

## Bezpečnost dat

GitHub a kontejnerový obraz neobsahují žádná zákaznická hesla, databáze, tokeny ani čitelné exporty. Přístupy jsou v hlavní instalaci šifrovány pomocí AES-256-GCM a klíč zůstává v chráněném `/data/options.json`. Automatická GitHub záloha obsahuje databázi i konfiguraci, ale celý archiv je před odesláním znovu zašifrovaný samostatným AES-256-GCM obnovovacím klíčem, který na GitHubu uložen není. Každý technik používá vlastní aplikační účet; hlavní správce nejde smazat ani deaktivovat.

Evora Intranet je dostupný jen roli správce. E-mail, heslo, obnovovací token i lokální snapshot jsou odděleně šifrované, endpointy mají vlastní rate limit a odpovědi `no-store`. Docházková akce se zapisuje až po výslovném potvrzení; Hub neposílá GPS polohu.

Home Assistant adresy mohou být Tailscale (`*.ts.net`), Nabu Casa (`*.ui.nabu.casa`) nebo privátní LAN IP. Dlouhodobý token je volitelný a slouží pouze k načtení `/api/config`; běžný login a heslo se nikdy nevkládají do odkazu.

Fotografie a PDF interních servisních úkolů mají omezený typ i velikost, server ověřuje skutečnou signaturu obsahu a ukládá je šifrovaně pomocí AES-256-GCM. Stažení vyžaduje aktivní roli správce nebo technika, používá `no-store` a prohlížeč nesmí obsah odhadovat podle názvu souboru.

Microsoft Graph propojení Excelu používá tenantově omezenou veřejnou aplikaci, `offline_access` a delegované oprávnění `Files.ReadWrite`, které Microsoft vyžaduje i pro rozlišení položky ze sdíleného odkazu přes `/shares`. Hub 3.0.33 tuto relaci používá pouze ke čtení: neodesílá změnu buňky ani heslo či klientské tajemství; obnovovací token je šifrovaný a krátkodobý device code vidí pouze správce po dobu připojení. Bez nastaveného tenant ID, client ID a schválené device-code relace se synchronizace pravdivě označí jako nenastavená a dál zobrazuje poslední lokálně importovaný obsah.

## Jediný zdroj dat

- **HA Práce** běží v režimu `main`: vlastní databázi, jako jediná komunikuje s Miniservery, provádí kontroly a přijímá změny.
- **HA Domov** běží v režimu `client`: nic lokálně neukládá, nespouští plánovač ani Loxone WebServices a přes HTTPS přeposílá aplikaci i API do HA Práce. Při nedostupnosti HA Práce se dotaz bezpečně ukončí bez přímého fallbacku.
- veřejný odkaz míří přímo na hlavní HA Práce, takže přidání Miniserveru nebo změna hesla je okamžitě vidět všude.
- veřejný vstup přes Tailscale Funnel používá jen vyhrazenou cestu `/api/loxone-servis/`; aplikační přihlášení a audit zůstávají povinné.

## Vývoj

Vyžaduje Node.js 22.13 nebo novější.

```bash
npm ci
npm run check
npm test
npm run build
```

Hlavní lokální start vyžaduje 32bajtový Base64 `CREDENTIALS_MASTER_KEY` a existující nebo inicializovanou databázi v `DATA_DIRECTORY`. Klientský režim vyžaduje jen HTTPS `CANONICAL_BASE_URL`.

## Home Assistant

Definice aplikace je v `loxone_servis/config.yaml`. Slug `loxone_fleet` zůstává zachovaný kvůli bezešvé migraci původních dat. Veřejný HA katalog obsahuje hotový runtime a Home Assistant z něj sestaví lokální obraz pro `amd64` nebo `aarch64`; GitHub Actions současně vytváří vícearchitekturní testovací obraz bez zákaznických dat.

Podrobný postup je v [dokumentaci aplikace](loxone_servis/DOCS.md). Obnova zálohy je popsaná v [docs/RECOVERY.md](docs/RECOVERY.md).
