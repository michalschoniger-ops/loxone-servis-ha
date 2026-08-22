# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 2.2.1 obsahuje správcovskou integraci **Evora Intranet** s běžícím časem docházky, historií aktuálního a předchozího měsíce, přehledem kolegů a potvrzovanými docházkovými akcemi. Mobilní menu má jediný viditelný odchod z účtu, podporu uvnitř LOXONE a provozní log, uživatele i nástroje pod Nastavením. Čtyři hlavní akce Miniserverů používají sjednocené buňky, vlastní ikony a bezpečné zalamování. Bezpečnostní oprava 2.2.1 navíc odstraňuje všechny query parametry z provozních logů, takže se do nich nezapíše ani API klíč staršího klienta. Součástí je WorkLogAI 5.8.2 a samostatně ověřovaný Keychain helper; uložená data zůstávají zachována.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
