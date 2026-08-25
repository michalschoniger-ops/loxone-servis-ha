# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.31 drží očíslované HLS segmenty jedné sdílené RTSP relace opakovatelně pro souběžné klienty a publikuje pouze kameru „Parkoviště - Recepce - 2“ jako H.264/HLS/fMP4 bez MJPEG. Evora Smart Menu 3.0.15 opravuje fokus po kliknutí do hledání, nabízí Miniservery přímo ve výsledcích a zachovává volbu otevření Loxone Configu v existujícím nebo novém okně. Databázi, vlastní názvy, Windows Config Launcher 3.0.0.6 i čtecí Microsoft Graph import bez zápisu zpět do Excelu release nemění.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
