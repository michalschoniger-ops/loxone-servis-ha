# Changelog

## 3.0.15.1

- Nasazuje Evora Smart Hub 3.0.15 s pětisekundovým prověřením druhého streamu, transparentním fallbackem po úvodním i pozdějším výpadku, bezpečným údajem o skutečném zdroji rámce a úklidem odpojených odběratelů před zaplněním limitu.
- Součástí jsou Evora Smart Menu 3.0.9 s pravdivým označením úsporného náhledu a Windows Config Launcher 3.0.0.3 s bezokenním watchdogem přes `wscript.exe`; helper zachovává databázi, názvy kamer, DPAPI párování, čtecí Excel/Graph nastavení, šifrovaná připojení i vratnou kopii zdroje 3.0.14.

## 3.0.14.1

- Nasazuje Evora Smart Hub 3.0.14 s transparentním přechodem z nedostupného druhého streamu na zmenšený hlavní stream a s ARM profilem hlavního detailu 1280 px / 10 fps / dva kodérovací workery.
- Součástí je Evora Smart Menu 3.0.8 s pravdivým označením úsporného streamu; helper zachovává databázi, vlastní názvy kamer, čtecí Excel/Graph nastavení, šifrovaná připojení i vratnou kopii zdroje 3.0.13.

## 3.0.13.1

- Nasazuje Evora Smart Hub 3.0.13 se souvislým zabezpečeným přenosem druhého streamu v přehledu a Menu 3.0.7 a hlavního streamu v detailu kamery.
- Sdílí jednu FFmpeg/RTSP relaci stejné kamery a kvality mezi klienty, při odchodu posledního diváka ji ukončí a zachovává databázi, vlastní názvy kamer, čtecí Excel/Graph nastavení, šifrovaná připojení i vratnou kopii zdroje 3.0.12.

## 3.0.12.1

- Nasazuje Evora Smart Hub 3.0.12 s opravou HTTP 400 při načtení seznamu ze staršího Milesight NVR, zabezpečenými RTSP náhledy a přejmenováním kamer, které přežije obnovení seznamu.
- Odděluje kamery fialovou barvou od oranžových incidentů v Hubu i Evora Smart Menu 3.0.6 a zachovává databázi, čtecí Excel/Graph nastavení, šifrovaná připojení i vratnou kopii zdroje 3.0.11.

## 3.0.11.1

- Nasazuje Evora Smart Hub 3.0.11 s podporou serverem nabídnutého Basic ověření staršího Milesight NVR až po anonymní výzvě 401; privátní síť, šifrované uložení a ochrana URL/logů zůstávají zachované.
- Zachovává databázi, čtecí Excel/Graph nastavení a vratnou kopii zdroje 3.0.10; součástí Hubu je Evora Smart Menu 3.0.5 s živě aktualizovanou verzí Hubu a vždy viditelnou položkou Kamery.

## 3.0.10.1

- Nasazuje Evora Smart Hub 3.0.10 s opraveným Milesight Digest přihlášením podle skutečné výzvy NVR a přesné SDK cesty včetně dotazu.
- Zachovává databázi, čtecí Excel/Graph nastavení, šifrovaná připojení a vratnou kopii zdroje 3.0.9; součástí Hubu je instalační balíček Evora Smart Menu 3.0.4 s kamerami a samostatným označením verze Menu i Hubu.

## 3.0.9.1

- Nasazuje Evora Smart Hub 3.0.9 s párováním dlouhých Excel požadavků podle plného textu a přísně omezeným sloučením čerstvého systémového duplikátu bez uživatelského obsahu.
- Zachovává databázi, čtecí Graph nastavení, šifrovaná připojení a vratnou kopii zdroje 3.0.8; Evora Smart Menu zůstává ve verzi 3.0.3.

## 3.0.8.1

- Nasazuje Evora Smart Hub 3.0.8 se zabezpečenými náhledy Milesight kamer, čtecí Graph synchronizací Excelu bez duplicit a Evora Smart Menu 3.0.3 s diagnostikou Miniserverů.
- Zachovává databázi, importované Excel úkoly, šifrovaná připojení a vratnou kopii zdroje 3.0.7.

