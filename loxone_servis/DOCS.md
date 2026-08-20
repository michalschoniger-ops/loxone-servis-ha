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

## Denní synchronizace Loxone Partner Portalu

Správce může v **Nástroje → Synchronizace Loxone Partner Portalu** propojit firemní účet a okamžitě načíst seznam registrovaných Miniserverů. Další synchronizace proběhne automaticky jednou za 24 hodin pouze na centrálním HA Práce; HA Domov i weboví klienti používají stejná centrální data a nevytvářejí další požadavky.

Heslo se odešle jen při navázání relace a aplikace je neukládá do databáze, logu ani konfigurace. Ukládá pouze obnovovací token zašifrovaný stejným AES-256-GCM klíčem jako ostatní servisní přístupy. Pokud Loxone relaci zneplatní nebo změní přihlašovací rozhraní, synchronizace se bezpečně zastaví a správce musí účet znovu propojit.

Import porovnává záznamy podle sériového čísla. Nový Miniserver založí bez servisního hesla; u již známého záznamu aktualizuje typ, datum registrace a název projektu pouze dokud jej stále spravuje portál. Ruční změny přístupů, složek, Gateway/Client vazeb, poznámek a cíle firmware nepřepisuje a záznamy, které z portálu zmizí, automaticky nemaže.

## 1-Wire historie a aplikační dohled

Online teplotní 1-Wire čidla rodiny 28 se při pravidelné kontrole Miniserveru ukládají pouze do centrální databáze HA Práce. Jednotlivé vzorky se uchovávají 13 měsíců a denní minimum, průměr a maximum 5 let. HA Domov data pouze zobrazuje přes `canonical_base_url` a nic lokálně neukládá.

U instalace **HA Vágner** se každých 30 sekund samostatně kontroluje integrace MELCloud, pět klimatizačních jednotek, jejich lokální ping, příliš dlouho čekající zápis, teploty, ventilátor a polohy lamel. U instalace **HA Herškovič** se stejným intervalem kontroluje větrná elektrárna přes autorizovaný Home Assistant Ingress doplňku SolarInvert Logger: health/ready stav, USB, cloud, spojení s Loxone a každý ze dvou střídačů zvlášť. Centrální HA Práce proto nemusí otevírat ani opakovaně oslovovat vzdálený port 8765.

## Data a zálohy

Databáze, šifrovací klíč, relace a přístupy k Miniserverům zůstávají v `/data` hlavního HA Práce. Standardní záloha Home Assistantu tato data zahrnuje.

Pro vzdálenou šifrovanou zálohu nastavte na HA Práce `backup_encryption_key` (32 náhodných bajtů v Base64) a `backup_pull_token` (nejméně 32 znaků). GitHub workflow stáhne pouze AES-256-GCM zašifrovaný soubor. Obnovovací klíč nesmí být uložen jako GitHub secret ani commitnut do repozitáře; patří do chráněné konfigurace HA Práce a do samostatné Klíčenky správce.
