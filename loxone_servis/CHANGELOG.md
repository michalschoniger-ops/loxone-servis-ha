# Changelog

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
