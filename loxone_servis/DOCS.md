# Instalace

Po instalaci otevřete **Loxone Servis** ze sidebaru Home Assistantu.

Při migraci existující flotily obnovte celý adresář `/data` ze zálohy původní instalace. Při nové prázdné instalaci je nutné vložit 32bajtový Base64 šifrovací klíč a PBKDF2 hash prvního správce.

Port 8099 používejte pouze za důvěryhodným HTTPS reverse proxy nebo Tailscale Funnel. Přístupy k Miniserverům se nikdy neukládají do GitHubu ani kontejnerového obrazu.
