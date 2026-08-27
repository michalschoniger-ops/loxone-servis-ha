# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.50 přidává samostatné osobní párování Evora Smart Menu, WhatsApp podporu a ruční kontrolu celé flotily z Windows Menu. Vybraný Miniserver se při ruční kontrole ověří jako první; běžný snapshot Menu se dál načítá jednou za 60 sekund a plánovaný aktivní cyklus Hubu zůstává 120 minut. Součástí jsou Windows Menu 3.0.31, plné macOS Menu 3.0.34 a technické macOS Menu 3.0.35. Databázové schéma 24 ukládá pouze hashované, krátce platné párovací kódy; šifrované přístupy a data zůstávají zachované.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
