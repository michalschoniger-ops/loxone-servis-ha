# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.49 opravuje načítání Exportů přes Loxone Remote Connect. Resolver přijímá jak novější pole `url`, tak skutečně vracenou trasu `IPHTTPS` a `DataCenter`; neznámý úspěšný formát může bezpečně pokračovat přes záložní CloudDNS. Všechny ostatní funkce, Evora Smart Menu 3.0.31, databáze, šifrované přístupy i vlastní názvy zůstávají beze změny.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
