# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.13 nahrazuje periodické kamerové snímky souvislým autorizovaným přenosem. Přehled Hubu a Evora Smart Menu 3.0.7 používají úsporný druhý stream, zatímco detail kamery po kliknutí načte hlavní stream. Hub sdílí jednu RTSP relaci stejné kamery mezi klienty, po odpojení posledního diváka ji ukončí a přihlašovací adresu nevystaví prohlížeči, argumentům procesu ani logu. Hodinový Microsoft Graph import zůstává pouze směrem do Hubu a zápis zpět je vypnutý; dosavadní data, vlastní názvy kamer a šifrovaná připojení zůstávají zachovaná.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