## 3.0.7.1

- Nasazuje Evora Smart Hub 3.0.7 s dokončeným kontrastním auditem tmavého režimu a automatickou kontrolou WCAG AA pro hlavní textové a stavové barvy.
- Zachovává 27 importovaných Excel úkolů, databázi, šifrovaná připojení i vratnou kopii zdroje 3.0.6.
- Evora Smart Menu a Windows klient zůstávají 3.0.1 a Config Launcher 3.0.0.2.

## 3.0.6.1

- Nasazuje Evora Smart Hub 3.0.6 s úplným tmavým motivem a volbou Světlý, Tmavý nebo Automaticky v Nastavení.
- Udržuje desktopovou správu uživatelů v jednom kompaktním řádku a přidává chráněný prvotní import původního XLSX bez přenosu Office hesla.
- Zachovává databázi, šifrovaná připojení a vratnou kopii zdroje 3.0.5; Evora Smart Menu a Windows klient zůstávají 3.0.1 a Config Launcher 3.0.0.2.

## 3.0.5.1

- Nasazuje Evora Smart Hub 3.0.5 s kompaktní správou uživatelů na desktopu i iPhonu, uzavřením mobilní šířky a zřetelnou mezerou před firmwarem.
- Zachovává databázi, šifrovaná připojení, Excel konfiguraci a vratnou kopii zdroje 3.0.4.
- Evora Smart Menu a Windows klient zůstávají 3.0.1 a Config Launcher 3.0.0.2.

## 3.0.4.1

- Nasazuje Evora Smart Hub 3.0.4 s chráněnou úspornou diagnostikou a ručním spuštěním synchronizace servisních úkolů z Excelu.
- Zachovává hodinový idempotentní import, databázi, šifrovaná připojení a vratnou kopii zdroje 3.0.3; obsah úkolů ani sdílený odkaz nejsou součástí diagnostiky či payloadu.
- Evora Smart Menu a Windows klient zůstávají 3.0.1 a Config Launcher 3.0.0.2.

## 3.0.3.1

- Nasazuje Evora Smart Hub 3.0.3 s bezpečným, idempotentním importem aktivních servisních úkolů ze sdíleného Excelu, ruční a hodinovou synchronizací a viditelným stavem zdroje.
- Přidává iPhone opravy přetékání, kompaktní správy uživatelů a mezery u firmwaru; Evora Smart Menu a Windows klient zůstávají 3.0.1 a Config Launcher 3.0.0.2.
- Zachovává databázi, šifrovaná připojení a vratnou kopii zdroje 3.0.2; veřejný Excel odkaz zůstává mimo payload a ukládá se jen do chráněných voleb cílového add-onu.

## 3.0.2.1

- Nasazuje čistě hubový grafický patch Evora Smart Hubu 3.0.2: čitelné a zarovnané desktopové uživatele, nezkrácený text globálního hledání a větší českou diagnostiku Windows Launcheru.
- Zachovává Evora Smart Menu a Windows klienta 3.0.1, Config Launcher 3.0.0.2, databázi, šifrovaná připojení i vratnou kopii zdroje 3.0.1.

## 3.0.1.2

- Dokončí bezpečnou výměnu zdroje i tehdy, když Supervisor během přesunu vloží vlastní soubor do izolované stagingové složky; zbytek ponechá pro diagnostiku a neoznačí úspěšně připravený zdroj jako chybu.
- Nemění instalační payload Evora Smart Hubu 3.0.1 ani jeho kontrolní součet.

## 3.0.1.1

- Nasazuje Evora Smart Hub a Evora Smart Menu 3.0.1 s globálním hledáním v celé aplikaci, sjednoceným mobilním formulářem a uživatelskými kartami, nativním trackpadovým posuvem ticketů a významovými ikonami dialogů.
- Přidává Windows klienta 3.0.1 s odděleným stálým heartbeat a podmíněným sběrem dat; obsahuje Config Launcher 3.0.0.2 s opraveným přechodem ze starší instalace bez runtime souboru.
- Zachovává databázi, šifrovaná připojení a vratnou kopii předchozího lokálního zdroje.

## 3.0.0.5

