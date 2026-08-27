# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.53 animuje úvodní desktopovou obrazovku krátkým složením společného motivu, světelným přejezdem přes diagonálu a plynulým nástupem textu; při omezeném pohybu zůstává statická. Opravuje také parkovací bránu: web posílá platný JSON požadavek a Hub bezpečně následuje nejvýše jedno HTTPS přesměrování mezi důvěryhodnými servery Loxone Cloud, přičemž odděleně šifrované přihlášení zůstává pouze na serveru. Osobní párování, plné a technické macOS Menu 3.0.35, Windows Menu 3.0.31 a databázové schéma 24 zůstávají zachované.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
