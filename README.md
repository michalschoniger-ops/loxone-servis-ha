# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.1 sjednocuje Evora Smart Hub a Evora Smart Menu do dalšího společného vydání. Hledání prochází celou aplikaci a její data, mobilní formuláře a uživatelé používají jednotnou geometrii, dialogy Menu mají významové ikony a ticketový detail nativní trackpadový posuv. Windows klient 3.0.1 zůstává online po celou přihlášenou relaci, ale pracovní data sbírá pouze při aktivní práci. Config Launcher 3.0.0.2 má bezpečné přepárování, odebrání bez mazání lokálních souborů a watchdog ověřený obnovením po pádu. Všechna data a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
