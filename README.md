# EVORA Smart Hub pro LOXONE a Home Assistant

Veřejný instalační katalog pro Home Assistant. Obsahuje jen instalační metadata a hotový aplikační runtime, ze kterého Home Assistant sestaví lokální obraz. Neobsahuje hesla, databáze ani zákaznické údaje. HA Práce lze provozovat jako jediný hlavní server a HA Domov jako bezstavového klienta, takže obě instalace i veřejný HTTPS odkaz používají stejná aktuální data.

Verze 2.2.2 odstraňuje trhání mobilní postranní nabídky: sekundový čas docházky už nepřekresluje celou flotilu a panel se otevírá kompozičním posunem přes GPU. Docházkové akce mají kompaktní hlavičku bez počtu upozornění, Intranet je jednořádkový, Home Assistant má spolehlivou vloženou ikonu a velké mobilní buňky používají jednotnou výšku, text i ikony. Loga dostala lehkou transformovou animaci bez náročného animování stínů. Zachovává správcovskou integraci **Evora Intranet**, bezpečnostní opravu logů z 2.2.1, WorkLogAI 5.8.2 i všechna uložená data.

[Přidat repozitář do Home Assistantu](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fmichalschoniger-ops%2Floxone-servis-ha)

Ručně lze přidat adresu:

```text
https://github.com/michalschoniger-ops/loxone-servis-ha
```
