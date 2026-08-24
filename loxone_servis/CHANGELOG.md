# Changelog

## 3.0.23

- Náhledová mřížka otevírá úsporné HLS video přímo, bez desetisekundového čekání na WebRTC a bez blokujícího serverového preflightu. Deset dlaždic se spouští s 450ms rozestupem místo 1,2 sekundy; detail jedné kamery nadále preferuje nízkolatenční WebRTC.
- Server už při načtení playlistu sám nestahuje a nezahazuje poslední video segment. Každý segment tak spotřebuje pouze skutečný přehrávač a relace se po krátkém zobrazení obrazu sama nerozpojí.
- Pravdivý stav zůstává zachovaný: označení „živě“ se zobrazí až po dvou skutečně dekódovaných snímcích a zamrzlý obraz po osmi sekundách přejde do omezeného automatického obnovení.

## 3.0.22

- HLS relace se během delší mezery mezi klíčovými snímky udržuje skutečným stažením posledního video segmentu. Opravuje to pětisekundové vypršení relace interní brány, které na živém NVR po několika segmentech ukončovalo šest z deseti kanálů.
- Před předáním relace klientovi Hub ověří inicializaci a dva různé video segmenty po dobu až 20 sekund. Průběžné playlisty stejným mechanismem bezpečně obnovují relaci bez MJPEG, překódování nebo zveřejnění RTSP přístupu.
- Nativní HLS Safari a iPhonu smí vyjednat H.264 i HEVC; Hls.js v ostatních prohlížečích dostává pouze H.264. Kamera s HEVC náhledem tak může na podporovaném zařízení hrát bez zbytečného převodu, zatímco nepodporovaný prohlížeč dostane kompatibilní proud.

## 3.0.21

- WebRTC média používají nový vyhrazený TCP/UDP port 28555, který se shoduje uvnitř kontejneru, v Supervisor mapování i v ICE kandidátech. Odstraňuje se konflikt s již obsazeným portem 18555 na HA Práce.
- HLS záloha před předáním klientovi ověří inicializaci a tři po sobě postupující video segmenty. Nefunkční druhý stream uvolní a bezpečně zkusí hlavní H.264 stream; prohlížeč tak nedostane relaci, která se po dvou segmentech zastaví.
- Dlaždice označí stream jako živý až po dvou skutečně dekódovaných video snímcích. Osmisekundové zamrznutí spustí bezpečný přechod z WebRTC na HLS nebo nový pokus; dočasná chyba už nezůstane trvale ve spinneru ani ve falešném stavu „živě“.
- Aktivní multipart/MJPEG endpointy Hubu a Menu byly odstraněny. Volitelná správcovská funkce nastavení třetího MJPEG profilu kamery zůstává oddělená a není používána pro přehrávání obrazu.
- Evora Smart Menu 3.0.12 při stavu přestávky odpočítává 30 minut po sekundách, zobrazuje zbývající `MM:SS` přímo v řádku Intranetu a v horní liště používá výrazné `☕ MM:SS`.

## 3.0.20

- Firemní Milesight RTSP už není pro Hub překódován na sled samostatných JPEGů. Interní, checksumem ověřená video brána přebaluje kompatibilní H.264/H.265 beze změny obrazu; Hub používá WebRTC a při nedostupném přímém mediálním spojení automaticky přejde na zabezpečené HLS přes stejnou HTTPS adresu.
- Mřížka používá úsporný NVR substream a detail hlavní stream. Přenos se spouští jen pro viditelné karty, RTSP přístup zůstává pouze v paměti a správcovské API video brány i její RTSP listener poslouchají výhradně na loopbacku. Veřejně je otevřen pouze šifrovaný WebRTC mediální port.
- Evora Smart Menu 3.0.11 nahrazuje JPEG náhled nativním `AVPlayer` HLS videem s krátkým bufferem, automatickým opakováním a autorizací v HTTP hlavičce; token ani RTSP adresa nejsou v URL.
- Připojovací stav karty zobrazuje pouze vystředěný spinner. Tmavý režim globálního hledání sjednocuje průhledné pozadí inputu s obalem, takže pod ikonou nezůstává odlišný obdélník.

## 3.0.19

- Postranní nabídka Hubu řadí hlavní systémy podle provozní priority: LOXONE, Home Assistant, Milesight, Intranet, Incidenty, Úkoly a Nastavení. Stejné pořadí používá desktop i mobilní vysouvací nabídka.
- Veřejná Home Assistant proxy 0.1.1 ponechává obsluhu `OPTIONS` na HTTP vrstvě Home Assistantu, takže se komponenta při startu znovu správně načte a veřejná adresa funguje také pro Evora Smart Menu.
- Při zavření dlouhého kamerového náhledu proxy vždy ukončí odpovídající upstream relaci. Opuštěný MJPEG stream tak nemůže vyčerpat sdílená spojení a zablokovat další požadavky Hubu nebo Menu.

## 3.0.18

- Přehled Milesight spouští náhledové relace jednotlivých kamer s řízeným rozestupem 700 ms. NVR tak po otevření stránky nedostane deset současných RTSP/FFmpeg inicializací; čekající dlaždice ukazuje pravdivý stav „Čeká na uvolnění NVR“ a vlastní watchdog začne až po skutečném startu přenosu.
- Otevření detailu stále okamžitě pozastaví všechny náhledy a dá hlavnímu 1280×720 streamu prioritu. Po zavření detailu se náhledy znovu obnoví stejným řízeným pořadím.

## 3.0.17

- Živý read-back všech deseti kanálů odhalil, že některé NVR substreamy po připojení nejprve vracejí šedé nebo částečně rozpadlé dekódované snímky. Hub nyní zahazuje poškozené a nízko-informační zahřívací rámce, čeká na dva po sobě jdoucí použitelné JPEGy a FFmpeg nastavuje na zahazování poškozených paketů.
- Při otevření detailu se ukončí všech deset náhledových relací pod modalem, aby hlavní stream nesoutěžil o RTSP relace a výkon NVR. Po zavření detailu se mřížka znovu připojí.
- Náhled i detail mají konečný watchdog a nejvýše dva automatické pokusy. Pokud obraz nedorazí, spinner skončí pravdivým stavem „Obraz momentálně není dostupný“; označení „živě“ se zobrazí až po skutečně načteném rámci.
- Kanál bez potvrzeného NVR Channel Access už nespouští nekonečné zjišťování schopností kamery. Hub ponechá funkční živý obraz a přesně vysvětlí, proč zatím nelze otevřít třetí stream ani VCA nastavení.

