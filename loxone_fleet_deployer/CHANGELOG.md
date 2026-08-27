# Changelog

## 3.0.54.1

- Nasazuje Evora Smart Hub 3.0.54 s úzkou opravou chybného UTF-8 překódování českého znaku v přesměrované cestě Loxone Cloud; jinou doménu či jiný povel nadále odmítne bez předání účtu.
- Zachovává Hub 3.0.53 jako vratný zdroj, úvodní animaci, databázové schéma 24, `/data`, uložená data i nativní Menu.

## 3.0.53.1

- Nasazuje Evora Smart Hub 3.0.53 s bezpečným jednorázovým HTTPS přesměrováním ovládání brány mezi důvěryhodnými servery Loxone Cloud; přihlášení se nikdy nepředá cizí doméně.
- Zachovává Hub 3.0.52 jako vratný zdroj, úvodní animaci, databázové schéma 24, `/data`, uložená data i nativní Menu.

## 3.0.52.1

- Nasazuje Evora Smart Hub 3.0.52 s jednorázovou animací úvodní obrazovky a s opraveným serverovým ovládáním brány přes dva HTTPS povely s šifrovaným Basic přihlášením.
- Zachovává Hub 3.0.51 jako vratný zdroj a nemění databázové schéma 24, `/data`, uložená data ani nativní Menu.

## 3.0.51.1

- Nasazuje Evora Smart Hub 3.0.51 s plným macOS Menu 3.0.35, které má originální LOXONE tlačítko pro Podporu/Váchu a samostatné WhatsApp tlačítko pro Filipa Kubína, Lukáše Majera a Jiřího Vaverku. Všechny volby otevírá přímo v nativní aplikaci WhatsApp bez webové mezistránky.
- Zachovává Hub 3.0.50 jako vratný zdroj a nemění databázové schéma 24, `/data`, šifrované přístupy, Windows Menu ani technickou macOS edici.

## 3.0.50.1

- Nasazuje Evora Smart Hub 3.0.50 se schématem 24, osobním párováním Menu a ruční kontrolou celé flotily s prioritou vybraného Miniserveru.
- Zachovává Hub 3.0.49 jako vratný zdroj a nemění uložená data, šifrované přístupy ani `/data`; součástí distribuce jsou Windows Menu 3.0.31 a aktualizovaná macOS Menu.

## 3.0.49.1

- Nasazuje úzký hotfix Evora Smart Hub 3.0.49 pro odpovědi Remote Connect ve formátu `IPHTTPS` a `DataCenter`.
- Zachovává Hub 3.0.48 jako vratný zdroj a nemění databázi, šifrované přístupy, `/data`, kamerovou cestu ani nativní Menu.

## 3.0.48.1

- Nasazuje Evora Smart Hub 3.0.48 se schématem 23 a distribučním Evora Smart Menu 3.0.31 s tmavým podkladem celého nativního `NSMenu`, nejen vlastní profilové karty.
- Zachovává serverovou kameru, bránu, H.264/fMP4 HLS cestu 3.0.46, data, šifrované přístupy, `/data` i vratný zdroj živého Hubu 3.0.47.

## 3.0.47.1

- Nasazuje Evora Smart Hub 3.0.47 se schématem 23 a distribučním Evora Smart Menu 3.0.30 bez položky `Parkoviště a brána`, kamerového AVPlayeru a HLS prewarmu v macOS nabídce.
- Zachovává serverovou kameru, bránu, H.264/fMP4 HLS cestu 3.0.46, data, šifrované přístupy, `/data` i vratný zdroj živého Hubu 3.0.46.

## 3.0.46.1

- Nasazuje Evora Smart Hub 3.0.46 se schématem 23 a jedinou H.264/fMP4 HLS relací s připnutým `init.mp4` pro spolehlivý nový start klienta i po zestárnutí relace.
- Hotové fragmenty se dál zveřejňují až po úplném načtení do omezené cache Hubu. Zachovává data, šifrované přístupy, `/data`, Menu 3.0.29 i vratný zdroj živého Hubu 3.0.45.

