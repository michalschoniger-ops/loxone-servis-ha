# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 3.0.44 zachovává serverové změny 3.0.42 a opravuje pravdivé hlášení databázového schématu 23. Obsahuje správcovské ruční doplnění telefonů kontaktů Intranetu, synchronní autentizovaný proklik Miniserveru, neblokující HLS kanálu 7 a dva šifrované serverové povely brány bez předávání adres klientům. Součástí je Evora Smart Menu 3.0.29 jako tmavé nativní macOS `NSMenu`: hodnoty i vzhled přepisuje pouze při skutečné změně, zakazuje implicitní animace vrstev a nepulzuje stavovou ikonou. Stavové snímky drží v paměti, při otevřené nabídce neprovádí těžké obnovy, Milesight ani Loxone Builder nezobrazuje a kameru označí jako živou až po skutečném postupu videa. Kniha jízd může uložit validované počáteční a koncové GPS konkrétní jízdy; nejde o průběžné sledování zařízení. Databázi, šifrované přístupy ani vlastní názvy vydání nemaže.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
