# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.42 přidává správcovské ruční doplnění chybějících telefonů kontaktů Intranetu, synchronní autentizovaný proklik na čerstvě rozlišené webové rozhraní Miniserveru a šifrované serverové HTTP(S) povely brány bez předávání adres klientům. Kanál 7 „Parkoviště a brána“ dál používá autentizované HLS z přímého RTSP zdroje NVR bez MJPEG a bez Home Assistant kamery; playlist už neblokuje čekáním na všechny segmenty a při startu zůstává viditelný poslední snapshot. Součástí je Evora Smart Menu 3.0.27 s jednotnými 58bodovými akcemi Miniserveru a přesným vystředěním popisků. Databázi, šifrované přístupy ani vlastní názvy vydání nemaže.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