## 3.0.16

- Sekce **Milesight** zachovává online i offline kanály NVR, používá oficiální značku a zobrazuje skutečný stav přístupu ke každé kameře. Síťovým cílem zůstává výhradně NVR; kamerové CGI se volá přes ověřený Channel Access port daného kanálu.
- Hub nejdřív načte schopnosti konkrétní kamery. Třetí stream zapne jako MJPEG pouze tehdy, když kamera sama potvrdí podporované rozlišení a snímkovou frekvenci, zvolí nejvyšší potvrzenou kombinaci a po zápisu provede úplný read-back. Ověřený třetí MJPEG stream předává souvisle; při jeho absenci zachová dosavadní sdílený NVR stream.
- U podporovaných VCA událostí lze načíst a upravit tři HTTP cíle, metodu a interval. Uložené heslo se nikdy neposílá klientovi; prázdné pole jej zachová a výslovné smazání je samostatná volba. Uložení se potvrdí novým čtením z kamery.
- Evora Smart Menu 3.0.10 přejmenovává kategorii na **Milesight**, používá oficiální značku a nadále ukazuje vlastní verzi odděleně od živé verze Hubu.
- Windows Config Launcher 3.0.0.4 zachovává při automatickém stažení Home Assistant ingress prefix a zpožděný restart spouští přes bezokenní VBS obálku.
- Microsoft Graph synchronizace Excelu zůstává pouze pro čtení; přesun nebo drobná změna řádku aktualizuje stejný Hub úkol a zápis do Excelu je vypnutý.

## 3.0.15

- Každý kamerový náhled nejprve po dobu nejvýše pěti sekund prověří skutečný druhý stream a potom bez přerušení klienta použije zmenšený hlavní stream. Každý multipart rámec nese bezpečný údaj `substream` nebo `main-fallback`, takže živá kontrola může prokázat skutečný zdroj po jednotlivých kamerách bez zveřejnění RTSP adresy či přístupu.
- Pomalý nebo odpojený odběratel se po pěti sekundách trvalého backpressure odstraní a uvolní sdílený FFmpeg proces. Staré relace tak nezaplní limit a nezpůsobí dalším kamerám HTTP 503.
- Windows Config Launcher 3.0.0.3 nahrazuje přímý minutový start `powershell.exe` bezokenní VBS obálkou přes `wscript.exe`; automatická aktualizace opraví existující watchdog i autostart bez nového párování.
- Evora Smart Menu 3.0.9 a Hub označují výstup jako úsporný náhled, nikoli neověřený druhý stream.

## 3.0.14

- Živý test 3.0.13 odhalil, že cílový starší Milesight NVR nenabízí očekávanou cestu druhého streamu `ch_4xx`. Úsporný stream nyní tuto cestu bezpečně zkusí a bez přerušení klienta automaticky přejde na zmenšený hlavní `ch_1xx`; nikde nezveřejní RTSP adresu ani přístup.
- Detail hlavního streamu používá 1280 px, 10 fps a dva kodérovací workery místo 1600 px/15 fps s jedním workerem. Snižuje tím objem jednotlivých JPEG rámců a zvyšuje skutečnou plynulost na ARM hostiteli.
- Evora Smart Menu 3.0.8 označuje náhled pravdivě jako úsporný stream bez tvrzení, že každý NVR skutečně poskytl samostatný druhý stream.

## 3.0.13

- Nahrazuje periodické JPEG snapshoty souvislým autorizovaným přenosem. Přehled Hubu i Evora Smart Menu 3.0.7 používají úsporný druhý Milesight stream `ch_4xx`; detail po kliknutí otevírá kvalitnější hlavní stream `ch_1xx`.
- Pro stejnou kameru a kvalitu Hub sdílí jediný FFmpeg proces mezi klienty, pomalému klientovi zahazuje starší rámce a po odpojení posledního diváka RTSP relaci okamžitě ukončí. Karty mimo viewport a skrytá karta prohlížeče žádný stream nedrží.
- NVR přístupy i RTSP adresa zůstávají pouze v jednorázovém stdin FFmpegu. Browser i Menu dostávají autorizované `multipart/x-mixed-replace` bez hesla, RTSP URL nebo dlouhodobého tokenu v adrese.

## 3.0.12

- Opravuje HTTP 400 na starším Milesight NVR. Hub už nespojuje podporovaný `get.camera.ipclist` s nepodporovaným systémovým příkazem; načítá pouze seznam, který používá i webové rozhraní tohoto firmwaru.
- Náhled obrazu používá zdokumentované RTSP kanály `ch_1xx` přes TCP. Přihlašovací RTSP adresa se předává FFmpegu pouze jednorázovým stdin, nikdy v argumentech procesu, prohlížeči ani logu.
- Správce a technik mohou každou kameru přejmenovat přímo v kartě. Vlastní název zůstane zachovaný i po obnovení seznamu z NVR.
- Kamery mají v Hubu samostatnou fialovou navigační barvu odlišnou od oranžových incidentů. Evora Smart Menu 3.0.6 používá pro kategorii Kamer stejnou fialovou sémantiku.

## 3.0.11

- Přidává kompatibilitu se starším Milesight NVR, které po prvním anonymním požadavku nabídne pouze HTTP Basic. Hub neposílá přihlášení předem, údaje nevkládá do URL ani logu a cílovou adresu dál omezuje výhradně na privátní IPv4 síť.
- Zachovává preferenci podporovaného Digest přihlášení, pokud jej zařízení nabídne, a zpřesňuje text formuláře: údaje jsou šifrované v Hubu, zatímco způsob LAN přihlášení určuje NVR.
- Evora Smart Menu 3.0.5 opravuje neaktuální záhlaví. Po úspěšném načtení API se text „Hub nepřipojen“ okamžitě změní na skutečnou živou verzi Hubu; `Systémy → Kamery` zůstávají viditelné i před načtením prvního kanálu a nabídnou přímé nastavení NVR.

## 3.0.10

