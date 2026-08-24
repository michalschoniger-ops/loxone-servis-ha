# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.15 opravuje živé kamerové relace podle skutečné matice cílového NVR: každý úsporný náhled nejprve prověří druhý stream, při jeho absenci nebo výpadku bez přerušení použije zmenšený hlavní stream a bezpečně označí skutečný zdroj rámce. Odpojené či zablokované klienty uklidí, aby další kanály nekončily HTTP 503. Součástí jsou Evora Smart Menu 3.0.9 a Windows Config Launcher 3.0.0.3 s bezokenním watchdogem přes `wscript.exe`. Hodinový Microsoft Graph import zůstává pouze směrem do Hubu a zápis zpět je vypnutý; dosavadní data, vlastní názvy kamer, DPAPI párování a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
