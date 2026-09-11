# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.71 přináší Windows Launcher 3.0.0.15, který se aktualizuje až po ukončení původního procesu a stahuje aktuální Stable, Beta a Alpha LOXONE Config přímo přes HTTPS do složky Stažené soubory bez Edge. Evora Smart Menu 3.0.48 vkládá Partner Coache s fotografií a kontakty přímo do panelu LOXONE Portálu, načte všech 18 řádků školení a faktury zobrazí pouze tehdy, když je partnerský účet opravdu zpřístupní. Zachovává ruční Miniservery, Windows Menu 3.0.34, technické macOS Menu 3.0.35 a databázové schéma 27.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
