# Evora Smart Hub

Bezpečný servisní a monitorovací hub EVORA Smart pro Loxone Miniservery a Home Assistant instalace.

Po instalaci aplikace otevřete její webové rozhraní ze sidebaru Home Assistantu. Citlivá data jsou uložena pouze v trvalém adresáři `/data` dané instalace a nejsou součástí obrazu ani GitHub repozitáře.

Vydání 3.0.72 opravuje distribuci Windows Launcheru 3.0.0.16. Stahování Stable, Beta a Alpha Configu probíhá přímo přes HTTPS do složky Stažené soubory ve Windows bez Edge; Launcher ověří doménu LOXONE, velikost a ZIP signaturu.

Vydání 3.0.69 přidává auditované ruční založení Miniserveru z osobního macOS Menu. Heslo Hub ukládá pouze šifrovaně; po zápisu zařadí kontrolu dostupnosti a ověří model přes oficiální `msInfo.miniserverType` v `LoxAPP3`, takže fotografii nepřiřazuje odhadem ze sériového čísla. Zachovává také aktuální historii školení a Partner Coache včetně vycentrované fotografie, kontaktů, dostupnosti a odkazů na schůzku.

Vydání 3.0.67 přidává sanitovaný důvod nedostupnosti každé volitelné části LOXONE Portálu bez obsahu odpovědi, cookie nebo tokenu. Vydání 3.0.66 přijímá úspěšná účetní data aktuální stránky Moje účty také tehdy, když odpověď neobsahuje obecný příznak `valid`; výslovné `valid: false` zůstává chybou.

Vydání 3.0.64 rozšiřuje stávající šifrovanou synchronizaci LOXONE Portálu o partner status, certifikaci, kredit, obrat, otevřené objednávky, účetní saldo, pohledávky a školení. Tyto čtecí přehledy se ukládají bez přihlašovacích údajů a finanční data vydává osobnímu Menu API jen správci. Evora Smart Menu 3.0.44 navíc načítá kalendáře zasedaček přímo z Evora Intranetu, ukazuje aktuální obsazenost a události, rezervuje přímo do M365 a nabízí platné docházkové akce jako horní ikony.

Vydání 3.0.63 bezpečně rozpozná a uklidí pouze nedokončené dočasné databáze vlastního exportu starší než hodinu. Vydání 3.0.62 přidalo tokenem chráněnou diagnostiku velikostí databázových tabulek a úzce omezenou údržbu starších plných LoxAPP3 snímků. Ponechá dvě nejnovější kopie každého Miniserveru i všechny souhrny změn; přístupy, aktuální projekty, úlohy a audit nemaže. Vydání 3.0.61 přidalo auditovaný zápis úplné náhrady přihlašovacích údajů jednoho Miniserveru přes osobní admin token. Evora Smart Menu 3.0.43 díky němu nabídne doplnění přístupů novému Miniserveru i jejich pozdější aktualizaci, aniž by staré heslo vracelo do formuláře nebo logu. Menu zároveň udrží otevřenou cestu při úpravách docházky a jízd, vynutí okamžitý read-back, průběžně kontroluje tickety a sdružuje nové odpovědi i chybějící přístupy do červeného číselného badge. Technická edice zůstává ve verzi 3.0.35 a Windows Menu ve verzi 3.0.34.
