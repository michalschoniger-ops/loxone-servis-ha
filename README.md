# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.32 publikuje pouze kameru „Parkoviště - Recepce - 2“ jako jednoduchý autentizovaný JPEG snímek. Hub ani Evora Smart Menu 3.0.16 v aktivní klientské cestě nespouštějí HLS, WebRTC ani MJPEG video relaci; po chybě zachovají poslední platný obraz. Menu vrací Miniservery přímo v samostatném i globálním hledání. Windows Config Launcher 3.0.0.7 se aktualizuje automaticky a při práci s již otevřeným Configem nejdřív ověřeně stiskne Domů, potom použije Ručně připojit, vyplní údaje a připojí se. Databázi, vlastní názvy a čtecí Microsoft Graph import bez zápisu zpět do Excelu release nemění.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