## 3.0.45.1

- Nasazuje Evora Smart Hub 3.0.45 se schématem 23 a HLS playlistem, který klientům zveřejňuje pouze už celé načtené souvislé segmenty z omezené paměti Hubu.
- Právě vznikající segment se dokončí na pozadí a do playlistu se zařadí až potom; oprava reaguje na živý VLC důkaz 3.0.44 s jedním předčasným HTTP 502 a nulou dekódovaných snímků. Zachovává data, šifrované přístupy, `/data`, Menu 3.0.29 i vratný zdroj živého Hubu 3.0.44.

## 3.0.44.1

- Nasazuje Evora Smart Hub 3.0.44 se schématem 23 a opravuje dříve zastaralé hlášení `databaseSchema` ve zdravotním endpointu.
- Součástí je Evora Smart Menu 3.0.29 bez opakovaného přebarvování vrstev, implicitních animací a pulzování stavové ikony; hodnoty zapisuje do otevřeného menu pouze při skutečné změně. Zachovává data, šifrované přístupy, `/data` i vratný zdroj živého Hubu 3.0.43.

## 3.0.43.1

- Nasazuje Evora Smart Hub 3.0.43 se schématem 23 a se serverovými funkcemi 3.0.42: kontakty Intranetu, synchronním webovým redirectem, neblokujícím HLS playlistem a dvěma šifrovanými povely brány.
- Součástí je Evora Smart Menu 3.0.28 s tmavým nativním `NSMenu`, odloženými obnovami, pravdivým stavem videa, přímou položkou kamery bez Milesightu a Builderu a s validovanými GPS jednotlivých jízd. Databázi, šifrované přístupy ani `/data` helper nemění.

## 3.0.42.1

- Nasazuje Evora Smart Hub 3.0.42 se schématem 23, ručním doplněním telefonů Intranetu, synchronním serverovým web redirectem, neblokujícím HLS playlistem a dvěma explicitními šifrovanými HTTP(S) povely brány.
- Zachovává vratný zdroj Hubu 3.0.41, databázi, šifrované přístupy, `/data` i nativní klienty. Součástí distribuce je Evora Smart Menu 3.0.27.

## 3.0.41.1

- Nasazuje Evora Smart Hub 3.0.41 bez neplatného prázdného URL defaultu pro volitelné napojení Loxone Builderu.
- Zachovává vratný zdroj Hubu 3.0.40, databázi, šifrované přístupy, `/data` i nativní klienty.

## 3.0.40.1

- Nasazuje Evora Smart Hub 3.0.40 s členěným Intranetem, osobní Knihou jízd a odděleným stavovým napojením Loxone Builderu.
- Zachovává vratný zdroj Hubu 3.0.39, databázi, šifrované přístupy, `/data` i nativní klienty. Součástí distribuce je Evora Smart Menu 3.0.26.

## 3.0.39.1

- Nasazuje Evora Smart Hub 3.0.39 se zjednodušeným patchem go2rtc: číslování a omezenou cache segmentů vlastní Hub, zatímco go2rtc pouze prodlužuje životnost relace a nevrátí samotnou 376B PAT/PMT hlavičku jako video.
- Zachovává vratný zdroj živého Hubu 3.0.38, databázi, šifrované přístupy, `/data` i nativní klienty. Evora Smart Menu 3.0.23 s atomickým ukotvením všech stránek zůstává beze změny.

## 3.0.38.1

- Nasazuje Evora Smart Hub 3.0.38 s opravenou připraveností MPEG-TS segmentů: 376B PAT/PMT základ už není považován za hotové video a segment čeká na skutečná obrazová TS data.
- Zachovává vratný zdroj Hubu 3.0.37, databázi, šifrované přístupy, `/data` i nativní klienty. Evora Smart Menu 3.0.23 s atomickým ukotvením všech stránek zůstává beze změny.

