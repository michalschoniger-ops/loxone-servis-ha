# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.19 obnovuje veřejné spojení Hubu a Evora Smart Menu přes Home Assistant proxy 0.1.1, která se po startu správně registruje a vždy uklidí ukončené dlouhé kamerové relace. Postranní nabídka Hubu používá na desktopu i telefonu pořadí LOXONE, Home Assistant, Milesight, Intranet, Incidenty, Úkoly a Nastavení. Zachovává ověřené souvislé Milesight streamy 3.0.18, Evora Smart Menu 3.0.10, Windows Config Launcher 3.0.0.4 i čtecí Microsoft Graph import bez zápisu zpět do Excelu; databázi, vlastní názvy kamer, DPAPI párování a šifrovaná připojení nemění.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
