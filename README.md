# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.35 publikuje pouze kanál 7 „Parkoviště a brána“ jako autentizované HLS z přímého RTSP zdroje NVR a průběžně předehřívá webový MPEG-TS i nativní H.264/fMP4 transport. Aktivní cesta nepoužívá MJPEG ani Home Assistant kameru. Hub, Evora Smart Menu 3.0.21 pro macOS a nativní Evora Smart Menu 3.0.23 pro Windows používají přímé hledání Miniserverů, bezpečné webové odkazy, capability-gated kopírování hesel a úplnou NVR diagnostiku, zatímco obraz zpřístupňují jen pro kanál 7. Windows Config Launcher 3.0.0.12 zpřesňuje tok již otevřeného Configu a zachovává ověřovaný self-update. Ruční Excel synchronizace už nepadá na HTTP 415; podporované automatické čtení privátního SharePointu vyžaduje nastavenou Microsoft Graph device-code relaci a zápis zpět zůstává vypnutý. Databázi, šifrované přístupy ani vlastní názvy release nemaže.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