- Opravuje profilovou fotografii v desktopové patičce i mobilní nabídce: textová pravidla už nezasahují avatar a obal má pevnou shodnou šířku i výšku.
- Obrázek vyplňuje celý kruhový obal pomocí `object-fit: cover` bez tyrkysového podkladu okolo fotografie.
- Zachovává vratnou kopii zdroje, databázi i šifrovaný obsah `/data`; opravený vzhled čeká po nasazení na cílenou živou kontrolu.

## 3.0.0.4

- Nahrazuje výchozí ikonu složky ve všech nativních oknech Evora Smart Menu významovou ikonou dané akce nebo značkou Evora.
- Opravuje trackpadový posuv detailu ticketu odstraněním vlastní skokové animace; scrollbar, klávesnice i gesto dvěma prsty používají jeden nativní scroll container.
- Obsahuje aktuální balíček Evora Smart Menu 3.0.0 a zachovává vratnou kopii zdroje, databázi i šifrovaný obsah `/data`.

## 3.0.0.3

- Nasazuje aktuální ověřený Hub 3.0.0 s bezpečnými inline náhledy ticketových obrázků, čitelnými stavy a sjednoceným načítáním detailu.
- Aktualizuje Evora Smart Menu 3.0.0: přímá hierarchie Systémů, významové barvy, dvouřádkový stav Intranetu a obrázek i stav konkrétního Miniserveru.
- Zachovává úplnou vratnou kopii nahrazovaného zdroje; databázi ani šifrovaný obsah `/data` nemění.

## 3.0.0.2

- Obnovuje runtime Hubu 3.0.0 z aktuálního ověřeného payloadu i tehdy, když má připravený lokální zdroj stejné číslo verze.
- Obsahuje Windows Config Launcher 3.0.0.1 s DNS/TLS/health preflightem, bezpečným předáním párování po prvním heartbeat a odebráním přístupu počítače bez mazání lokálních Windows souborů.
- Před výměnou zachová úplnou vratnou kopii právě nahrazovaného zdroje 3.0.0; databázi ani šifrovaný obsah `/data` nemění.

## 3.0.0.1

- Nasazuje Evora Smart Hub 3.0.0 a Evora Smart Menu 3.0.0 s jednotnou navigací, značkou Intranetu, plynulým ticketovým náhledem a opravenou docházkou přes půlnoc.
- Obsahuje Windows Config Launcher 3.0.0.0 s oznamovací ikonou, stavovou diagnostikou, automatickou aktualizací a bezpečným znovupárováním.
- Před výměnou zachová úplnou vratnou kopii zdroje 2.2.5; databázi, šifrované přístupy ani jiný obsah `/data` nemění.

## 2.2.5.2

- Opravuje instalační runtime 2.2.5 tak, aby používal již ověřený produkční build a při sestavení na Home Assistantu nevyžadoval vývojové TypeScript soubory.
- Zachovává globální hledání v Hubu i Evora Smart Menu 5.8.5, databázi, šifrovaná připojení a vratnou kopii předchozího zdroje.

## 2.2.5.1

- Nasazuje Evora Smart Hub 2.2.5 s kontakty a žádostmi o absenci v Intranetu, barevnými buňkami postranního menu, zelenou ikonou „e“ a kompaktní správou uživatelů.
- Obsahuje globální hledání v celé nabídce Hubu i ve všech podsložkách Evora Smart Menu 5.8.5; Smart Menu zachovává živý čas, jasný stav sledování a nezobrazuje počet nepřečtených upozornění.
- Zachovává databázi, šifrovaná připojení a úplnou vratnou kopii zdroje 2.2.4.

## 2.2.4.1

- Nasazuje Evora Smart Hub 2.2.4 a Windows Launcher 2.1.1.0 s bezpečným znovuspárováním pomocí nového jednorázového kódu.
- Obsahuje mobilní zarovnání Intranetu, kruhovou fotografii bez barevného podkladu a WorkLogAI 5.8.3 s viditelnými ikonami menu.
- Zachovává databázi, šifrovaná připojení a úplnou vratnou kopii zdroje 2.2.3.

## 2.2.3.1

