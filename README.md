# Schröder Monteur-App

Offline-fähige Werkstatt- und Außendienst-App für die Schröder-Gruppe (Business Central, Azure, Entra ID).

| Dokument                                           | Inhalt                                     |
| -------------------------------------------------- | ------------------------------------------ |
| [PROMPT.md](./PROMPT.md)                           | Auftrag                                    |
| [docs/ARCHITEKTUR.md](./docs/ARCHITEKTUR.md)       | Komponenten, Datenmodell, Sync, BC-Mapping |
| [docs/ENTSCHEIDUNGEN.md](./docs/ENTSCHEIDUNGEN.md) | Architekturentscheidungen                  |
| [docs/OFFENE-PUNKTE.md](./docs/OFFENE-PUNKTE.md)   | Offene Fragen mit Annahmen                 |
| [docs/SETUP-BC.md](./docs/SETUP-BC.md)             | Checkliste Business Central für die IT     |
| [docs/STATUS.md](./docs/STATUS.md)                 | Stand je Phase                             |
| [infra/README.md](./infra/README.md)               | Azure-Deployment (Bicep)                   |
| [bc-extension/README.md](./bc-extension/README.md) | AL-Extension installieren                  |

## App ansehen (Demo mit Testdaten)

**Im Browser, ohne Installation (auch für das iPad):**

1. Am **PC** (Chrome/Edge) diesen Link öffnen und **Create codespace** wählen:
   https://codespaces.new/dschroeder-hash/schroeder-monteur-app/tree/ohne-meister
   (nach dem Zusammenführen den Branch `main` verwenden).
2. Nichts eintippen – die Demo startet von selbst (erster Start ca. 5 Minuten). Fortschritt im Terminal:
   `tail -f /tmp/demo.log`. Am Ende steht dort die Adresse der App (`https://…-3000.app.github.dev`).
3. Die Adresse auf dem **iPad** in Safari öffnen; dort mit demselben GitHub-Konto angemeldet sein. Optional
   **Teilen → Zum Home-Bildschirm**.

Anmeldung über die Test-Personen (Monteur, Werkstatt-PC mit `M0001`/`1234`, Lager, Admin). Business Central und
M-Files werden durch eingebaute Testersätze ersetzt. Ein Codespace stoppt nach ca. 30 Minuten ohne Nutzung; beim
erneuten Öffnen startet die Demo wieder von selbst.

**Auf dem eigenen Rechner:** Node 22, pnpm 9 und PostgreSQL 16 installieren, dann `scripts/demo.sh` und
http://localhost:3000 öffnen. Bildschirmfotos: `docs/screenshots/`.

## Struktur

```
app/                  Next.js-PWA (Monteur, Meister, Personal, Admin)
api/                  NestJS-API + Worker, Drizzle-Schema und Migrationen (api/drizzle)
bc-mock/              Business-Central-Mock mit Landtechnik-Testdaten
bc-extension/         AL-Extension (API-Pages schroeder/werkstatt/v1.0)
infra/                Bicep für Azure (Germany West Central)
packages/shared       Fachlogik für Browser und Server (Rollen, Status, Feature-Flags …)
packages/bc-contract  Schemas aller BC-Endpunkte (Basis für Connector, Mock, Contract-Tests)
packages/ui           Designsystem mit Schröder-CI-Tokens
```

## Lokal starten

Voraussetzungen: Node 22, pnpm 9 (`corepack enable`), PostgreSQL 16.

```bash
pnpm install
```

```bash
pnpm build
```

Datenbank anlegen, migrieren und mit Testdaten füllen (als Eigentümer `postgres`):

```bash
createdb monteur && DATABASE_URL=postgres://postgres:postgres@localhost:5432/monteur node api/dist/db/migrate.js && DATABASE_URL=postgres://postgres:postgres@localhost:5432/monteur node api/dist/seed/dev-seed.js
```

Die API darf **nicht** als Superuser verbinden, sonst greift die Row-Level Security nicht (ENTSCHEIDUNGEN E-28):

```bash
psql postgres://postgres:postgres@localhost:5432/monteur -c "CREATE ROLE monteur_api_dev LOGIN PASSWORD 'dev' IN ROLE monteur_app"
```

API, BC-Mock und App starten (jeweils eigenes Terminal):

```bash
APP_ENV=dev AUTH_MODE=dev DEV_AUTH_SECRET=dev-secret-dev-secret-dev-secret-123 DATABASE_URL=postgres://monteur_api_dev:dev@localhost:5432/monteur node api/dist/main.js
```

```bash
node bc-mock/dist/main.js
```

```bash
cd app && NEXT_PUBLIC_AUTH_MODE=dev pnpm dev
```

App: http://localhost:3000 (Entwicklungs-Login mit Testpersonen) · API-Doku: http://localhost:4000/docs

## Tests

```bash
TEST_DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres pnpm test
```

Die API-Tests legen die Datenbank `monteur_test` jeweils neu an und verbinden mit einer Rolle ohne Sonderrechte, damit die Row-Level Security wirklich geprüft wird.