- Opravuje připojení Milesight NVR: Hub už nevyrábí vlastní neplatný Digest nonce, ale nejprve načte skutečnou výzvu zařízení a podepíše přesnou cestu SDK včetně dotazu.
- Digest přihlášení podporuje `MD5`, `MD5-sess`, `qop=auth`, volitelný `opaque` a jeden bezpečný nový pokus při zastaralém nonce. Uživatelské jméno ani heslo se neposílají v URL a heslo se nadále ukládá pouze šifrovaně.
- Evora Smart Menu 3.0.4 zachovává `Systémy → Kamery` se zabezpečeným náhledem konkrétního kanálu a v záhlaví nově rozlišuje vlastní verzi od živě načtené verze Hubu. Excel zůstává pouze pro čtení směrem do Hubu.

## 3.0.9

- Opravuje párování dlouhých Excel požadavků: podobnost se počítá z celého pole „Požadavek“ uloženého v popisu, nikoli ze zkráceného 240znakového titulku. I změna na konci dlouhého textu tak aktualizuje stejné ID úkolu.
- Při dalším importu bezpečně sloučí čerstvý systémový duplikát vzniklý starším párováním pouze tehdy, když jde o téměř totožný řádek, záznam nemá lokálně změněný stav a neobsahuje komentář, přílohu, štítek ani uživatelskou událost.
- Excel zůstává pouze pro čtení směrem do Hubu a Evora Smart Menu zůstává ve verzi 3.0.3.

## 3.0.8

- Přidává tenantově omezené Microsoft Graph device-code připojení pro organizační SharePoint bez klientského tajemství nebo uloženého Office hesla. Obnovovací token je šifrovaný a hodinový import začne až po úspěšném připojení správce.
- Excel běží pouze směrem do Hubu. Přesunutý řádek se nejprve páruje stabilním otiskem a drobná změna místa nebo požadavku omezenou podobností, takže upraví stejné ID úkolu místo vytvoření duplikátu. Runtime neodesílá Graph `PATCH`; dokončení zůstává pouze v Hubu.
- Přidává zabezpečené připojení Milesight NVR v privátní síti HA Práce. Přístupy jsou šifrované AES-256-GCM a nikdy se nevkládají do URL, klientského JavaScriptu ani argumentů procesu.
- Nová stránka Kamery je společně dostupná v desktopové i mobilní navigaci Hubu, automaticky načítá online kanály z NVR a nabízí úsporné náhledy i rychlejší detail vybrané kamery.
- Evora Smart Menu 3.0.3 zobrazuje v `Systémy → Kamery` zabezpečený velký náhled konkrétní kamery a v detailu Miniserveru ověřený poměr prvků online/celkem, počet offline prvků, Health stav, stáří kontroly a odezvu. Globální hledání slučuje rychlé vstupy a během psaní odkládá síťové překreslení, aby se AppKit nezablokoval.

## 3.0.7

- Dokončuje kontrastní audit tmavého režimu napříč formuláři, navigací, modaly, diagnostikou, tickety, úkoly, Intranetem, uživateli, zálohami a mobilní nabídkou. Bílé pomocné plochy a odstíny určené pro světlé pozadí dostaly vlastní tmavé povrchy a čitelné texty.
- Zvyšuje kontrast pomocných textů a placeholderů, zachovává čitelné zakázané hodnoty i automaticky doplněná pole Safari/Chromia a sjednocuje hover, aktivní položky, scrollbar a výběr textu.
- Zelené, červené, oranžové, modré a fialové datové stavy mají samostatné tmavé dvojice popředí a pozadí. Automatický test nově hlídá minimální WCAG AA kontrast klíčových tokenů a stavů.
- Evora Smart Menu a Windows klient zůstávají ve verzi 3.0.1, Config Launcher ve verzi 3.0.0.2; tento balíček mění pouze Hub.

## 3.0.6

- Přidává v Nastavení volbu Světlý, Tmavý a Automaticky podle zařízení. Volba se ukládá v daném prohlížeči, automatický režim živě sleduje systém a motiv se nastaví ještě před vykreslením aplikace bez světlého probliknutí.
- Tmavý režim mění celý povrchový systém Hubu: navigaci, panely, karty, tabulky, formuláře, modaly, detailní zásuvky, tickety, úkoly, Intranet, diagnostiku i mobilní nabídku. Stavové barvy zůstávají významově odlišené.
- Desktopová správa uživatelů drží jméno, e-mail, poznámku hlavního správce, fotografické akce, roli, 2FA, poslední přihlášení a stav v jednom kompaktním řádku; samostatné dotykové rozložení telefonu zůstává zachované.
- Přidává chráněný import původního XLSX pro bezpečné prvotní naplnění Úkolů v situaci, kdy organizační SharePoint vyžaduje Microsoft 365 přihlášení. Import používá stávající šifrovaný administrační token, kontroluje formát i limit 25 MB a nepřenáší Office heslo.
- Evora Smart Menu a Windows klient zůstávají ve verzi 3.0.1, Config Launcher ve verzi 3.0.0.2; tento balíček mění pouze Hub.

## 3.0.5

- Zmenšuje desktopové pole jména na stejnou 36px výšku jako ostatní buňky a omezuje jeho šířku, aniž mění velikost textu.
- Na iPhonu zmenšuje uživatelské karty, avatary a fotografické akce, zachovává bezpečný 16px font editovatelného pole a uzavírá tabulku do šířky viewportu bez vodorovného posunu.
- Přidává zřetelnou stabilní mezeru mezi informační ikonou registrace a verzí firmwaru a v Hubu zobrazuje diagnostiku Windows Launcheru česky.
- Evora Smart Menu a Windows klient zůstávají ve verzi 3.0.1, Config Launcher ve verzi 3.0.0.2; tento balíček mění pouze Hub.

## 3.0.4

- Přidává úsporný interní stav a ruční spuštění synchronizace servisních úkolů z Excelu, chráněné stejným silným tokenem jako šifrovaná záloha.
- Diagnostika vrací jen počty a stav synchronizace, takže už není nutné stahovat velkou databázovou zálohu ani zveřejňovat obsah úkolů.
- Evora Smart Menu a Windows klient zůstávají ve verzi 3.0.1, Config Launcher ve verzi 3.0.0.2; tento balíček mění pouze Hub.

## 3.0.3

