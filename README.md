# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.16 používá Milesight NVR jako jediný síťový bod pro stav i obraz kamer. Detailní schopnosti, třetí MJPEG stream a VCA HTTP notifikace ověřuje přes NVR Channel Access a po každém zápisu provádí read-back; bez potvrzeného třetího streamu zachová dosavadní sdílený NVR stream. Součástí jsou Evora Smart Menu 3.0.10 s originální značkou Milesight a Windows Config Launcher 3.0.0.4 s bezokenním watchdogem i restartem přes `wscript.exe`. Hodinový Microsoft Graph import zůstává pouze směrem do Hubu a zápis zpět je vypnutý; dosavadní data, vlastní názvy kamer, DPAPI párování a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
