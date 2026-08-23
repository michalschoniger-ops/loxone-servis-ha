# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.10 opravuje Milesight Digest přihlášení podle skutečné výzvy NVR a přesné SDK cesty včetně dotazu. Zároveň zachovává živě ověřené párování dlouhých Excel požadavků bez duplikace; hodinový Microsoft Graph import zůstává pouze směrem do Hubu a zápis zpět je vypnutý. Evora Smart Menu 3.0.4 obsahuje kamery přímo v `Systémy → Kamery`, diagnostiku Miniserverů a samostatně označenou verzi Menu i Hubu. Všechna dosavadní data, importované úkoly a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
