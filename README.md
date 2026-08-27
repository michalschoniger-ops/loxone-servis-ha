# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.56 zachovává jednorázovou úvodní animaci i živě ověřenou opravu přesměrované Loxone Cloud cesty parkovací brány. Windows Menu 3.0.33 po jediném osobním spárování bezpečně ukončí přesně ověřený starý Config Launcher, převezme jeho konfiguraci pod osobní token Menu a spustí nový skrytý konektor. Verzi zobrazuje přímo v okně a při spuštění i každých 15 minut automaticky ověří a nainstaluje novější podepsaný balíček z Hubu. Plné a technické macOS Menu zůstává 3.0.35; databázové schéma zůstává 25.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
