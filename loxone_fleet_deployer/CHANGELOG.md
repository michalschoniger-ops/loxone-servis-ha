# Changelog

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