- Nasazuje Evora Smart Hub 2.2.3 s jediným mobilním odhlášením, odděleným názvem a časem Intranetu a jednotným názvem `Úkoly`.
- Zachovává databázi, šifrovaná připojení, WorkLogAI 5.8.2 a úplnou vratnou kopii zdroje 2.2.2.

## 2.2.2.1

- Nasazuje Evora Smart Hub 2.2.2 s plynulejší mobilní postranní nabídkou, izolovaným sekundovým časem docházky, jednotnými mobilními buňkami, animovaným logem, vloženou Home Assistant ikonou a kompaktní kartou Docházkové akce.
- Zachovává databázi, šifrovaná připojení, WorkLogAI 5.8.2 a úplnou vratnou kopii zdroje 2.2.1.

## 2.2.1.1

- Nasazuje bezpečnostní opravu Evora Smart Hub 2.2.1, která odstraňuje query stringy včetně starších API klíčů z provozních logů.
- Používá aktuální mapování `local_apps`, zachovává úplnou vratnou kopii zdroje 2.2.0 a nemění databázi ani uložená připojení.

## 2.2.0.2

- Používá aktuální mapování `local_apps` se zachovanou cestou `/addons`; Supervisor už nehlásí zastaralý typ `addons`.

## 2.2.0.1

- Nasazuje Evora Smart Hub 2.2.0 se správcovskou integrací Evora Intranetu, živým časem docházky, měsíční historií a přehledem přítomnosti.
- Sjednocuje mobilní menu, odstraňuje duplicitní odhlášení a opravuje čtyři hlavní akce Miniserverů včetně ikon a zalamování.
- Obsahuje WorkLogAI 5.8.2 se samostatným Keychain helperem; před výměnou zachová úplnou vratnou kopii zdroje 2.1.2.

## 2.1.2.2

- Nasazuje Evora Smart Hub 2.1.2 s opraveným spouštěním aktualizací Home Assistantu podle skutečné podpory záloh.
- Přidává přesné bezpečné chybové stavy a sjednocuje rozměry mobilních tlačítek a ovládacích prvků servisních úloh.
- Opravuje katalogový obraz tak, aby použil již sestavený runtime a nevyžadoval vývojové TypeScript soubory.
- Zachovává schéma databáze 18, šifrované přístupy a úplnou vratnou kopii zdroje 2.1.1.

## 2.1.1.1

- Nasazuje opravné vydání Evora Smart Hub 2.1.1, které bezpečně zachytí dočasné selhání 1-Wire monitoringu a neshodí celý proces.
- Zachovává schéma databáze 18, šifrované přístupy a úplnou vratnou kopii zdroje 2.1.0.

## 2.1.0.1

- Nasazuje Evora Smart Hub 2.1.0 s jednotnými stavy dat, centrem incidentů, servisními profily a interními servisními úkoly.
- Přidává devítikrokový tester připojení a diagnostiku Windows Launcheru 2.1.0.0 s ověřenou automatickou aktualizací.
- Zachovává databázi, šifrované přístupy a úplnou vratnou kopii zdroje 2.0.10.

## 2.0.10.1

- Nasazuje Evora Smart Hub 2.0.10 s postupnou obnovou flotily, samostatnou aktualizací Health Checku, LoxAPP3 a 1-Wire a opraveným BIN exportem Statistik V2.
- Přidává dostupnou Air telemetrii, přesné fotografie z oficiálního Loxone Shop CDN a úplný popis anonymizovaného servisního balíčku.
- Zachovává databázi, šifrované přístupy a vratnou kopii zdroje 2.0.9; Windows Config Launcher ani WorkLog AI nemění.

## 2.0.9.1

- Nasazuje Evora Smart Hub 2.0.9 s opraveným mobilním menu, barevnými složkami, čitelnými tickety a animovaným stavem údržby.
- Přidává bezpečný seznam a stahování programových záloh Miniserveru; ZIP se před vydáním důsledně ověří a aktuální program má bezpečnou záložní cestu.
- Obsahuje WorkLogAI integraci 2.0.9 s přehledně rozdělenou komunikací ticketů.
- Zachovává databázi, šifrované přístupy a vratnou kopii zdroje 2.0.8.

## 2.0.8.1

