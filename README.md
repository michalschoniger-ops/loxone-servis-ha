# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.12 opravuje načtení kamer ze staršího Milesight NVR použitím rozhraní, které používá i jeho web, a vytváří náhledy ze zdokumentovaných RTSP kanálů bez vystavení přihlašovací adresy v prohlížeči, argumentech procesu nebo logu. Každou kameru lze v Hubu přejmenovat a vlastní název se při obnovení seznamu zachová. Kamery mají samostatnou fialovou barvu odlišnou od oranžových incidentů. Evora Smart Menu 3.0.6 používá stejné rozlišení a po připojení zobrazuje živou verzi Hubu. Hodinový Microsoft Graph import zůstává pouze směrem do Hubu a zápis zpět je vypnutý; dosavadní data a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