## 3.0.37.1

- Nasazuje Evora Smart Hub 3.0.37 s jedinou sdílenou předehřívanou MPEG-TS HLS relací kanálu 7 pro Hub i macOS Menu. Odstraňuje samostatnou fMP4 relaci, která na živém Hubu 3.0.36 vracela 502 a neposkytla dekódovaný snímek.
- Zachovává vratný zdroj Hubu 3.0.36, databázi, šifrované přístupy, `/data` i nativní klienty. Evora Smart Menu 3.0.22 s atomickým ukotvením všech stránek zůstá beze změny.

## 3.0.36.1

- Nasazuje Evora Smart Hub 3.0.36 se serializovanou půlsekundovou HLS pumpou, atomicky cachovaným playlistem a souběžným webovým i nativním transportem kanálu 7 nad jediným přímým RTSP zdrojem NVR.
- Součástí je Evora Smart Menu 3.0.22 s atomickým ukotvením každé stránky osm bodů od horní i pravé hrany. Zachovává vratný zdroj živého Hubu 3.0.35, databázi, šifrované přístupy, `/data` i nativní klienty.

## 3.0.35.1

- Nasazuje Evora Smart Hub 3.0.35, který průběžně předehřívá webový MPEG-TS i nativní H.264/fMP4 transport kanálu 7 nad jediným přímým RTSP zdrojem NVR.
- Zachovává vratný zdroj živého Hubu 3.0.34, databázi, šifrované přístupy, `/data` i již nasazené nativní klienty.

## 3.0.34.1

- Nasazuje Evora Smart Hub 3.0.34 s bezpečnými webovými odkazy a capability-gated kopírováním hesel Miniserverů, nativním H.264/fMP4 HLS pro macOS Menu a přímým serverovým HTTP ovládáním brány přes šifrovanou konfiguraci.
- Součástí je Evora Smart Menu 3.0.21 s jednopanelovou navigací, pevným osmibodovým ukotvením při přesunu i změně velikosti, plynulým otevřením, souvislým hledáním a adaptivními akcemi Miniserveru. Windows Menu zůstává 3.0.23.
- Před výměnou zachová vratný zdroj živého Hubu 3.0.33 a nemění databázi, šifrované přístupy, `/data` ani uživatelská nastavení.

## 3.0.33.5

- Opravný payload stejné aplikační verze 3.0.33 publikuje bezpečné webové akce Miniserverů, Windows Menu 3.0.21 a macOS Menu 3.0.17 s neblokujícím snapshotem `Systémy`, spolehlivějším fokusem hledání a jednořádkovými tickety.
- Zachovává původní vratný zdroj, databázi, šifrovaná připojení a `/data`; kontrolní součet payloadu je připnutý v deployeru a po nasazení je vyžadován read-back assetů i nativních klientů.

## 3.0.33.4

- Před zveřejněním čerstvého HLS masteru atomicky načte a uloží inicializační fragment i všechny segmenty aktuálního playlistu. Opravuje další živě reprodukovaný start, při kterém byly master a playlist HTTP 200, ale VLC narazil na 502 při initu a ukončil demuxer před prvním snímkem.
- Zachovává aplikační verzi 3.0.33, původní rollback na 3.0.32, databázi i `/data`; přijetí hotfixu zůstává podmíněné dlouhým VLC během s dekódovanými snímky a bez neúspěšných upstream odpovědí.

## 3.0.33.3

- Před vrácením čerstvého HLS masteru klientovi omezeně vyčká, až relay skutečně načte a uloží první video segment. Opravuje živě reprodukovaný start, kdy VLC po prvním ještě nedokončeném fragmentu přestal žádat další data, přestože později zahřátá relace už vracela postupující segmenty HTTP 200.
- Opravná výměna stejné aplikační verze 3.0.33 zachovává původní rollback na 3.0.32, databázi i `/data`; po nasazení vyžaduje dlouhý důkaz skutečně dekódovaných snímků.