- Nasazuje Evora Smart Hub 2.0.8 s dotykovým dialogem data registrace na iPhonu, sbaleným firmware souhrnem a přesným zarovnáním ikon a textů v Podpoře.
- WorkLogAI integraci nemění; stávající balíček 2.0.7 zůstává kompatibilní.

## 2.0.7.1

- Nasazuje Evora Smart Hub 2.0.7 s opravou hlavního účtu a profilové fotografie, přesnými stavy dostupnosti, odolnou cache ticketů a sjednoceným mobilním menu.
- Obsahuje odpovídající WorkLogAI integraci 2.0.7 a jednorázové bezpečné zopakování cíle Loxone App při studeném startu na iPhonu.
- Zachovává databázi, šifrované přístupy a vratnou kopii zdroje 2.0.6.

## 2.0.6.1

- Nasazuje Evora Smart Hub 2.0.6 s opraveným přehledem příloh ve WorkLogAI: názvy bez bezpečné adresy už nevypadají jako nefunkční stažení.
- Zachovává ověřený vratný postup, šifrovanou cache ticketů a všechny opravy vydání 2.0.5.

## 2.0.5.1

- Nasazuje Evora Smart Hub 2.0.5, který v komunikaci ticketů nezaměňuje běžné webové odkazy za přílohy.
- Skutečné souborové/download odkazy zůstávají dostupné a názvy příloh bez URL se bezpečně zobrazí bez nefunkčního tlačítka.
- Zachovává databázi, cache, přístupy a vratnou kopii zdroje 2.0.4.

## 2.0.4.1

- Nasazuje opravné vydání 2.0.4, jehož `/healthz` správně potvrzuje databázové schéma 15 použité pro šifrovanou cache ticketů.
- Zachovává přílohy a lokální cache v Hubu i WorkLogAI, mobilní rozvržení bez Configu a Windows Launcher 2.0.0.3.
- Před výměnou ponechá vratnou kopii zdroje 2.0.3 a nemění datový adresář aplikace.

## 2.0.3.1

- Nasazuje Evora Smart Hub 2.0.3 s trvalou šifrovanou cache ticketů; běžné otevření Hubu ani WorkLogAI už nestahuje celý seznam z Portálu znovu.
- Zobrazuje odkazy na skutečně dostupné přílohy a také bezpečné informační štítky u souborů, ke kterým Portál v odpovědi neposkytne adresu.
- Přidává finální mobilní menu bez Configu, odstraňuje rozmazání detailu, opravuje správu profilových fotografií a aktualizuje Windows Launcher na 2.0.0.3.
- Zachovává databázi, šifrované přístupy i vratnou kopii stávající verze 2.0.2.

## 2.0.2.1

- Nasazuje Evora Smart Hub 2.0.2 s integrovaným správcovským centrem Loxone ticketů, úplným náhledem před každým odesláním a odpovídajícími funkcemi v WorkLog AI.
- Přidává spravovatelná zobrazovaná jména uživatelů, výchozí jméno hlavního správce, přesnou normalizaci loginu `admin` pro Windows Config Launcher a finální mobilní rozvržení.
- Zachovává databázi, šifrované přístupy i vratnou kopii stávající verze 2.0.0 nebo 2.0.1.

## 2.0.0.1

- Nasazuje Evora Smart Hub 2.0.0 s dokončeným Windows/Parallels Config Launcherem, automaticky obnovovaným přihlášením k Partner Portalu a okamžitým označením nově importovaných Miniserverů.
- Synchronizuje stav Weather Service; aktivní službu označí oficiálním symbolem v barvách EVORA, zatímco neaktivní ani neznámý stav nezobrazuje.
- Obsahuje opravené profilové fotografie, iPhone rozvržení, skutečné náhledy Miniserverů ve WorkLog AI a ověřený návratový payload 1.0.3.

## 1.0.3.1

- Nasazuje Evora Smart Hub 1.0.3 s osobním Windows/Parallels Config Launcherem, WorkLog AI pouze pro správce a automatickým obnovením přihlášení k Partner Portalu.
- Payload obsahuje finální produkční build včetně čistých instalačních ZIPů a zachovává databázi, chráněnou konfiguraci i vratnou kopii předchozího zdroje.

