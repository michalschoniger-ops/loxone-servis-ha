# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.41 dělí Intranet na samostatně volitelné části Přehled, Docházka, Dovolené, Kniha jízd a Lidé; na telefonu se vykreslí vždy jen vybraná část. Osobní Kniha jízd používá přihlášenou zaměstnaneckou stránku a ukládá jen zdrojem podporované změny bez GPS souřadnic. Nový Loxone Builder je dostupný pod LOXONE v Hubu a pod Systémy v Evora Smart Menu 3.0.26; Hub kontroluje pouze jeho pevný veřejný `/healthz` a projektové soubory neproxyuje. Kanál 7 „Parkoviště a brána“ zůstává autentizované HLS z přímého RTSP zdroje NVR bez MJPEG a bez Home Assistant kamery. Databázi, šifrované přístupy ani vlastní názvy release nemaže.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
