# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.8 přidává zabezpečené kamery z Milesight NVR, hodinový čtecí import organizačního Excelu přes Microsoft Graph a Evora Smart Menu 3.0.3. Excelový řádek po přesunu nebo drobné změně aktualizuje stejný úkol bez duplikátu; zápis zpět je vypnutý. Menu vedle náhledů kamer ukazuje ověřený počet online/offline prvků, Health stav, stáří kontroly a odezvu Miniserveru. Všechna dosavadní data, importované úkoly a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
