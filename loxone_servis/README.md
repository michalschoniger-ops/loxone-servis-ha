# Evora Smart Hub

Bezpečný servisní a monitorovací hub EVORA Smart pro Loxone Miniservery a Home Assistant instalace.

Po instalaci aplikace otevřete její webové rozhraní ze sidebaru Home Assistantu. Citlivá data jsou uložena pouze v trvalém adresáři `/data` dané instalace a nejsou součástí obrazu ani GitHub repozitáře.

Vydání 3.0.63 bezpečně rozpozná a uklidí pouze nedokončené dočasné databáze vlastního exportu starší než hodinu. Vydání 3.0.62 přidalo tokenem chráněnou diagnostiku velikostí databázových tabulek a úzce omezenou údržbu starších plných LoxAPP3 snímků. Ponechá dvě nejnovější kopie každého Miniserveru i všechny souhrny změn; přístupy, aktuální projekty, úlohy a audit nemaže. Vydání 3.0.61 přidalo auditovaný zápis úplné náhrady přihlašovacích údajů jednoho Miniserveru přes osobní admin token. Evora Smart Menu 3.0.43 díky němu nabídne doplnění přístupů novému Miniserveru i jejich pozdější aktualizaci, aniž by staré heslo vracelo do formuláře nebo logu. Menu zároveň udrží otevřenou cestu při úpravách docházky a jízd, vynutí okamžitý read-back, průběžně kontroluje tickety a sdružuje nové odpovědi i chybějící přístupy do červeného číselného badge. Technická edice zůstává ve verzi 3.0.35 a Windows Menu ve verzi 3.0.34.
