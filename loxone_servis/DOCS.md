# Instalace a aktualizace

1. Přidejte tento GitHub repozitář do obchodu s aplikacemi Home Assistantu.
2. Nainstalujte **Loxone Servis**.
3. Na hlavní instalaci HA Práce vložte 32bajtový Base64 `credentials_master_key` a PBKDF2 hash hesla prvního správce. Při migraci obnovte celý adresář `/data` ze zálohy původní instalace.
4. Spusťte aplikaci a otevřete ji ze sidebaru.

## Režimy HA Práce a HA Domov

HA Práce je hlavní instalace a jako jediná obsahuje databázi i klíče. Volbu `canonical_base_url` na ní nevyplňujte.

Na HA Domov vyplňte `canonical_base_url` veřejnou HTTPS adresou hlavní instalace HA Práce. Aplikace se automaticky přepne do bezstavového klientského režimu: neotevře lokální databázi, nespustí plánovač a všechny obrazovky i API přepošle do HA Práce. Přihlašuje se stále přímo do Loxone Servisu, nikoli účtem Home Assistantu.

Port 8099 je určený pro přímý přístup přes důvěryhodný HTTPS reverse proxy nebo Tailscale Funnel. Nevystavujte jej na internet bez TLS.

### Veřejná cesta přes HA Práce

Repozitář obsahuje úzce omezenou HA integraci `homeassistant/custom_components/loxone_servis_proxy`. Na HA Práce zpřístupní pouze cestu `/api/loxone-servis/` a předá ji lokálnímu add-onu na portu 8099. Aplikace nadále vyžaduje vlastní e-mail, heslo, případně TOTP a všechny operace zapisuje do auditu.

Při použití Tailscale Funnel nastavte `share_homeassistant: funnel`, zvolený HTTPS port a v HA povolte důvěryhodný lokální proxy `127.0.0.1` podle oficiální dokumentace Tailscale add-onu. `canonical_base_url` klienta HA Domov potom nastavte na veřejnou HTTPS adresu včetně `/api/loxone-servis`, například `https://nazev.tailnet.ts.net:8443/api/loxone-servis`.

## Složky a struktura Gateway/Client

Tlačítko **Zjistit strukturu** načte z každého dostupného Miniserveru `/data/LoxAPP3.json`. Hodnota `msInfo.gatewayType` určí roli a známá SN nalezená v projektu Gateway vytvoří vazbu na Clienta pouze tehdy, když je výsledek jednoznačný. Neurčené nebo neodpovídající Clienty aplikace ponechá bez rodiče. Automatická kontrola běží nejvýše jednou denně a nikdy nepřepíše ručně nastavenou roli či vazbu.

Tlačítko **Složky** vytváří společné skupiny pro projekty s více samostatnými Miniservery nebo více systémy Gateway/Client. Smazání složky nemaže Miniservery; pouze je přesune do skupiny **Bez složky**.

## Data a zálohy

Databáze, šifrovací klíč, relace a přístupy k Miniserverům zůstávají v `/data` hlavního HA Práce. Standardní záloha Home Assistantu tato data zahrnuje.

Pro vzdálenou šifrovanou zálohu nastavte na HA Práce `backup_encryption_key` (32 náhodných bajtů v Base64) a `backup_pull_token` (nejméně 32 znaků). GitHub workflow stáhne pouze AES-256-GCM zašifrovaný soubor. Obnovovací klíč nesmí být uložen jako GitHub secret ani commitnut do repozitáře; patří do chráněné konfigurace HA Práce a do samostatné Klíčenky správce.
