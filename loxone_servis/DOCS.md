# Instalace a aktualizace

1. Přidejte tento GitHub repozitář do obchodu s aplikacemi Home Assistantu.
2. Nainstalujte **Evora Smart Hub**.
3. Na hlavní instalaci HA Práce vložte 32bajtový Base64 `credentials_master_key` a PBKDF2 hash hesla prvního správce. Při migraci obnovte celý adresář `/data` ze zálohy původní instalace.
4. Spusťte aplikaci a otevřete ji ze sidebaru.

## Režimy HA Práce a HA Domov

HA Práce je hlavní instalace a jako jediná obsahuje databázi i klíče. Volbu `canonical_base_url` na ní nevyplňujte.

Na HA Domov vyplňte `canonical_base_url` veřejnou HTTPS adresou hlavní instalace HA Práce. Aplikace se automaticky přepne do bezstavového klientského režimu: neotevře lokální databázi, nespustí plánovač ani Loxone WebServices a všechny obrazovky i API přepošle do HA Práce. Pokud HA Práce není dostupná, klient vrátí chybu a nikdy nezkusí přímý dotaz na Miniserver. Přihlašuje se stále přímo do Evora Smart Hubu, nikoli účtem Home Assistantu.

Port 8099 je určený pro přímý přístup přes důvěryhodný HTTPS reverse proxy nebo Tailscale Funnel. Nevystavujte jej na internet bez TLS.

## Monitoring dalších Home Assistantů

V záložce **Home Assistant** přidejte název a kořenovou adresu instalace. Povolené jsou adresy `*.ts.net`, `*.ui.nabu.casa` a privátní LAN IP na portech 443, 8123 nebo 8443. Hlavní instalace každé dvě hodiny ověří dostupnost a odezvu.

Pro zobrazení verze Core vytvořte v cílovém Home Assistantu dlouhodobý přístupový token a vložte jej do editoru instalace. Token se ukládá šifrovaně a v UI se už nikdy nezobrazuje. Volitelný login a heslo slouží servisákovi ke zkopírování; prohlížeč je automaticky nevkládá do cizí přihlašovací stránky a aplikace je neposílá v URL.

### Veřejná cesta přes HA Práce

Repozitář obsahuje úzce omezenou HA integraci `homeassistant/custom_components/loxone_servis_proxy`. Na HA Práce zpřístupní pouze cestu `/api/loxone-servis/` a předá ji lokálnímu add-onu na portu 8099. Aplikace nadále vyžaduje vlastní e-mail, heslo, případně TOTP a všechny operace zapisuje do auditu.

Při použití Tailscale Funnel nastavte `share_homeassistant: funnel`, zvolený HTTPS port a v HA povolte důvěryhodný lokální proxy `127.0.0.1` podle oficiální dokumentace Tailscale add-onu. `canonical_base_url` klienta HA Domov potom nastavte na veřejnou HTTPS adresu včetně `/api/loxone-servis`, například `https://nazev.tailnet.ts.net:8443/api/loxone-servis`.

## Složky a struktura Gateway/Client

Tlačítko **Zjistit strukturu** vědomě načte z každého dostupného Miniserveru `/data/LoxAPP3.json`. Hodnota `msInfo.gatewayType` určí roli a známá SN nalezená v projektu Gateway vytvoří vazbu na Clienta pouze tehdy, když je výsledek jednoznačný. Neurčené nebo neodpovídající Clienty aplikace ponechá bez rodiče. Procházení topologie se automaticky nespouští a nikdy nepřepíše ručně nastavenou roli či vazbu.

Tlačítko **Složky** vytváří společné skupiny pro projekty s více samostatnými Miniservery nebo více systémy Gateway/Client. Smazání složky nemaže Miniservery; pouze je přesune do skupiny **Ostatní**.

## Loxone Config Launcher pro Windows