## 3.0.33.2

- Opravuje produkční Dockerfile Hubu 3.0.33 na runtime-only sestavení z již otestovaného katalogového `dist`. První build přes helper 3.0.33.1 skončil ještě před zastavením nebo nahrazením živého Hubu 3.0.32, protože distribuční add-on kontext záměrně neobsahuje TypeScript zdroje.
- Opakovaná vratná výměna stejného zdroje 3.0.33 zachovává původní rollback na 3.0.32 a nemění databázi ani trvalý adresář `/data`.

## 3.0.33.1

- Nasazuje Evora Smart Hub 3.0.33 s jediným publikovaným kanálem 7 „Parkoviště a brána“. Přímý RTSP zdroj zůstává uvnitř Hubu, checksumem připnutý go2rtc jej převádí na autentizované HLS a server úspornou preview relaci průběžně předehřívá bez MJPEG.
- Součástí jsou Evora Smart Menu 3.0.17 pro macOS, nové nativní Windows Menu 3.0.17 s DPAPI a ověřovaným self-updatem a Windows Config Launcher 3.0.0.8. Hub i obě Menu zobrazují stav NVR, poslední kontroly a úplný inventář všech kamer; obraz zůstává omezený na kanál 7.
- Ruční Excel synchronizace opravuje HTTP 415 a privátní SharePoint čte pouze přes podporovanou Microsoft Graph device-code relaci. Vratným zdrojem je živý Hub 3.0.32; databáze, šifrovaná připojení, vlastní názvy, DPAPI párování ani trvalý adresář `/data` se nemění.

## 3.0.32.1

- Nasazuje Evora Smart Hub 3.0.32 s jedinou publikovanou kamerou „Parkoviště - Recepce - 2“ jako jednoduchým autentizovaným JPEG snímkem. Hub ani Evora Smart Menu 3.0.16 už v aktivní klientské cestě nespouštějí HLS, WebRTC ani MJPEG video relaci; další snímek načtou až po dokončení předchozího a při chybě zachovají poslední platný obraz.
- Součástí je Windows Config Launcher 3.0.0.7. V již otevřeném Configu nejdřív ověří a stiskne tlačítko Domů a potom pokračuje přes Ručně připojit, vyplnění údajů a Připojit. Jeho existující automatická aktualizace ověřuje autentizovaný manifest, SHA-256 i čerstvý heartbeat a při selhání vrátí předchozí verzi.
- Vratným zdrojem je živý Hub 3.0.31. Databáze, šifrovaná připojení, názvy kamer, Excel/Graph stav ani trvalý adresář `/data` se nemění.

## 3.0.31.1

- Nasazuje Evora Smart Hub 3.0.31 s pořadově adresovatelnými HLS segmenty v checksumem připnutém go2rtc 1.9.14. Jedna interní relace serializuje tvorbu fragmentů a poslední čtyři drží pro opakované či souběžné čtení; Hub nad ní zachovává single-flight cache 12 segmentů.
- Publikovaná zůstává pouze kamera „Parkoviště - Recepce - 2“ jako H.264/HLS/fMP4 z RTSP bez MJPEG. Součástí je Evora Smart Menu 3.0.15 s opraveným fokusem hledání; vratným zdrojem je živý Hub 3.0.30 a databáze ani `/data` se nemění.

## 3.0.30.1

- Nasazuje Evora Smart Hub 3.0.30 s krátkým interním timeoutem každého čtení právě vznikajícího HLS segmentu a s omezeným single-flight opakováním rychlé 502 i zavěšeného loopback požadavku.
- Součástí je Evora Smart Menu 3.0.15 s opraveným klávesovým fokusem po kliknutí do globálního i Miniserverového hledání. Publikovaná zůstává pouze kamera „Parkoviště - Recepce - 2“, H.264/HLS/fMP4 z RTSP bez MJPEG; vratným zdrojem je živý Hub 3.0.29 a databáze ani `/data` se nemění.