- Úkoly načítají aktivní řádky z listu `PROGRAMOVÁNÍ - DOKONČOVÁNÍ` sdíleného Excelu, bezpečně končí před oddílem `HOTOVO` a používají stabilní vazbu na řádek i otisk obsahu, takže hodinová nebo ruční synchronizace nevytváří duplikáty.
- Stav synchronizace, počet načtených řádků, poslední úspěch a případná chyba jsou vidět přímo v centru Úkoly. Sdílený odkaz je pouze pro čtení; Hub proto změnu stavu uchová lokálně a výslovně označí čekající zápis místo nepravdivého potvrzení změny původního Excelu.
- Mobilní stránka už nemůže odjet do prázdného pravého prostoru: kořen aplikace a obsah mají uzavřenou šířku a nabídka se odkrývá uvnitř viewportu bez prvku posunutého mimo obrazovku.
- iPhone správa uživatelů používá kompaktnější avatar, kartu a 44px ovládací prvky. Mezi registrační informační ikonou Miniserveru a verzí firmwaru je samostatná mezera.
- Text diagnostiky Windows Launcheru se dál skládá z českých stavových vět v Hubu; nový cache identifikátor 3.0.3 vynutí načtení této verze i na telefonu.
- Evora Smart Menu a Windows klient zůstávají ve verzi 3.0.1, Config Launcher ve verzi 3.0.0.2; tento balíček mění pouze Hub.

## 3.0.2

- Opravuje živým desktopovým screenshotem potvrzené přetékání a špatné zarovnání v tabulce uživatelů: řádky zůstávají kompaktní, ale jméno, e-mail, kruhový avatar, fotografické akce, role i stav mají čitelné jednotné rozměry.
- Pole globálního hledání používá krátký nezkrácený text „Hledat všude…“; nadále prohledává celou aplikaci, podsložky i datové záznamy.
- Diagnostika Windows Launcheru má čitelnou desktopovou typografii a všechny známé výsledky vysvětluje česky; technické ověřování a data heartbeat se nemění.
- Evora Smart Menu a Windows klient zůstávají ve verzi 3.0.1, Config Launcher ve verzi 3.0.0.2; jejich už ověřené balíčky se tímto čistě hubovým grafickým patchem nemění.

## 3.0.1

- Globální hledání Hubu nyní prochází celou aplikaci, dostupné podsekce i datové záznamy (Miniservery, složky, úkoly, incidenty, tickety a uživatele) a výsledek otevře přímo; nejde už jen o filtr postranní nabídky.
- Mobilní formulář absence, počítadlo, datumová pole, půlden a správa uživatelů používají sjednocené dotykové výšky, typografii a samostatný responzivní layout bez překryvů. Profilové fotografie a stavové tečky mají pevnou kruhovou geometrii.
- Evora Smart Menu 3.0.1 používá významové ikony ve všech vlastních dialozích, nativní setrvačný posun ticketu dvěma prsty a rekurzivní hledání v celé nabídce včetně podsložek.
- Windows Config Launcher 3.0.0.2 má bezpečné atomické přepárování, minutový uživatelský watchdog, ověřený heartbeat nové verze, úplný rollback při neúspěchu a bezpečné odebrání počítače z Hubu bez mazání lokálních Windows souborů.
- Windows klient Evora Smart Menu 3.0.1 odděluje trvalý online heartbeat od sběru pracovních dat, stav vysvětluje přímo v `WORK status` a minutový watchdog jej po pádu obnoví bez samovolného zapnutí sběru. Instalátor Config Launcheru navíc bezpečně zvládá přechod ze starších verzí bez runtime souboru.

## 3.0.0

- Evora Smart Hub a Evora Smart Menu jsou sjednocené do společného vydání 3.0.0. Hlavní hledání Hubu prochází bez diakritiky celou aplikaci: obrazovky a podsekce, Miniservery, složky, úkoly, incidenty, tickety a uživatele podle oprávnění; nalezený datový záznam rovnou otevře.
- Evora Smart Menu používá pro Evora Intranet stejnou zelenou značku `e` jako Hub. Detail ticketu ukazuje animovaný stav načítání, komunikaci dělí podle účastníků a přesný trackpadový posun zobrazuje plynule.
- Docházkové relace přes půlnoc se slučují do jediného pracovního záznamu přiřazeného dni začátku. Součet, historie i aktivní stav tak neztrácejí Home office nebo práci ukončenou po půlnoci.
- Sledování práce se automaticky řídí ověřeným aktivním stavem Evora Intranetu; při práci běží, při pauze se pozastaví a mimo docházku zůstává neaktivní.
- Windows Config Launcher 3.0.0.2 běží v oznamovací oblasti Windows s vlastní značkou a stavovou tečkou, umí ruční kontrolu aktualizace, otevření diagnostiky, DNS/TLS/health preflight a bezpečné znovupárování bez předčasného zneplatnění funkčního tokenu. Přihlášenou relaci hlídá minutová uživatelská úloha a neúspěšná výměna automaticky obnoví předchozí funkční instalaci. Hub může vybraný počítač odebrat bez mazání jeho lokálních Windows souborů.
- Správa uživatelů, složek, podpory a žádostí o absenci dostala kompaktní a responzivní geometrii bez přetékání textu; avatar zůstává skutečně kruhový.

## 2.2.5

- Hlavní nabídka Hubu má globální hledání bez ohledu na diakritiku. Prohledává i skryté podsložky LOXONE, Podpora a Nastavení, při shodě je otevře a po volbě obnoví běžný stav menu.
- Evora Smart Menu 5.8.5 dostalo stejné globální hledání. Prochází všechny nativní podsložky včetně Miniserverů, docházky, ticketů a systémových akcí a spouští přímo původní nalezenou položku.
- Správcovský Evora Intranet načítá z oficiálních stránek také pracovní kontakty a dovolené/absence. Telefon lze vytočit přímo a novou žádost nebo zrušení Hub zapisuje přes oficiální Intranet API s potvrzením a auditním záznamem bez poznámky.
- Postranní menu má jednotné řádky s jemně barevným pozadím podle sekce. Intranet používá bílou značku `e` na zeleném podkladu; aktivní stav je výraznější, ale geometrie se nemění.
- Desktopová správa uživatelů používá kompaktní padesátipixelové řádky a menší jednotné editory, avatary a stavová tlačítka. Mobilní uživatelské karty zůstávají samostatně dotykové.
- Evora Smart Menu 5.8.5 má značku Hubu v liště, barevné ikony a čitelné hodnoty, živý pracovní čas, přesný stav sledování a zobrazuje jen právě použitelnou akci pozastavit/pokračovat. Počet nepřečtených upozornění se v menu vůbec nevykresluje.
- Integrační balíček nově přenáší i značku Evora Smart Hubu a ověřuje její přítomnost před instalací. Uživatelské názvy v Hubu i instalátoru používají jednotně `Evora Smart Menu`.

