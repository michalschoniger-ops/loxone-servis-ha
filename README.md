# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.11 přidává kompatibilitu se starším Milesight NVR, které po výzvě nabízí pouze Basic přihlášení, a zachovává podporu Digest, privátní síť i šifrované uložení. Zároveň zachovává živě ověřené párování dlouhých Excel požadavků bez duplikace; hodinový Microsoft Graph import zůstává pouze směrem do Hubu a zápis zpět je vypnutý. Evora Smart Menu 3.0.5 má kamery vždy viditelné přímo v `Systémy → Kamery`, diagnostiku Miniserverů a po načtení opravuje záhlaví na skutečnou živou verzi Hubu. Všechna dosavadní data, importované úkoly a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
