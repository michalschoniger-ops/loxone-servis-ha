# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.3 přidává bezpečný hodinový a ruční import aktivních servisních úkolů z listu `PROGRAMOVÁNÍ - DOKONČOVÁNÍ`, zobrazuje skutečný stav synchronizace a nevytváří duplikáty. Sdílený Excel je pouze pro čtení, takže Hub změny uchová lokálně a výslovně označí čekající zápis. Současně opravuje iPhone přetékání, kompaktní správu uživatelů a mezeru u firmwaru. Evora Smart Menu a Windows klient zůstávají ve verzi 3.0.1, Config Launcher ve verzi 3.0.0.2. Všechna data a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