## 3.0.29.1

- Nasazuje Evora Smart Hub 3.0.29, který uvnitř jediné sdílené HLS relace omezeně vyčká na právě oznámený, ale ještě nedokončený video segment. Přechodná nedostupnost fragmentu se řeší jedním single-flight požadavkem a klientům se nemá propisovat jako HTTP 502.
- Zachovává pouze kameru „Parkoviště - Recepce - 2“, H.264/fMP4 z RTSP bez MJPEG, Evora Smart Menu 3.0.14 a Windows Launcher 3.0.0.6. Před výměnou uchová vratný zdroj živého Hubu 3.0.28 a nemění databázi ani `/data`.

## 3.0.28.1

- Nasazuje Evora Smart Hub 3.0.28 s jednou sdílenou upstream HLS relací pro náhled kamery „Parkoviště - Recepce - 2“. Hub každý init a segment načte z go2rtc pouze jednou a souběžné klienty obslouží z omezené cache posledních 12 segmentů; přenos je H.264/fMP4 z RTSP, nikdy MJPEG.
- Zachovává Evora Smart Menu 3.0.14 s přímými výsledky hledání Miniserverů a volbou existujícího/nového okna Configu i Windows Launcher 3.0.0.6. Před výměnou uchová vratný zdroj živého Hubu 3.0.27 a nemění databázi ani `/data`.

## 3.0.27.2

- Opravuje katalogový payload 3.0.27 na runtime-only Dockerfile, který sestavuje obraz z již otestovaného `dist` a nevyžaduje nezveřejněné TypeScript zdroje. Neúspěšný build helperu 3.0.27.1 nezastavil ani nenahradil živý Hub 3.0.26.
- Opravná výměna stejného zdroje 3.0.27 zachová ukazatel rollbacku na původní 3.0.26 a nemění databázi ani trvalý adresář `/data`.

## 3.0.27.1

- Nasazuje Evora Smart Hub 3.0.27 s idempotentní registrací stejného RTSP zdroje ve video bráně, aby souběžné náhledy Hubu a Menu vzájemně nemažily aktivní stream kamery „Parkoviště - Recepce - 2“. Aktivní přenos zůstává H.264 přes zabezpečené HLS/WebRTC a nepoužívá MJPEG.
- Součástí je Evora Smart Menu 3.0.14 s přímými výsledky Miniserverů při hledání a volbou otevření přesné verze Loxone Configu v již spuštěném procesu nebo v novém okně. Windows Config Launcher 3.0.0.6 režim respektuje a starý klient zůstává zpětně kompatibilní.
- Před výměnou zachová vratný zdroj aktuálního Hubu 3.0.26; databázi, uložené přístupy ani trvalý adresář `/data` nemění.

## 3.0.26.3

- Před prvním HTTPS stažením přenáší do minimální Node runtime vrstvy důvěryhodný certifikační svazek z build vrstvy. Řeší živě zjištěný bootstrap certifikátů bez vypnutí TLS kontroly; aplikační verze zůstává 3.0.26.

## 3.0.26.2

- Přepíná systémové repozitáře obou build vrstev na HTTPS, protože živý Home Assistant builder odmítl spojení na `deb.debian.org` přes port 80. Aplikační payload 3.0.26, vratná výměna i všechna uživatelská data zůstávají zachované.

## 3.0.26.1

- Nasazuje Evora Smart Hub 3.0.26 s opravami z prvního auditu LongHorizon Harness: konečnými timeouty klienta a video brány, úklidem neúspěšných procesů a streamů, pravdivými chybovými stavy a bezpečnějším service workerem.
- Součástí jsou Evora Smart Menu 3.0.13 s omezeným čekáním na podprocesy a Windows Config Launcher 3.0.0.5 s transakční aktualizací, ověřením návratu online a automatickým rollbackem. V Hubu i Menu zůstává zveřejněna pouze kamera „Parkoviště - Recepce - 2“; P2P dalších NVR se tímto nevydává za hotové.