## 2.2.4

- Windows Launcher 2.1.1.0 dostal výslovné bezpečné znovuspojení. Hub vytvoří nový jednorázový kód, balíček nabízí dvojklik `Opravit-parovani.cmd` a po úspěchu zneplatní starý token stejného Windows agenta; běžná aktualizace dál zachovává platné párování.
- Launcher nyní odmítnutý uložený token rozpozná jako chybu párování a uživatele nasměruje na opravný postup místo neurčité chyby spojení.
- Mobilní Intranet používá stejnou třísloupcovou geometrii jako ostatní řádky nabídky a stav s časem zůstává zarovnaný vpravo. Profilová fotografie je čistě kruhová bez barevného podkladu mimo snímek.
- WorkLogAI 5.8.3 vkládá symboly přímo do titulku položky NSMenuItem, takže macOS menu již nemůže potlačit samostatnou vlastnost ikony.

## 2.2.3

- Mobilní nabídka zobrazuje právě jedno odhlášení: profil a mobilní tlačítko tvoří jeden spodní blok a desktopový účet je na telefonu výslovně skrytý.
- Intranet má samostatný pravý sloupec pro stavovou tečku a čas, takže název ani běžící čas se nepřekrývají. Úplný stav zůstává dostupný jako popis prvku.
- Interní centrum i položka nabídky používají kratší jednotný název `Úkoly`.

## 2.2.2

- Živý sekundový čas Evora Intranetu je izolovaný pouze v malém stavovém řádku menu. Už každou sekundu nepřekresluje celou flotilu 137 Miniserverů ani otevřenou postranní nabídku.
- Mobilní panel se otevírá kompozičním posunem přes GPU místo průběžné změny polohy a jeho trvalá loga už neanimují náročný stín. Přihlašovací a aktualizační animace zůstávají zachované.
- Z karty Docházkové akce byl odstraněn počet upozornění a vysvětlující text je přitažen přímo pod nadpis.
- Intranet je v menu jednotná jednořádková položka se stavem vpravo. Home Assistant používá vloženou značku bez rizika rozbitého obrázku a přihlašovací, horní i mobilní logo dostalo viditelnou transformovou animaci s podporou systémového omezení pohybu.
- Velké mobilní akční a souhrnné buňky používají společnou výšku 76 px, jednotnou velikost hlavního a pomocného textu i ikon; navigační řádky a běžná ovládací tlačítka zůstávají ve svém jednotném dotykovém rozměru.

## 2.2.1

- Provozní log už nikdy neukládá query string požadavku. Starší klient tedy může dál používat původní URL, ale jeho API klíč, token ani jiný parametr se do logu nedostane.
- Zachovává všechny funkce, menu a správcovskou integraci Evora Intranetu z verze 2.2.0.

## 2.2.0

- Správce má v Evora Smart Hubu nové centrum `Evora Intranet → Docházka`. Bezpečně zobrazuje aktuální stav, právě běžící pracovní čas, příchod, odchod, Home office, služební cestu, měsíční souhrny, historii aktuálního a předchozího měsíce i přítomnost kolegů.
- Přihlašovací údaje a obnovovací token Evora Intranetu jsou odděleně šifrované pomocí AES-256-GCM. Integrace automaticky obnovuje relaci, rozlišuje přesné stavy dat, neposílá GPS a její API je dostupné pouze správci.
- Nativní WorkLogAI zobrazuje běžící docházku v liště i menu s přesností na sekundy jako `HH:MM:SS`; historie si zachovává čitelný hodinový souhrn.
- Mobilní i desktopové menu má jednotnou hierarchii: Podpora je pod LOXONE a Provozní log, Uživatelé a Nástroje jsou pod Nastavením. V každém rozvržení se zobrazuje jen jedno odhlášení.
- Horní akce flotily používají samostatné srozumitelné ikony a na telefonu stejně velké dvousloupcové dotykové buňky bez přetékání textu.

## 2.1.2

- Aktualizace Home Assistantu respektují příznak `supported_features`: záloha se vyžádá jen u entit, které ji skutečně podporují. Při zastaralém příznaku Hub bezpečně zopakuje instalaci bez nepodporované zálohy, takže fungují také HACS karty a doplňky bez funkce BACKUP.
- Odmítnutý token, nedostupný Home Assistant a odmítnutá aktualizační služba už nekončí neurčitou „Vnitřní chybou aplikace“, ale přesným bezpečným hlášením bez URL nebo tokenu.
- Mobilní akční tlačítka mají stejnou šířku a výšku; filtry, uložené pohledy a jejich tlačítka používají jednotnou dotykovou výšku 44 px.

## 2.1.1

- Opravuje provozní pád plánovače, který mohl při dočasném síťovém selhání jednoho 1-Wire Miniserveru ukončit celý proces Hubu. Chyba se nyní bezpečně zapíše do auditu bez hesla, tokenu nebo adresy a další monitoring pokračuje.
- Odděleně zachytává také neočekávané chyby odpojených běhů plánovače, takže jedna chybná kontrola neshodí web, health endpoint ani ostatní Miniservery.

## 2.1.0

- Každý Miniserver a dílčí zdroj rozlišuje osm explicitních stavů: načítání, aktuální, zastaralý, nedostupný, odmítnuté přihlášení, chybějící přístup, údaj neposkytnutý zdrojem a interní chyba Hubu.
- Nové centrum incidentů slučuje opakované výpadky a provozní závady podle stabilního fingerprintu, hlídá závažnost, odpovědnou osobu a SLA a uchovává komentáře i historii; po potvrzeném zotavení automaticky uzavírá průběžně monitorované incidenty.
- Gateway a samostatné Miniservery mají servisní profil se zákazníkem, kontaktem, adresou, smlouvou, zárukou, další kontrolou, vlastními poli a barevnými tagy. Client profil je pouze pro čtení a dědí kontakt své Gateway.
- Interní servisní úkoly nahrazují sdílený Excel: mají číslo, prioritu, stav, odpovědnou osobu, termín, připomenutí, vazbu na incident a Miniserver, kontakt, komentáře, historii, uložené pohledy a šifrované fotografie nebo PDF do 8 MB.
- Tester připojení postupně ověřuje DNS a síť, Remote Connect, Miniserver, TLS, přihlášení, `/data/status`, LoxAPP3 a Health Check, Partner Portal a osobní Windows Launcher. Chybějící přístup, odmítnuté heslo a síťová chyba mají odlišné výsledky.
- Windows Launcher 2.1.0.0 hlásí podpis, nainstalované Configy, UI Automation, oprávnění, spojení s Hubem, bezpečný protokol a automatickou aktualizaci. Aktualizaci stahuje z ověřeného manifestu Hubu a přijme ji pouze při přesné shodě SHA-256; při selhání ponechá Config otevřený pro ruční připojení a vrátí přesný krok chyby.
- Schéma databáze 18 přidává servisní profily, tagy, uložené pohledy, incidenty, interní úkoly, šifrované přílohy a historii testeru připojení.

