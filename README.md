# MiniMail

Ein selbst hostbarer Web-Mail-Client mit IMAP, SMTP, mehreren Postfächern, Suche, Lesebereich, Anhängen, Verfassen sowie hellem und dunklem Design. Der Web-Zugang nutzt Benutzername, Passwort und TOTP-Zwei-Faktor-Anmeldung.

## Lokal starten

Voraussetzung: Node.js 24 oder neuer.

```bash
npm ci
npm run dev
```

Die Oberfläche ist unter `http://127.0.0.1:5173` erreichbar. Beim ersten Start werden `data/minimail.sqlite` und `data/secret.key` angelegt. Diese Dateien sind lokal und werden nicht in Git aufgenommen. `npm run build` erstellt die Produktionsdateien; `npm start` startet anschließend Frontend und API zusammen auf Port 3000. Für einen Produktionsstart ist `APP_ENCRYPTION_KEY` erforderlich.

Lege vor dem ersten Login den Admin im Terminal an:

```bash
npm run admin:create -- admin
```

Das Skript fragt das Passwort verdeckt ab. Lade die Seite danach neu. Eine Kontoerstellung im Browser gibt es nicht. Beim ersten Login richtet der Admin TOTP-2FA ein. Danach kann er unter **Einstellungen → Benutzerverwaltung** weitere Benutzer anlegen. Für jeden neuen Benutzer wird ein einmaliges Startpasswort angezeigt; beim ersten Login muss er es ändern und eigene 2FA einrichten. Jeder Benutzer sieht nur die eigenen Postfächer.

## Auf dem eigenen Server

1. Erstelle eine `.env` auf Basis von `.env.example`. `APP_ENCRYPTION_KEY` muss aus genau 64 zufälligen Hex-Zeichen bestehen, zum Beispiel erzeugt mit `openssl rand -hex 32`.
2. Baue das Image und lege den Admin interaktiv an: `docker compose build` und `docker compose run --rm -it minimail node server/create-admin.js admin`.
3. Starte mit `docker compose up -d`. Der Container ist nur auf `127.0.0.1:3000` des Servers erreichbar.
4. Richte einen Reverse Proxy mit HTTPS für deine Domain ein, der an `http://127.0.0.1:3000` weiterleitet und den ursprünglichen `Host`-Header erhält. Leite HTTP auf HTTPS um. Setze nach Möglichkeit HSTS am Proxy.
5. Öffne die Domain, melde dich als Admin an und aktiviere TOTP mit einer Authenticator-App. Verbinde danach dein erstes Postfach.

**Backup:** Sichere das Docker-Volume `minimail-data` und bewahre `APP_ENCRYPTION_KEY` separat auf. Ohne diesen Schlüssel lassen sich gespeicherte Postfach-Passwörter und der TOTP-Schlüssel nicht entschlüsseln. Die E-Mails selbst verbleiben auf dem jeweiligen Mailserver.

## Postfächer

MiniMail verbindet IMAP und SMTP über TLS: Port 993/465 mit direktem TLS oder Port 143/587 mit verpflichtendem STARTTLS. Ein lokaler Mailserver ist bei direktem Node-Start über `localhost` erreichbar. Im Docker-Container verwende `host.docker.internal` für einen Mailserver auf dem Host, sofern dieser Verbindungen aus dem Container zulässt. **Maildir- oder mbox-Dateien werden nicht direkt gelesen.**

Viele Provider mit eigener Zwei-Faktor-Anmeldung verlangen für IMAP/SMTP ein App-Passwort. Der TOTP-Code von MiniMail schützt den Web-Zugang und ersetzt diesen Provider-Schritt nicht. OAuth-Anmeldungen sind derzeit nicht implementiert.

Wenn der SMTP-Benutzername oder das SMTP-Passwort vom IMAP-Zugang abweicht, kannst du beide Angaben im Postfachdialog separat eintragen. Leere SMTP-Felder verwenden die IMAP-Zugangsdaten.

Der Server prüft den Posteingang jedes verbundenen Postfachs standardmäßig alle fünf Minuten, auch wenn kein Browser geöffnet ist. Unter **Einstellungen → Postfach bearbeiten → Automatischer Abruf** lässt sich das Intervall pro Postfach auf 1 bis 1440 Minuten setzen oder mit `0` abschalten. Bei geöffneter Oberfläche werden neue Zähler und Nachrichten automatisch übernommen.

## Umfang und Grenzen

- Postfächer und Ordner lesen; serverseitig in Betreff, Absender, Empfänger und Text suchen.
- Nachrichten lesen, Anhänge herunterladen, als gelesen/ungelesen oder markiert setzen, archivieren und löschen.
- Nachrichten mit bis zu acht Anhängen (zusammen maximal 8 MB) senden; Kopie im Gesendet-Ordner, sofern der Server APPEND erlaubt.
- Mehrere Web-Benutzer mit getrennten Postfächern. Neue Benutzer können nur Admins anlegen; Admins können Startpasswörter und 2FA für andere zurücksetzen.
- Nachrichten über 25 MB werden in der Webansicht nicht geladen. Externe Bilder in HTML-Mails werden aus Datenschutzgründen entfernt.

Für öffentlich erreichbare Installationen solltest du Updates regelmäßig einspielen und den Reverse Proxy sowie den Server aktuell halten. Die Anwendung hat noch keine OAuth-Provideranbindung, keine Maildir/mbox-Importfunktion und keine vollständigen Kalender-/Adressbuchfunktionen.

Technik: React/Vite, Express, ImapFlow, Nodemailer, SQLite (`node:sqlite`). Passwörter werden mit scrypt gehasht, Postfachdaten und TOTP-Secrets mit AES-256-GCM verschlüsselt. Session-Cookies sind HttpOnly und in Produktion Secure/SameSite=Strict mit `__Host-`-Präfix. Schreibende API-Anfragen verlangen einen eigenen Request-Header und prüfen Origin/Fetch-Metadata; API-Antworten werden nicht zwischengespeichert. Das Docker-Image läuft ohne Root-Rechte, und Compose startet es mit schreibgeschütztem Dateisystem und ohne Linux-Capabilities.

**Vertrauensgrenze:** Benutzer mit einem MiniMail-Zugang können IMAP- und SMTP-Ziele frei eintragen. Gib Zugänge nur vertrauenswürdigen Personen; falls Benutzer keine Dienste im internen Servernetz erreichen sollen, begrenze den ausgehenden Netzwerkzugriff des Containers zusätzlich auf die erlaubten Mailserver. Eine reine Prüfung von Hostnamen vor der Verbindung reicht wegen möglicher DNS-Änderungen nicht aus.

Bestehende Installationen werden beim Start automatisch migriert: Der bisherige einzelne Benutzer erhält die Admin-Rolle. Postfächer und Zugangsdaten bleiben dem jeweiligen Benutzer zugeordnet.
