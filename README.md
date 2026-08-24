# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.21 ověřuje HLS ještě na serveru třemi postupujícími segmenty, nefunkční náhled nahradí kompatibilním H.264 proudem a stav „živě“ zobrazí až po skutečně dekódovaných snímcích WebRTC/HLS. Aktivní MJPEG přenos byl odstraněn. Evora Smart Menu 3.0.12 přidává 30minutový odpočet přestávky i do horní lišty a dál přehrává chráněné HLS nativním AVPlayerem bez tokenu v URL. Zachovává databázi, vlastní názvy kamer, Windows Config Launcher 3.0.0.4 i čtecí Microsoft Graph import bez zápisu zpět do Excelu.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