## 2.0.10

- průběžná fronta obnovuje Miniservery jednotlivě s minimálním 30sekundovým rozestupem místo automatického nárazu celé flotily
- `/data/status`, firmware a dostupnost se obnovují v dvouhodinovém cyklu, Health Check po 12 hodinách, LoxAPP3 po 24 hodinách a 1‑Wire po 10 minutách
- V2 statistiky čtou aktuální `statisticV2.groups[].dataPoints[]`, takže lze vybrat skutečný výstup a stáhnout BIN
- inventář zachovává a zobrazuje dostupné Air RSSI, počet skoků, baterii, název produktu a produktové číslo
- rozšířené přesné produktové fotografie z oficiálního Loxone Shop CDN; obecné typy se nepřiřazují odhadem
- aplikace i manifest ZIPu přesně vysvětlují obsah anonymizovaného servisního balíčku
- přehled Miniserveru ukazuje stáří Health Checku a LoxAPP3 a úvod aplikace popisuje její účel a bezpečnostní model

## 2.0.9

- Mobilní nabídka znovu zobrazuje všechny tři názvy podpory, používá jednotnou velikost textu a ikon a po otevření nezachovává kompoziční transformaci ani rozmazávací filtr. Značka v hlavičce, přihlášení a aktualizační obrazovce má jemnou animaci respektující omezení pohybu v systému.
- Složky dostávají odlišné barvy z řízené palety. Databázová migrace jednorázově rozliší také staré duplicitní barvy bez změny přiřazení Miniserverů.
- Veřejná komunikace ticketů je rozdělena do čitelných zpráv podle účastníka a času; události se soubory jsou vizuálně odlišené. Stejné čitelné členění používá WorkLog AI.
- Během aktualizace HA Práce se po dříve úspěšném načtení zobrazí lokální animovaný stav a aplikace se sama znovu připojí. Service worker ukládá pouze statický shell a výslovně vynechává API, health endpoint i autentizovaná data.
- Stažení aktuálního programu nejdřív ověří všechny časově odpovídající archivy proti živému LoxAPP3. Pokud přesná shoda na SD kartě není, nabídne nejnovější validní zálohu s jasným prefixem `ZALOHA_` místo zavádějící chyby.
- Správce může bezpečně vypsat až 250 historických programových záloh z `/dev/fslist/prog/` a stáhnout pouze název, který je po kliknutí znovu ověřen v aktuálním katalogu. Obsahuje-li archiv bezpečný `sps.loxone`, vydá se přímo jako `.Loxone`; jinak zůstane původní ZIP.
- Databázové schéma je 16. Kontrola závislostí, TypeScript, ESLint, automatické testy, produkční build a nativní typecheck WorkLog AI jsou součástí vydání.

## 2.0.8

- Informační tlačítko u sériového čísla na iPhonu otevírá skutečné dotykové okno s názvem projektu, datem registrace z Partner Portálu a sériovým číslem; už není závislé na desktopovém hover efektu.
- Souhrn Firmware je při otevření přehledu Miniserverů sbalený do kompaktního řádku a čtyři firmware karty se zobrazí až po klepnutí.
- Všechny tři položky Podpory používají stejný pevný sloupec pro ikonu a shodný začátek textu, takže Partner Portal už není opticky posunutý.

## 2.0.7

- Profilové fotografie a úprava jména fungují také pro migrovaný hlavní účet s trvalým identifikátorem `owner-*`; povolený formát ID zůstává úzce omezený proti průchodu cestou.
- Dostupnost flotily rozlišuje čtyři vzájemně výlučné stavy: ověřeně online, bez přístupu, neodpovídá a neověřeno. Souhrn dostupnosti je oddělený od souhrnu firmware, takže se počty už významově nemíchají.
- Chyba aktualizace ticketů ani detailu už nesmaže lokální cache a nezobrazuje falešné globální hlášení. Seznam i komunikace jasně uvedou, že používají poslední uložená data, a nabídnou samostatné opakování.
- Mobilní a desktopové vnořené menu má jednotnou výšku, velikost textu a ikon. Automatická úvodní kontrola už nezobrazuje nesouvisející červený toast nad otevřeným detailem; případná chyba složky zůstává přímo v jejím panelu.
- Odkaz do Loxone App na iPhonu používá oficiální cíl `loc=home`, zachovává první otevření jako přímé klepnutí uživatele a při studeném startu provede právě jedno bezpečné zopakování kompletního cíle. Systémové potvrzení Passkey na iOS zůstává povinnou bezpečnostní součástí Face ID.
- WorkLogAI integrace je vydaná společně s Hubem 2.0.7 a při neúspěšné kontrole Portálu dál zachová již načtené tickety.

## 2.0.6

- WorkLogAI zobrazuje přílohy, u kterých Partner Portál poskytl pouze název, jako statický přehled bez falešného tlačítka pro stažení a bez následné technické chybové hlášky.
- Skutečně dostupné přílohy zůstávají oddělené a lze je bezpečně otevřít přes Evora Smart Hub.

## 2.0.5

- Při převodu komunikace na přílohy odlišuje skutečné souborové/download odkazy od běžných webových odkazů v textu ticketu.
- Zachovává šifrovanou cache, správné schéma 15, rychlé načítání Hubu i WorkLogAI a všechny opravy vydání 2.0.4.

## 2.0.4

- Opravuje stavový endpoint tak, aby po migraci správně hlásil databázové schéma 15 používané cache ticketů.
- Zachovává všechny opravy 2.0.3 pro přílohy, lokální cache, mobilní rozvržení, profilové fotografie a Windows Launcher 2.0.0.3.

