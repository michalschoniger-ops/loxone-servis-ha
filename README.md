# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.55 zachovává jednorázovou úvodní animaci i úzce omezenou opravu přesměrované Loxone Cloud cesty parkovací brány. Přidává Windows Menu 3.0.32: po jediném osobním spárování samo připraví skrytý Config konektor, zobrazuje svou verzi a při spuštění i každých 15 minut automaticky ověří a nainstaluje novější podepsaný balíček z Hubu. Instalační balíček neobsahuje sdílené heslo ani token a odvolání osobního Menu tokenu zneplatní i jeho konektor. Plné a technické macOS Menu zůstává 3.0.35; databázové schéma se zvyšuje na 25.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
