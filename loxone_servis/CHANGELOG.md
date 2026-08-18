# Changelog

## 0.5.0

- Mobilní karty Miniserverů jsou výrazně kompaktnější; stav spojení a počet online prvků jsou v horním řádku a verze firmware je vedlejší údaj.
- Každý Miniserver může sledovat vždy aktuální Stable verzi, nebo zůstat připnutý na právě zjištěném firmware. Hromadná aktualizace zahrne jen online zařízení s cílem `Vždy aktuální`.
- Každý přihlášený uživatel si může bezpečně změnit vlastní heslo. Role Technik nevidí servisní úlohy, integrace, schopnosti backendu ani jejich chráněná API.
- Všech šest souhrnných karet flotily je klikacích. Každá vysvětlí přesnou definici ukazatele a otevře odpovídající filtrovaný seznam Miniserverů.
- Config je v navigaci vizuálně vnořený pod LOXONE. Složky zůstávají ve výchozím stavu sbalené a samostatný Miniserver se nezobrazuje s nadbytečnou rolí.
- MELCloud dohled běží každých 30 sekund a zobrazuje aktuální i cílovou teplotu, výkon ventilátoru a svislou i vodorovnou polohu lamel.
- Dohled větrné elektrárny na HA Herškovič používá autorizovaný Home Assistant Ingress a samostatně vyhodnocuje logger i oba střídače.
- Detail 1-Wire čidel zobrazuje teploty a offline čidlo se započítá mezi offline prvky Miniserveru.
- Stable, Beta a Alpha Config se kontrolují každé 4 hodiny a předchozí oficiální odkazy se uchovávají v archivu verzí.

## 0.4.15

- SolarInvert Logger na HA Herškovič se kontroluje přes autorizovaný Home Assistant Ingress, takže centrální HA Práce nepotřebuje přímý přístup na vzdálený port 8765.
- Dohled dál vyhodnocuje health/ready stav loggeru a oba střídače samostatně; Ingress relace ani dlouhodobý HA token se neukládají do výsledků nebo logů.

## 0.4.14

- Levá nabídka používá originální značky LOXONE a Home Assistant; přihlašovací karta už nezobrazuje nadbytečné pravé logo EVORA SMART.
- Stránky LOXONE a Home Assistant mají výraznější zelený a modrý nádech. Nezařazené projekty se zobrazují jako `Ostatní`.
- Projektové číslo lze upravit přímo v seznamu. Miniservery bez přístupu nebo nedostupné se v každé složce automaticky řadí na konec.
- Zelený stav `Aktuální` se zobrazí jen při shodě online a celkového počtu prvků; chybějící prvek přepne stav do oranžového upozornění.
- Teploty online 1-Wire čidel rodiny 28 se ukládají do centrální databáze na HA Práce. Detailní vzorky se uchovávají 13 měsíců a denní minimum, průměr a maximum 5 let; HA Domov zůstává bezstavovým klientem.
- Detail Miniserveru má záložku `1-Wire` s grafem a rozsahy 24 hodin, 7 dní, 30 dní, 13 měsíců a 5 let.
- HA Vágner samostatně hlídá stav integrace MELCloud, všech pět klimatizačních jednotek, lokální ping a příliš dlouho čekající zápis.
- HA Herškovič samostatně hlídá větrnou elektrárnu přes SolarInvert Logger na `homeassistant-herskovic.skunk-atria.ts.net:8765`, jeho health/ready stav, USB, cloud, Loxone spojení a každý ze dvou střídačů zvlášť.
- Specializované aplikační dohledy běží každé 2 minuty; běžný dohled Home Assistant instalací zůstává dvouhodinový.

## 0.4.13

- Složky projektů jsou po otevření přehledu ve výchozím stavu sbalené; podsložky se zobrazí až po rozbalení svého rodiče.
- V seznamu se role zobrazuje pouze u skutečné Gateway nebo Clienta. Samostatný Miniserver nemá zbytečný štítek a z názvu se samostatně zvýrazní projektové číslo `ESM-26-001` nebo `PRO-21-0029`.
- Online teplotní 1-Wire čidla rodiny 28 zobrazují aktuální hodnotu ve stupních Celsia; hodnota se načítá postupně přes uloženou trasu a bez dalšího volání Remote Connect resolveru.
- Offline 1-Wire čidlo se započítá mezi offline prvky. Chyba samostatného čtení teploty ale nevytváří falešný offline stav Miniserveru ani čidla.
- Stable, Beta a Alpha kanály z `updatecheck.xml` se kontrolují nejvýše jednou za 4 hodiny i při chybě zdroje. Při změně se původní verze a její oficiální odkaz přesunou do trvalého archivu ke stažení.

## 0.4.12