## 2.0.3

- Windows Config Launcher 2.0.0.3 se umí bezpečně aktualizovat přímo ve stejném Windows účtu: ukončí jen přesně rozpoznaný starý helper daného uživatele, zachová stávající DPAPI token a bez nového párování spustí opravenou verzi.
- Hub rozpozná helper starší než 2.0.0.2, jasně vyžádá aktualizaci a do té doby mu nepředá přístupové údaje ani novou úlohu. Verze 2.0.0.2 zůstává funkční a pouze nabídne dostupnou aktualizaci.
- Stejný stav aktualizace se zobrazuje v Config Bridge, Nastavení i WorkLog AI, takže starší automatizace už neskončí neurčitou chybou až po vyplnění připojovacího dialogu.
- Mobilní nabídka používá stejnou hierarchii jako desktop v pravém výsuvném panelu; Config zůstává na telefonu zcela skrytý. Podpora má jednotnou výšku položek a mobilní karta bezpečně odděluje SN, datum registrace a firmware.
- Detail Miniserveru na iOS už nepoužívá rozmazávací vrstvu ani kompoziční animaci. Správa uživatelů má stabilní sloupce a profilová fotografie se načítá přímo z autentizovaného obrazového endpointu bez mezikroku přes FileReader.
- Centrum ticketů využívá celou výšku okna, oba sloupce se posouvají samostatně a tlačítko Odpovědět je dostupné i u uzavřeného ticketu v Hubu i WorkLog AI.
- Ticketový seznam a veřejná komunikace se ukládají do lokální cache; obsah komunikace a reference příloh jsou v databázi šifrované. Běžné otevření Hubu i WorkFlowAI už znovu nestahuje všech 140 ticketů; explicitní aktualizace porovná souhrny, přepíše jen změněné záznamy a detail načte znovu pouze po změně. Skutečné přílohy a odkazy vložené do zpráv se zobrazí samostatně a WorkFlowAI je umí bezpečně otevřít přes Hub.

## 2.0.2

- Správce má přímo v Evora Smart Hubu bezpečné centrum Loxone ticketů: seznam a filtrování, detail veřejné komunikace a příloh, založení ticketu i odpověď. Každé odeslání nejdřív ukáže úplný náhled a potom vyžádá heslo správce; technikům a uživatelům zůstávají jen původní externí odkazy.
- Stejné správcovské funkce ticketů jsou dostupné v nativním menu WorkLog AI. Token integrace nadále funguje jen aktivnímu správci a odpojení Macu vyčistí také načtené tickety.
- Účty mají samostatné zobrazované jméno. Správce je může upravit v sekci Uživatelé, přihlašovací e-mail zůstává beze změny a hlavní účet se doplní jako `Bc. Michal Schöniger`.
- Uložený vestavěný login Miniserveru se bez ohledu na původní zápis normalizuje na přesné `admin`, takže Windows Config Launcher už neposílá chybné `ADMIN`.
- Mobilní karty uživatelů a ticketů jsou upravené pro iPhone bez překrytí jména, fotografie, rolí a ovládacích prvků.

## 2.0.1

- Windows Config Launcher 2.0.0.2 používá pro uživatelské jméno a heslo přímý UI Automation `ValuePattern`, takže jej neovlivní Caps Lock. Vyhledává dialog uvnitř správného procesu, neduplikuje stav spuštění a úspěch potvrdí až po osmisekundové kontrole, že Config přihlášení neodmítl.
- Aktualizace Home Assistantu vyžadují pouze výslovné potvrzení bez hesla; správce může jedním potvrzením spustit všechny čekající aktualizace.
- Opravena skutečná příčina nezobrazených profilových fotografií v relaci. Správce může fotografii nahrát nebo odstranit také ostatním uživatelům.
- Passkey lze odstranit i přes Home Assistant Ingress a každý telefon či počítač si může zaregistrovat vlastní Face ID, Touch ID nebo Windows Hello klíč.
- Partner Portal a Tickety jsou přesunuty pod Podporu. Inventář ukazuje jen přesně rozpoznané produktové fotografie a neznámému prvku už nepřiřazuje zavádějící obecný obrázek.
- WorkLog AI zobrazuje u každého Miniserveru zelený nebo šedý stav a má vyhledávání podle projektu, složky, typu i SN bez ohledu na diakritiku.
- U SN je nové informační kolečko s datem registrace z Partner Portálu. Tlačítko Config používá vlastní rozpoznatelnou ikonu místo obecného dokumentu.

## 2.0.0

- Nové Miniservery importované z Partner Portálu se okamžitě označí jako `Nový z Portálu`, řadí se před ostatní, mají samostatný filtr a vyžádají doplnění loginu a hesla. Po uložení přístupu označení automaticky zmizí.
- Ruční synchronizace Portálu se sleduje až do skutečného dokončení a potom bez reloadu obnoví stránku Miniservery. Pozadí úloh po restartu sloučí staré duplicitní synchronizace do jediného pokusu.
- Přidáno bezpečné doplnění hesla pro automatické znovupřihlášení staršího portálového propojení, které dosud mělo jen obnovovací token.
- Partner Portal synchronizuje také svůj jednoznačný příznak aktivního Weather Service. U Miniserveru s aktivní službou se zobrazí původní zelená ikona Loxone; neaktivní ani nezjištěná služba se nezobrazuje.
- Windows Config Launcher 2.0.0.1 čeká na plně spuštěný Config, umí se vrátit z otevřeného projektu na Domů, otevře ruční připojení a po ustálení externí adresy znovu ověří login, heslo i aktivní tlačítko Připojit.
- WorkLog AI používá skutečné obrázky typů Miniserverů; Compact má transparentní pozadí. Odkaz ke stažení Configu se doplní z přesné čtyřdílné verze firmware i tehdy, když starší záznam nemá URL.
- Profilové fotografie z iPhonu i velké obrázky se před uložením převádějí na JPEG do 512 px a uživatel dostane konkrétní chybu nepodporovaného formátu. V postranní nabídce zůstává pouze LOXONE podpora a spodní panely Nastavení využívají celou šířku.

## 1.0.3

