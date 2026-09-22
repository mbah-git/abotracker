# AboTracker

Einfache Web-App, um Abonnements und die monatlichen Ausgaben dafür im Blick zu behalten.

**Stack:** Node.js (Express 5) · EJS (Server-Rendering) · MySQL/MariaDB · Sessions in MySQL

## Funktionen

- Registrierung & Login (bcrypt-Passwörter, Sessions in der Datenbank, CSRF-Schutz, Rate-Limit)
- Abos anlegen, bearbeiten, löschen, pausieren
- Abrechnungszyklen wöchentlich / monatlich / quartalsweise / jährlich, alles auf Monatskosten umgerechnet
- Dashboard: Kosten pro Monat/Jahr, Donut-Diagramm nach Kategorie, teuerste Abos
- Nächste Zahlungen (rollt automatisch weiter) und anstehende Kündigungsfristen
- Admin-Bereich: Benutzer sperren/entsperren, zum Admin machen, löschen

## Projektstruktur

```
app.js                  Einstiegspunkt (auch für cPanel/Passenger)
db/schema.sql           Tabellen (idempotent)
scripts/migrate.js      npm run migrate – legt Tabellen an
scripts/seed.js         npm run seed    – Admin-User, Kategorien, Testdaten
src/                    Konfiguration, DB-Pool, Middleware, Routen
views/                  EJS-Templates
public/                 CSS, JS, Favicon
```

## Konfiguration

Alle Einstellungen kommen aus Umgebungsvariablen, siehe [.env.example](.env.example).
Zugangsdaten gehören **nie** ins Repository: Die `.env` ist per `.gitignore` ausgeschlossen.

| Variable | Beschreibung |
|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | MySQL-Verbindung |
| `SESSION_SECRET` | Langer Zufallswert zum Signieren der Session-Cookies |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` | Admin-User, den `npm run seed` anlegt bzw. aktualisiert |
| `BASE_PATH` | Optional, wenn die App in einem Unterordner läuft, z. B. `/abotracker` |
| `ALLOW_REGISTRATION` | `false` schaltet die öffentliche Registrierung ab |
| `SEED_DEMO_USER` | `false` = kein Demo-Benutzer beim Seed |

## Deployment auf Namecheap (cPanel)

### 1. Repository auf den Server klonen

Das GitHub-Repo ist privat. Damit cPanel es klonen kann:

1. cPanel → **SSH Access** → *Manage SSH Keys* → *Generate a New Key* (ohne Passphrase), danach den Public Key anzeigen und kopieren.
2. GitHub → Repo → **Settings → Deploy keys → Add deploy key** → Key einfügen (nur Lesezugriff).
3. cPanel → **Git™ Version Control** → *Create*
   - Clone URL: `git@github.com:mbah-git/abotracker.git`
   - Repository Path: z. B. `abotracker` (liegt dann unter `/home/<cpanel-user>/abotracker`)

### 2. Node.js-App einrichten

cPanel → **Setup Node.js App** → *Create Application*

| Feld | Wert |
|---|---|
| Node.js version | 20 oder neuer (mind. 18) |
| Application mode | Production |
| Application root | `abotracker` |
| Application URL | deine (Sub-)Domain |
| Application startup file | `app.js` |

Unter **Environment variables** eintragen (cPanel setzt diese Werte **nicht** automatisch):

```
NODE_ENV       = production
DB_HOST        = localhost
DB_NAME        = abotrackerdb
DB_USER        = abotrackeruser
DB_PASSWORD    = <dein DB-Passwort>
SESSION_SECRET = <langer Zufallswert>
ADMIN_EMAIL    = <deine Admin-E-Mail>
ADMIN_PASSWORD = <sicheres Admin-Passwort>
```

Einen `SESSION_SECRET` erzeugst du z. B. lokal mit:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Speichern, dann **Run NPM Install** klicken.

### 3. Datenbank anlegen und Admin erstellen

Im selben Dialog unter **Run JS script** das Skript `setup` ausführen
(entspricht `npm run migrate && npm run seed`). Das legt an:

- alle Tabellen,
- 8 Kategorien,
- den Admin-User aus `ADMIN_EMAIL` / `ADMIN_PASSWORD` mit 13 Testabos,
- einen Demo-Benutzer `demo@example.com` mit 3 Abos (Zufallspasswort, nur zur Anzeige in der Benutzerverwaltung).

Alternativ per SSH-Terminal:

```bash
source /home/<cpanel-user>/nodevenv/abotracker/20/bin/activate && cd ~/abotracker && npm run setup
```

Danach **Restart** klicken und die App aufrufen. Tipp: `ADMIN_PASSWORD` kann nach dem Seed wieder
entfernt werden. Ein erneuter Seed-Lauf setzt das Admin-Passwort zurück (praktisch, falls es vergessen wurde)
und legt keine doppelten Testdaten an.

### 4. Updates einspielen

1. Lokal committen und nach GitHub pushen.
2. cPanel → **Git™ Version Control** → *Manage* → *Pull or Deploy* → **Update from Remote**.
3. cPanel → **Setup Node.js App** → bei neuen Abhängigkeiten *Run NPM Install*, dann **Restart**.

## Lokale Entwicklung

Voraussetzungen: Node.js 18+, Docker (für eine lokale MariaDB).

```bash
docker run -d --name abotracker-db -p 3307:3306 -e MARIADB_ROOT_PASSWORD=rootpw -e MARIADB_DATABASE=abotrackerdb -e MARIADB_USER=abotrackeruser -e MARIADB_PASSWORD=localtestpw mariadb:10.6
```

`.env` aus `.env.example` erstellen, `DB_HOST=127.0.0.1`, `DB_PORT=3307`, `DB_PASSWORD=localtestpw` setzen, dann:

```bash
npm install
npm run setup
npm run dev
```

Die App läuft auf http://localhost:3000.