Každý správce nebo technik páruje vlastní Windows zařízení v **Nástroje → Loxone Config Launcher**. Stáhne společný ZIP, vytvoří jednorázový deset minut platný kód a ve Windows spustí instalátor pod svým běžným účtem. Vzniklý token patří tomuto uživateli a Windows jej ukládá pomocí DPAPI; jiný účet nebo počítač potřebuje vlastní párování.

V Parallels se ZIP rozbalí a instalátor spustí přímo uvnitř Windows; macOS část není potřeba. Stejný balík funguje i na samostatném počítači s Windows 10/11. Windows musí být spuštěný, uživatel přihlášený, plocha odemčená a HTTPS adresa Hubu dostupná. Instalační PowerShell je viditelný pouze při prvním párování; autostart a běžný polling používají skryté okno.

Při kliknutí na **Otevřít v Loxone Config** Hub vybere pouze online agenta přihlášeného uživatele. Do databázové fronty uloží SN, požadovanou verzi a odkaz na Config, nikdy login ani heslo. Přístupy odešle až při autorizovaném převzetí konkrétní úlohy. Helper vyhledá přesný `FileVersion` souboru `LoxoneConfig.exe`; chybí-li, ukončí úlohu bezpečnou chybou a nabídne oficiální odkaz ke stažení. Při nalezení otevře přesnou instalaci, jednoznačně ověří prvky okna přes Windows UI Automation, ponechá lokální adresu prázdnou a do externí adresy vloží SN Miniserveru.

## WorkLog AI na macOS

Integrace je dostupná výhradně správci. Technik ani uživatel pouze pro čtení její panel neuvidí a jejich případný starší token server odmítne. Správce v **Nástroje → WorkLog AI · Evora Smart Hub** stáhne integrační balíček a vytvoří osobní token. Nešifrovaná adresa Hubu se uloží do uživatelských předvoleb macOS, ale token pouze do Klíčenky. Hub uchovává jen SHA-256 hash a krátkou nápovědu tokenu; token lze kdykoli odvolat.

WorkLog načítá pouze názvy, složky, SN, stav a firmware. Hesla seznam neobsahuje. Po konkrétním kliknutí na Loxone App vrátí Hub přístup jen v jednorázové odpovědi s `Cache-Control: no-store`, kterou WorkLog ihned předá schématu `loxone://` a nezapisuje ji do konfigurace ani logu. Volba Loxone Config vytvoří úlohu pouze pro Windows agenta správce a WorkLog průběžně zobrazí výsledek nebo nabídne stažení chybějící verze.

## Denní synchronizace Loxone Partner Portalu

Správce může v **Nástroje → Synchronizace Loxone Partner Portalu** propojit firemní účet a okamžitě načíst seznam registrovaných Miniserverů. Další synchronizace proběhne automaticky jednou za 24 hodin pouze na centrálním HA Práce; HA Domov i weboví klienti používají stejná centrální data a nevytvářejí další požadavky.

Heslo a obnovovací token se ukládají odděleně zašifrované pomocí AES-256-GCM a nikdy se nezapisují do logu ani do veřejné konfigurace. Běžná synchronizace používá pouze obnovovací token. Pokud jej Loxone zneplatní, aplikace provede přesně jeden nový login uloženým heslem, uloží nový obnovovací token a synchronizaci zopakuje. Když Loxone odmítne i heslo, oba údaje se smažou a správce musí účet znovu propojit. Dočasná chyba nastaví odklad dalšího pokusu, aby opakované požadavky účet nezablokovaly.

Import porovnává záznamy podle sériového čísla. Nový Miniserver založí bez servisního hesla; u již známého záznamu aktualizuje typ, datum registrace a název projektu pouze dokud jej stále spravuje portál. Ruční změny přístupů, složek, Gateway/Client vazeb, poznámek a cíle firmware nepřepisuje a záznamy, které z portálu zmizí, automaticky nemaže.

## 1-Wire historie a aplikační dohled