- Přidán osobní Windows Loxone Config Launcher. Každý uživatel páruje vlastní zařízení jednorázovým kódem; token je ve Windows chráněný pomocí DPAPI a Hub odešle přístupy pouze aktivnímu požadavku stejného uživatele.
- Launcher hledá přesnou verzi `LoxoneConfig.exe` podle firmwaru, bezpečně otevře ověřené okno ručního připojení, vyplní SN do externí adresy, login a heslo a při chybě nic jiného nespustí. Chybějící Config vrátí do Hubu i Windows s oficiálním odkazem ke stažení.
- Přidána integrace WorkLog AI výhradně pro správce na macOS. Osobní odvolatelný token je uložený v Klíčence; menu zobrazuje složky a Miniservery a nabízí Loxone App nebo Config přes Windows agenta správce.
- Loxone Partner Portal umí při zneplatnění obnovovacího tokenu provést jeden automatický nový login uloženým odděleně šifrovaným heslem. Odmítnuté údaje se smažou a dočasné chyby mají bezpečný odklad dalšího pokusu.
- Nastavení, Config Bridge, WorkLog panel a portál byly ověřeny v produkčním sestavení na šířkách iPhonu 390 a 430 bodů bez vodorovného přetečení, deformovaných obrázků nebo oříznutých ovládacích prvků.

## 1.0.2

- Opravena synchronizace Loxone Partner Portalu podle aktuálního přihlašovacího toku: aplikace nejprve vytvoří a ověří portálovou relaci a teprve poté načte registrované produkty.
- Denní import přijímá pouze skutečné Miniservery, normalizuje jejich typ a bezpečně odmítne neověřenou nebo neúplnou odpověď místo falešně úspěšné prázdné synchronizace.
- Živým testem bylo ověřeno načtení všech 137 registrovaných Miniserverů bez ukládání hesla k portálu.

## 1.0.1

- Správce může bezpečně propojit Loxone Partner Portal a jednou denně synchronizovat nově registrované Miniservery podle sériového čísla, typu, názvu projektu a data registrace.
- Heslo k Partner Portalu se používá pouze pro jednorázové přihlášení a nikdy se neukládá. Obnovovací token je uložený šifrovaně v centrálním HA Práce; při vypršení přístupu aplikace vyžádá nové připojení.
- Synchronizace je nedestruktivní: doplní nové záznamy a portálem spravované názvy, ale nepřepisuje servisní přístupy, složky, topologii, poznámky ani politiku firmware a sama nic nemaže.
- Mobilní nabídka má vždy dostupné odhlášení, Config se na telefonu nezobrazuje a profilová fotografie se správně načte i přes Home Assistant Ingress.
- Kontakty podpory používají přímé ikony telefonu a WhatsAppu; nefunkční prázdné vložení cizího chatu bylo odstraněno.
- Opraveno zarovnání ukazatele v grafu 1-Wire a přímý odkaz na seznam tiketů v Loxone Partner Portalu.

## 1.0.0

- Přidán viditelný bezpečný prostup do Loxone Configu: aplikace nabídne odpovídající verzi Configu, aktuální projekt, adresu Miniserveru a kopírování přístupů bez vkládání hesla do URL nebo příkazové řádky.
- Složky a podsložky mají volitelnou barvu; barevná hierarchie se propisuje do přehledu i správce složek.
- Home Assistant Fleet se jmenuje `Servery`, rozlišuje aktuální a čekající aktualizace a po potvrzení umí instalovat HA Core, Supervisor, OS, add-on i integrační aktualizace a restartovat vybraný Home Assistant.
- Miniservery se automaticky řadí: online a aktuální, ostatní online, nedostupné a nakonec zařízení bez přístupu.
- LOXONE navigace obsahuje Miniservery, Config, Partner Portal, tickety a podporu včetně dnešní pracovní doby, oficiálního chatu a bezpečného náhradního otevření oficiální stránky.
- Kontakty na českou LOXONE podporu a LOXONE Vácha jsou dostupné v postranní i mobilní nabídce včetně přímého volání a WhatsAppu.
- Známé rodiny Loxone prvků zobrazují při najetí nebo klepnutí oficiální produktový náhled; neznámý typ používá bezpečný obecný obrázek.
- Uživatelé mohou nahrát, změnit a odstranit vlastní profilovou fotografii. Fotografie se zobrazuje jako kruhový avatar u účtu a ve správě uživatelů.
- Interní servis, správa uživatelů a schopnosti backendu zůstávají skryté technikům podle rolí; restarty a aktualizace vyžadují opětovné potvrzení heslem a zapisují se do auditu.

## 0.5.2

- Počty Loxone prvků vycházejí pouze z posledního úplného `/data/status` snapshotu: fyzické SN se deduplikují, souhrnné řádky se ignorují a prvky odstraněné z nového snapshotu už nezůstávají falešně offline.
- Stav Miniserveru je oddělen od stavu jeho prvků. Řádek ukazuje `Odpovídá` nebo `Neodpovídá`; skutečný výpadek prvku se zobrazí oranžově jako `Online: x/y prvků`.
- Detail složky slučuje Miniservery všech podsložek a nabízí společný přehled prvků, souhrnný počet online/offline, vyhledávání a historii 1-Wire teplot.
- Graf 1-Wire má časovou a teplotní stupnici a při najetí nebo dotyku ukáže přesný čas a hodnotu vzorku. Jednotlivé prvky i 1-Wire lze vyhledávat.
- Sériové číslo je v přehledu zvýrazněné, firmware je kompaktnější a mobilní karty respektují iPhone safe-area bez automatického přiblížení.
- Přihlašování podporuje Passkeys přes WebAuthn: Face ID, Touch ID a Windows Hello. Registrace i přihlášení vyžadují ověření uživatele a jednorázovou krátce platnou challenge.
- Generátor hesel má jako výchozí délku 32 znaků, velká písmena a čísla; malá písmena a symboly zůstávají volitelné.
- Technik nevidí servisní úlohy, uživatelskou správu ani interní schopnosti backendu; chráněná API používají stejná oprávnění jako rozhraní.
- Zelené LOXONE a modré Home Assistant pozadí plynule vyplňuje dostupnou plochu na iPhonu, iPadu i Macu.

## 0.5.1

- LOXONE v navigaci nyní funguje jako rozbalovací rodič položky Config bez spojovací grafiky.
- Přechod na Home Assistant podnabídku Config automaticky skryje.
- 1-Wire teploty se ukládají samostatně každých 10 minut přes poslední ověřenou trasu bez dalších dotazů na Remote Connect.
- Offline 1-Wire čidlo se dál promítá jako offline prvek.

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