## 3.0.25.1

- Nasazuje Evora Smart Hub 3.0.25, který v Hubu i Evora Smart Menu dočasně publikuje pouze kameru „Parkoviště - Recepce - 2“ (stabilní kanál 7).
- Ostatních devět kanálů, vlastní názvy, šifrované NVR připojení, čtecí Excel/Graph synchronizace a databáze zůstávají beze změny. Aktivní obraz nepoužívá MJPEG a kompletní vícekamerový provoz se tímto nevydává za hotový.

## 3.0.24.2

- Používá oficiální vícearchitekturní Home Assistant base 3.22 z GitHub Container Registry. Obchází opakovaně živě potvrzený timeout Docker Hubu při sestavení helperu; payload Hubu 3.0.24 a jeho kontrolní součet zůstávají stejné.

## 3.0.24.1

- Nasazuje Evora Smart Hub 3.0.24 s checksumem připnutým go2rtc 1.9.14 a jedinou auditovatelnou úpravou pevné HLS životnosti z pěti na 30 sekund. Pomalý přenos segmentu přes Home Assistant proxy tak nemá ukončit zdravý RTSP proud.
- Zachovává databázi, názvy kamer, čtecí Excel/Graph synchronizaci, šifrovaná připojení i vratný zdroj Hubu 3.0.23. Aktivní přehrávání zůstává H.264/H.265 bez MJPEG a P2P dalších NVR se tímto nevydává za hotový.

## 3.0.23.1

- Nasazuje Evora Smart Hub 3.0.23 s přímým HLS startem náhledové mřížky, 450ms rozestupem, okamžitým HLS masterem a bez interního odebírání klientských segmentů.
- Zachovává databázi, vlastní názvy kamer, čtecí Excel/Graph synchronizaci, šifrovaná připojení i vratný zdroj Hubu 3.0.22; aktivní přehrávání stále nepoužívá MJPEG.

## 3.0.22.1

- Nasazuje Evora Smart Hub 3.0.22 s udržováním HLS relace skutečnými video segmenty během delších mezer mezi klíčovými snímky a s vyjednáním HEVC pouze pro nativní HLS Safari/iPhonu.
- Zachovává databázi, vlastní názvy kamer, čtecí Excel/Graph synchronizaci, šifrovaná připojení i vratný zdroj Hubu 3.0.21; přehrávání nepoužívá MJPEG a P2P transport dalších NVR se tímto nevydává za hotový.

## 3.0.21.3

- Aktualizuje klientský bundle 3.0.21 tak, aby moderní prohlížeč označil kameru jako živou až po dvou skutečně dekódovaných snímcích z `requestVideoFrameCallback`; samotný posun časové osy už černý nebo zamrzlý obraz nepotvrdí.
- Zachovává runtime-only opravu helperu 3.0.21.2, databázi i původní vratný zdroj 3.0.20.

## 3.0.21.2

- Opravuje katalogový payload 3.0.21 na runtime-only Dockerfile, který sestavuje obraz z již otestovaného `dist` a nevyžaduje nezveřejněné TypeScript zdroje.
- Aplikační verze zůstává 3.0.21; helper zachovává původní rollback 3.0.20 a po neúspěšném buildu mění pouze připravený lokální zdroj.

## 3.0.21.1

- Nasazuje Evora Smart Hub 3.0.21 s pravdivou detekcí dekódovaných WebRTC/HLS snímků, serverovým ověřením postupujících HLS segmentů, automatickým H.264 fallbackem a bez aktivního MJPEG přenosu.
- Součástí je Evora Smart Menu 3.0.12 s 30minutovým odpočtem přestávky v panelu i horní liště; helper zachovává databázi, názvy kamer, šifrovaná připojení a vratný zdroj Hubu 3.0.20.

