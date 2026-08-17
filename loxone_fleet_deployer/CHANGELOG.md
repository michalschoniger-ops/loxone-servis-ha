# Changelog

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