- Detail Miniserveru má novou záložku Exporty pro strukturu LoxAPP3, systémové statistiky, katalog statistik a měsíční XML statistiky.
- Statistiky V2 lze stáhnout v oficiálním binárním raw formátu s výběrem prvku, skupiny, výstupu, období a seskupení.
- Správce může stáhnout aktuální kompilovaný programový ZIP ze SD karty. Aplikace jej vydá jen po přesném porovnání vloženého LoxAPP3 s právě běžícím projektem a nezaměňuje jej za editovatelný soubor `.Loxone`.
- Všechny exporty jsou pouze na vyžádání, zapisují se do auditu, mají pevné limity velikosti a v celé centrální instalaci probíhá nejvýše jeden vzdálený export současně.
- Souběžné požadavky na stejný export se sloučí a omezená fronta brání tomu, aby HA Domov nebo více otevřených prohlížečů zatížilo Remote Connect duplicitními dotazy.
- Otevření Loxone App na iPhonu už necílí na nadřazený rámec Home Assistantu. Přímé klepnutí naviguje aktivní rámec, takže Safari i HA Companion mohou předat oficiální `loxone://ms` odkaz nainstalované aplikaci.

## 0.4.11

- Opravené přístupy k monitorovaným Home Assistantům používají správné HTTPS Tailscale adresy; dlouhodobé tokeny zůstávají uložené šifrovaně pouze na centrálním HA Práce.
- Individuální kontrola Home Assistantu už neukládá jeho UUID do vazby určené pro sériová čísla Miniserverů, takže neselhává chybou databázového cizího klíče.
- Potvrzené smazání Home Assistantu posílá platný JSON požadavek; server už chybu nepodporovaného typu dat nevydává za vnitřní selhání aplikace.
- Bezpečnostní CSRF token je stabilní v rámci jedné přihlášené relace, takže otevření aplikace ve druhé kartě nezneplatní formulář v první kartě.
- Pokud klient přesto narazí na zastaralý CSRF token po aktualizaci, bezpečně jej jednou obnoví a původní změnu jednou zopakuje bez duplicitních zápisů.

## 0.4.10

- Po restartu čekají automatická hromadná kontrola i automatické opakování chyb celý nastavený interval. Restart tak nemůže okamžitě spustit vlnu dotazů na Remote Connect; ruční kontrola jednoho Miniserveru zůstává dostupná.

- Opraveno kritické zahlcování Remote Connect: pravidelná kontrola nejprve používá naposledy funkční dynamickou trasu a resolver zavolá pouze po skutečném selhání této trasy.
- Resolverové požadavky jsou globálně řazené nejvýše po jednom za 10 sekund, souběžné dotazy na stejné SN se sloučí a odpověď HTTP 429 aktivuje nejméně 30minutovou pojistku bez dalších pokusů.
- HA Práce je jediný vykonavatel kontrol LOXONE: HA Domov zůstává bezstavový klient bez vlastního plánovače a všechny požadavky z klienta i webu se na centrálním serveru sloučí podle SN nebo hromadné úlohy.
- Ověřování probíhající aktualizace kontroluje firmware nejvýše jednou za 2 minuty; automatické denní procházení topologie bylo zrušeno a zůstává jen jako vědomě spuštěná servisní akce.
- Odkaz „Otevřít a přihlásit“ už nevkládá do Loxone App zastaralý dynamický Remote Connect port; stabilní CloudDNS adresa podle SN vyřeší aktuální trasu až při otevření.
- Přehled LOXONE nově samostatně ukazuje počet Miniserverů, které odpovídají, které potvrzeně neodpovídají a kolik jich ještě nebylo ověřeno.
- Odpověď s odmítnutým přihlášením se správně počítá jako síťově odpovídající Miniserver, ale zůstává označená „Bez přístupu“.

## 0.4.9

- Aplikace se nově jmenuje Evora Smart Hub a používá diagonálně spojenou identitu LOXONE a Home Assistant.
- Hlavní navigace rozlišuje zelenou část LOXONE a modrou část Home Assistant; rozhraní zůstává responzivní pro iPhone, iPad, Mac a Home Assistant Ingress.
- „Flotila“ se přejmenovala na „LOXONE“ a „Firmware“ na „Config“.
- Uživatel s rolí pouze pro čtení neuvidí Servis ani Uživatele; servisní API je nově stejně omezené i na backendu.
- Slug, databáze a šifrované přístupy zůstávají beze změny, takže aktualizace zachová veškerá produkční data.

## 0.4.8

- Přidána samostatná záložka Home Assistant s dvouhodinovým monitoringem Tailscale, Nabu Casa a privátních LAN adres.
- Přehled ukazuje dostupnost, odezvu a poslední kontrolu; volitelný dlouhodobý token bezpečně načte verzi Core a název instalace.
- Přístupy k Home Assistantu se ukládají šifrovaně, zobrazují se jen na vyžádání a nikdy se nevkládají do URL.
- Krátký výpadek Miniserveru už okamžitě nepřepíše naposledy potvrzený online stav; následují dvě opakované kontroly s pětiminutovým odstupem.
- Tlačítko `+` ve správci složek má vlastní akční buňku a nepřekrývá počet zařízení ani sousední pole.
- Desktopové rozhraní používá kompaktní levé menu a přihlašovací stránku ve stylu Loxone Partner Portalu; tablet a telefon zůstávají bez vodorovného posouvání.
- Partner Portal je dostupný bezpečným externím odkazem; soukromá data se bez oficiálního OAuth/API oprávnění nenačítají ani nescrapují.

