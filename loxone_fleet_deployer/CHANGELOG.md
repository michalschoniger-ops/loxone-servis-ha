# Changelog

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
