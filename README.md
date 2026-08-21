# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 2.0.3 dokončuje osobní Windows/Parallels Config Launcher, automatické obnovení přihlášení k Loxone Partner Portalu a správcovské centrum ticketů přímo v Hubu i WorkLogAI. Tickety a jejich veřejná komunikace se ukládají do šifrované lokální cache, přílohy se zobrazí nebo stáhnou podle dat dostupných z Portálu a mobilní rozvržení je ověřené také na iPhonu.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
