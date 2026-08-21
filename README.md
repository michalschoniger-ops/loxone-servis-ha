# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 2.0.10 obnovuje flotilu postupně po jednom Miniserveru, samostatně udržuje Health Check, LoxAPP3 a 1-Wire data, opravuje binární export Statistik V2 a doplňuje dostupný Air signál i přesné fotografie z oficiálního Loxone Shop CDN. Servisní balíček má přímo v aplikaci i manifestu přesně popsaný anonymizovaný obsah.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