## 3.0.20.1

- Nasazuje Evora Smart Hub 3.0.20 s převodem interního Milesight RTSP na WebRTC a zabezpečené HLS, checksumem ověřenou video bránou a Evora Smart Menu 3.0.11 s nativním AVPlayer HLS přehráváním.
- Zachovává databázi, čtecí Excel/Graph synchronizaci, názvy kamer, šifrované NVR přístupy, DPAPI párování i vratný zdroj Hubu 3.0.19; P2P transport dalších NVR tato verze ještě nevydává za hotový.

## 3.0.19.3

- Aktualizuje veřejný instalační balíček Evora Smart Menu 3.0.10 o bezpečné čekání a jeden opakovaný `launchctl bootstrap`, pokud macOS po `bootout` krátce vrátí I/O chybu.
- Aplikační runtime Hubu zůstává 3.0.19; helper zachovává databázi i původní rollback a aktualizuje pouze ověřený lokální zdroj.

## 3.0.19.2

- Opravuje runtime značku Hubu v produkčním Docker obrazu, aby health, přihlášené Menu i rozhraní skutečně hlásily vydanou verzi 3.0.19 místo 3.0.18.
- Zachovává stejný aplikační build, databázi a vratný zdroj; helper mění pouze ověřený zdroj lokálního add-onu a po nasazení vyžaduje nový rebuild.

## 3.0.19.1

- Nasazuje Evora Smart Hub 3.0.19 s obnovenou veřejnou Home Assistant proxy pro Hub i Evora Smart Menu a s pořadím LOXONE, Home Assistant, Milesight, Intranet, Incidenty, Úkoly a Nastavení.
- Zachovává ověřené Milesight streamy, čtecí Excel/Graph synchronizaci, databázi, vlastní názvy kamer, DPAPI párování a šifrovaná připojení; vratným zdrojem je Hub 3.0.18.

## 3.0.18.1

- Nasazuje Evora Smart Hub 3.0.18 s řízeným rozestupem startu deseti Milesight náhledů, aby se NVR nepřetížilo současnou inicializací všech RTSP relací.
- Zachovává filtr vadných zahřívacích rámců, prioritu hlavního streamu a vratný zdroj aktuálního Hubu 3.0.17; databázi ani trvalý adresář `/data` nemění.

## 3.0.17.1

- Nasazuje Evora Smart Hub 3.0.17 s filtrem vadných počátečních kamerových rámců, uvolněním náhledových RTSP relací při otevření detailu a konečným timeoutem místo nekonečného načítání.
- Před výměnou zachová vratný zdroj aktuálního Hubu 3.0.16; databázi a trvalý adresář `/data` nemění.

## 3.0.16.2

- Opravuje instalační payload 3.0.16 na runtime-only Dockerfile, který používá již ověřený produkční `dist` a nevyžaduje zdrojové `src` uvnitř veřejného HA katalogu.
- Při opravné výměně stejné verze zachová ukazatel rollbacku na původní 3.0.15; neúspěšný mezilehlý zdroj odloží odděleně a databázi ani `/data` nemění.

## 3.0.16.1

- Nasazuje Evora Smart Hub 3.0.16 s online i offline kanály, originální značkou Milesight a bezpečným přístupem ke schopnostem kamer přes NVR Channel Access.
- Třetí MJPEG stream se zapíná pouze podle parametrů potvrzených konkrétní kamerou a po zápisu se znovu načte; stejné pravidlo read-back platí pro tři HTTP cíle VCA událostí. Součástí jsou Evora Smart Menu 3.0.10 a Windows Config Launcher 3.0.0.4; helper zachovává databázi, čtecí Excel/Graph nastavení, vlastní názvy kamer, DPAPI párování a šifrovaná připojení i vratnou kopii zdroje 3.0.15.

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