## 1.0.2.1

- Nasazuje Evora Smart Hub 1.0.2 s opravenou denní synchronizací všech registrovaných Miniserverů z Loxone Partner Portalu.
- Synchronizace ověřuje portálovou relaci i odpověď API a bezpečně odmítne neúplný import místo falešně úspěšného prázdného výsledku.

## 1.0.1.1

- Nasazuje Evora Smart Hub 1.0.1 s bezpečnou denní synchronizací Loxone Partner Portalu a opravami mobilního odhlášení, profilových fotografií, podpory a grafu 1-Wire.
- Před výměnou zachová kompletní vratný zdroj 1.0.0 a nijak nemění datový adresář ani uložené šifrované přístupy.

## 1.0.0.2

- Odstraňuje z instalačního payloadu rozšířená metadata macOS, která na Linuxu zanechávala skryté soubory v dočasné složce.
- Doplňuje bezpečné opakované předání cílového Miniserveru při studeném startu Loxone App na iOS.

## 1.0.0.1

- Připravuje vratné nasazení Evora Smart Hubu 1.0.0 s Config Bridge, Home Assistant Fleet, barevnými složkami, LOXONE podporou, produktovými náhledy a profilovými fotografiemi.

## 0.5.2.1

- Nasazuje Evora Smart Hub 0.5.2 s přesným inventářem prvků, souhrny celých instalací a grafy 1-Wire ověřenými pro Mac, iPad i iPhone.
- Přidává bezpečné přihlášení pomocí passkeys a zachovává vratnou kopii předchozího zdroje i veškerá data aplikace.

## 0.5.1.1

- Nasazuje Evora Smart Hub 0.5.1 s rozbalovací sekcí LOXONE bez spojovací grafiky.
- Přidává samostatný desetiminutový sběr teplot 1-Wire přes poslední ověřenou trasu bez dotazů na Remote Connect.
- Zachovává datový adresář i vratnou kopii předchozího zdroje.

## 0.5.0.2

- Obsahuje finální sestavení 0.5.0 s vlastním nastavením hesla, českými názvy rolí a omezením servisních interních údajů pouze na správce.
- Přidává cílovou politiku firmwaru a kompaktnější mobilní karty bez změny uložených dat aplikace.

## 0.5.0.1

- Připravuje ověřený balíček Evora Smart Hub 0.5.0 a před výměnou zachová kompletní vratný zdroj stávající instalace.
- Podporuje bezpečný přechod z lokálních verzí 0.4.14 a 0.4.15 na 0.5.0 bez změny datového adresáře aplikace.

## 0.4.13.1

- Připravuje ověřený balíček Evora Smart Hub 0.4.13 a před výměnou zachová kompletní vratný zdroj 0.4.12.
- Opakované spuštění bezpečně rozpozná už připravený zdroj 0.4.13.

## 0.4.12.4

- Obnovovací archiv nyní obsahuje i Dockerfile a vstupní skript nutné k opětovnému sestavení 0.4.10.
- Při přechodu z 0.4.10 se vratná záloha vytváří z ověřeného archivu a původní zdroj se zachová odděleně pro diagnostiku.

## 0.4.12.3

- Přidává ověřený obnovovací zdroj 0.4.10 pro situaci, kdy je nový zdroj už připravený, ale kontejner ještě běží na 0.4.10.
- Zabraňuje přepsání vratné zálohy novým zdrojem při opakovaném nasazení stejné verze.

## 0.4.12.2

- Payload je vytvořen bez macOS rozšířených atributů, které na Linuxu zanechávaly skrytý soubor v dočasné složce a chybně ukončily jinak hotovou výměnu.

## 0.4.12.1

- Payload obsahuje mobilní opravu bezpečných zón iPhonu a ochranu proti automatickému přibližování formulářů.
- Verze helperu byla zvýšena, aby Supervisor načetl nový ověřený payload místo dříve uložené kopie.

## 0.4.12

- První jednorázový, vratný instalační helper pro lokální Evora Smart Hub.
- Přidán kontrolovaný rollback na přesně zaznamenanou předchozí verzi.