## 0.4.7

- Složky lze vkládat do dalších složek; výběry ukazují úplnou cestu jako `Dolní Morava / Melori` a API brání cyklům.
- Migrace zachová všechna dosavadní přiřazení Miniserverů; při smazání rodiče se podsložky bezpečně posunou o úroveň výš.
- Safari používá pro textová pole i výběry shodnou výšku 44 px a nativní výběr už nerozbíjí dvousloupcový formulář.
- Otevření Loxone App probíhá přímo z klepnutí bez prázdného okna; citlivé přístupy se dál načítají jen na vyžádání.
- UI respektuje oprávnění rolí a nenabízí divákům či technikům operace, které backend nepovoluje.
- Lokální URL Miniserveru je omezena na soukromé adresy a odkazy na Loxone Config pouze na oficiální domény Loxone.
- Anonymizovaný servisní balíček odstraňuje identifikátory i z vnořených dat; statická aktiva mají bezpečnou cache politiku a přísnější CSP.
- Skrytá karta neprovádí zbytečné 30sekundové obnovování a selhání načtení je v UI zřetelně označeno jako zastaralý stav.
- Přidána automatická kontrola ESLint a rozšířené testy zabezpečení, hierarchie, rolí a responzivního rozhraní.

## 0.4.6

- Formulářové dialogy už v Safari a Home Assistant Ingressu nepřetékají vodorovně mimo dostupnou plochu.
- Dvousloupcová pole se mohou bezpečně zmenšit podle šířky iframe; ovládací prvky nikdy nepřesáhnou svůj sloupec.
- Dialog se posouvá pouze svisle uvnitř okna a na telefonu respektuje skutečnou dynamickou výšku displeje.

## 0.4.5

- Nezařazený Client se už vizuálně neodsazuje pod nesouvisející Miniserver; stromová větev vznikne jen při konkrétní a platné vazbě na zobrazenou Gateway.
- Client bez doložené rodičovské Gateway je v seznamu výslovně označen jako „bez přiřazené Gateway“.
- Správce složek má u každé složky tlačítko `+` s vyhledáváním a hromadným výběrem Miniserverů.
- Členství ve složce se ukládá atomicky a může bezpečně přesunout Miniserver z jiné složky.

## 0.4.4

- Neplatný přihlašovací formulář vrací bezpečnou odpověď `400 VALIDATION_ERROR` místo interní chyby 500.
- Globální zpracování chyb se registruje před pluginy a routami, takže se do odpovědi nepropíší interní detaily frameworku.

## 0.4.3

- Při krátkém výpadku CloudDNS aplikace ověří Miniserver přes naposledy úspěšně potvrzenou trasu, která není starší než 6 hodin.
- Samotná chyba CloudDNS už neoznačí Miniserver jako nedostupný; zobrazí se jako odložená kontrola a interní kód `resolver_error` nahradí srozumitelné upozornění.
- Přidána bezpečně ohraničená veřejná cesta `/api/loxone-servis/` pro HA Práce a Tailscale Funnel.
- HA Domov umí klientský režim i tehdy, když veřejná HTTPS adresa hlavní instalace používá cestu za názvem hostitele.

## 0.4.2

- Hromadná kontrola omezuje počet souběžných cloudových resolverů na dva.
- Přechodnou chybu nebo timeout resolveru zopakuje až třikrát s odstupem, než Miniserver označí jako nedostupný.

## 0.4.1

- Klíček v seznamu jedním klepnutím zkopíruje heslo; dialog s přístupy otevírá pouze telefon.
- Spuštění Loxone App používá oficiální `loxone://ms` URL schéma a ověřenou adresu Miniserveru.
- Opravena bílá stránka Safari při lokálním HTTP přístupu přes Home Assistant Ingress.
- HTML, JS a CSS se po aktualizaci neposílají ze zastaralé cache.

## 0.4.0

- Automatické rozpoznání role Gateway, Client nebo samostatný Miniserver z LoxAPP3 WebService.
- Jednoznačně doložené vazby Client → Gateway se zobrazují hierarchicky; neurčené vazby se nehádají.
- Přidány editovatelné složky projektů pro přehledné seskupení více Miniserverů.
- Role, vazbu i složku lze ručně upravit; ruční nastavení automatická kontrola nepřepíše.

## 0.3.0

- HA Práce může fungovat jako jediný hlavní server a HA Domov jako bezstavový klient.
- Změny, uživatelé a přístupy se zapisují jen do jedné centrální databáze.
- Přidána autentizovaná plně šifrovaná záloha databáze a chráněné konfigurace.
- Přidán denní GitHub backup workflow a ověřovací nástroj obnovy.

## 0.2.1

- bezpečný Node.js backend a migrace původní databáze
- stable/beta/alpha verze z oficiálního Loxone XML
- diagnostika Miniserveru, prvků, projektu, uživatelů a provozních režimů
- potvrzované aktualizace, restarty a hromadné operace
- vlastní účty, role, audit a TOTP 2FA
- kompaktní desktopové a iPhone rozhraní
- opravené automatické sestavení vícearchitekturního obrazu
