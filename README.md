# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 2.1.2 opravuje spouštění aktualizací Home Assistantu: Hub požádá o zálohu jen u aktualizačních entit, které ji podporují, a místo obecné interní chyby ukáže přesný bezpečný důvod odmítnutí. Na mobilu sjednocuje šířku a výšku hlavních tlačítek i ovládacích prvků servisních úloh. Databázové schéma 18 i uložená data zůstávají zachovány.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
