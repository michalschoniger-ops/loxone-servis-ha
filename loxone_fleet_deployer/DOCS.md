# Evora Smart Hub Deployment Helper

Jednorázový instalační pomocník pro řízené nasazení lokálního Evora Smart Hubu 3.0.52.

- Vyhledá právě jeden lokální add-on se slugem `loxone_fleet`.
- Ověří kontrolní součet, slug, verzi a úplnost payloadu.
- Připraví ověřený zdroj 3.0.52 a zachová vratnou kopii živé verze 3.0.51.
- Původní zdroj přesune do vratné složky pod `/addons/.evora-smart-hub-rollback`.
- Operace `rollback` obnoví přesně poslední zdroj zaznamenaný helperem a vadný zdroj ponechá pro diagnostiku.
- Datový adresář aplikace ani databázi nemění.
- Po úspěšném běhu musí řídicí proces vyvolat Supervisor reload a rebuild lokálního add-onu.

Pomocník se instaluje a spouští pouze po výslovném schválení nasazení a následně se odinstaluje.