Po minutovém zahřátí plánovač HA Práce postupně zařazuje vždy jeden Miniserver s uloženými přístupy a mezi dvěma položkami zachovává nejméně 30 sekund. Firmware, dostupnost, `/data/status`, prvky a aktuální hodnoty tak projdou průběžným dvouhodinovým cyklem bez nárazového dotazu na celou flotilu. Health Check se pro každý dostupný Miniserver obnovuje nejvýše jednou za 12 hodin a LoxAPP3 jednou za 24 hodin; neúspěšný pokus se nevydává za aktuální data.

Online teplotní 1-Wire čidla rodiny 28 se samostatně vzorkují po jednom Miniserveru v desetiminutovém intervalu a ukládají pouze do centrální databáze HA Práce. Jednotlivé vzorky se uchovávají 13 měsíců a denní minimum, průměr a maximum 5 let. HA Domov data pouze zobrazuje přes `canonical_base_url` a nic lokálně neukládá.

## Exporty, Air signál a servisní balíček

Binární Statistiky V2 se nabízejí jen tehdy, když aktuální LoxAPP3 skutečně obsahuje `statisticV2.groups[].dataPoints[].output`. Název výstupu se neodvozuje z titulku a aplikace jej nevymýšlí. Pokud jej projekt nezveřejní, tlačítko **Stáhnout BIN** zůstane neaktivní a zobrazí se přesný důvod.

Inventář ukládá produktové číslo, název produktu, Air RSSI, počet Air skoků a baterii pouze tehdy, když je poskytne `/data/status` daného Miniserveru. Přesná fotografie se přiřazuje podle tohoto šestimístného čísla nebo jednoznačného názvu a načítá z oficiálního produktového CDN Loxone Shop. Obecný typ `AirDevice` nebo `TreeDevice` nestačí k bezpečnému určení fyzického výrobku, proto se mu jiná fotografie nepřiřadí.

Tlačítko **Servisní balíček** vytvoří anonymizovaný ZIP se souborem `manifest.json` a následujícím obsahem:

- `miniserver.json`: identita, firmware a poslední provozní stav,
- `health.json`: nejvýše 25 posledních diagnostických snímků,
- `devices.json`: inventář prvků a dostupná telemetrie včetně Air RSSI,
- `availability.json`: nejvýše 500 posledních událostí dostupnosti,
- `project-changes.json`: nejvýše 100 souhrnů změn projektu,
- `def.log`, nebo při nedostupnosti bezpečný `def.log.error.txt` pouze s kódem chyby.

ZIP neobsahuje hesla ani tokeny, známé zákaznické identifikátory jsou v anonymním režimu nahrazené a odkaz ke stažení platí 24 hodin.

U instalace **HA Vágner** se každých 30 sekund samostatně kontroluje integrace MELCloud, pět klimatizačních jednotek, jejich lokální ping, příliš dlouho čekající zápis, teploty, ventilátor a polohy lamel. U instalace **HA Herškovič** se stejným intervalem kontroluje větrná elektrárna přes autorizovaný Home Assistant Ingress doplňku SolarInvert Logger: health/ready stav, USB, cloud, spojení s Loxone a každý ze dvou střídačů zvlášť. Centrální HA Práce proto nemusí otevírat ani opakovaně oslovovat vzdálený port 8765.

## Data a zálohy

Databáze, šifrovací klíč, relace a přístupy k Miniserverům zůstávají v `/data` hlavního HA Práce. Standardní záloha Home Assistantu tato data zahrnuje.

Pro vzdálenou šifrovanou zálohu nastavte na HA Práce `backup_encryption_key` (32 náhodných bajtů v Base64) a `backup_pull_token` (nejméně 32 znaků). GitHub workflow stáhne pouze AES-256-GCM zašifrovaný soubor. Obnovovací klíč nesmí být uložen jako GitHub secret ani commitnut do repozitáře; patří do chráněné konfigurace HA Práce a do samostatné Klíčenky správce.
