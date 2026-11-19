# Projektstatus

## Phase 0 – Analyse & Plan ✅ (19.11.2026)

Architektur, Entscheidungen, offene Punkte. Bestätigt durch den Auftraggeber: Standort = Zuständigkeitseinheit (OP-07), Rolle „Lager“ (E-12), keine Vorgaben des CRM-Teams (OP-11). Kein Git-Repository vorhanden (OP-19).

## Phase 1 – Fundament ✅ (19.11.2026)

**Fertig**

| Bereich                | Inhalt                                                                                                                                                                                                                         | Tests                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------ |
| Monorepo               | pnpm + Turborepo, TypeScript strict, ESLint, Prettier                                                                                                                                                                          | –                              |
| `packages/shared`      | Rollen, Feature-Flags (BetrVG-Module markiert), Statusautomat mit BC-Mapping                                                                                                                                                   | 6                              |
| `packages/ui`          | CI-Tokens hell/dunkel, generiertes Theme-CSS, WCAG-AA-Prüfung aller Farbpaare                                                                                                                                                  | 33                             |
| `packages/bc-contract` | Schemas aller 23 BC-Endpunkte (Standard v2.0 + Extension)                                                                                                                                                                      | 2                              |
| `bc-mock`              | OData-Teilmenge, Paging, ETag/If-Match, `$batch`, Idempotenz, Webhooks, Fehlerinjektion, Löschprotokoll; 4 Standorte, Fendt/Valtra/MF/Amazone/Lemken/Horsch/Merlo/CAT                                                          | 33                             |
| `api`                  | Entra-JWT-Prüfung (Dev-Login nur außerhalb prod), Rollen- und Feature-Guard, Standort-Scope, Datenmodell (40 Tabellen), Row-Level Security (30 Richtlinien), Audit-Log, Admin-Endpunkte, Aufträge lesen, BC-Connector, OpenAPI | 112                            |
| `app`                  | PWA (Manifest, Service Worker, Icons), Login Entra/Dev, Header mit Sync-Status, Hell-/Dunkelmodus, Dashboards Monteur/Meister, Admin-Seite für Module je Standort, Offline-Grundlage (Dexie-Outbox)                            | 3                              |
| `bc-extension`         | 17 API-Pages, Abfrage Bestand je Lagerort, 6 Tabellenerweiterungen (Idempotenz-Feld), Löschprotokoll, Berechtigungssatz                                                                                                        | nicht kompilierbar ohne Tenant |
| `infra`                | Bicep: Container Apps, PostgreSQL (privat, Entra-Auth), Blob, Web PubSub, Key Vault, App Insights, ACR, optional Front Door                                                                                                    | nicht validiert                |
| CI/CD                  | `ci.yml` (Format, Lint, Typprüfung, Tests mit PostgreSQL, Build), `deploy.yml` (OIDC, dev → test → prod mit Freigabe), Dockerfiles                                                                                             | nicht ausgeführt               |

**Sicherheitsnachweis:** `api/test/security/` liest alle Routen aus dem OpenAPI-Dokument. Ein neuer Endpunkt ohne Eintrag in der Rechtematrix lässt den Build scheitern. Geprüft werden 401 ohne Token, 403 je Rolle, 404 für fremde Aufträge (Kollege, anderer Standort) und die Row-Level Security direkt in der Datenbank, auch bei ungefilterter Abfrage und vorgetäuschter Rolle.

**Nicht geprüft in dieser Umgebung**

- AL-Extension: kein AL-Compiler; erster Compile gegen die Tenant-Symbole nötig (OP-21).
- Bicep: CLI nicht installierbar; `az bicep build` vor dem ersten Deployment.
- Docker-Images: kein Docker-Daemon.
- GitHub-Workflows: syntaktisch geprüft, aber nie gelaufen (kein Repository).

**Bekannt / bewusst offen**

- Schriftdateien fehlen (OP-04): Browser meldet 404 für die Platzhalter-Fonts, Fallback Inter greift.
- Aufträge kommen in dev/test per Seed aus den Mock-Daten; der BC-Delta-Sync folgt in Phase 2.
- Zeitzonen der geplanten Zuweisungen im Seed sind UTC; die Zeitlogik mit Europe/Berlin folgt in Phase 2.

## Phase 2 – Kernprozess Monteur ✅ (19.11.2026)

**Fertig**

| Bereich                            | Inhalt                                                                                                                                                                                                                                                              | Tests                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Zeitlogik (`packages/shared/time`) | Segmente aus Stempelereignissen (Browser und Server identisch), Tageszusammenfassung, ArbZG-Warnungen (Pausen 30/45 min in 15-min-Blöcken, 6 h am Stück, 10 h/Tag, 11 h Ruhezeit), Viertelstunden-Rundung auf Tagessumme, Zeitzonen inkl. Sommerzeit                | 23 (inkl. Referenztag 5.1) |
| Sync-API                           | `POST /v1/sync/push` (idempotent, Gerätereihenfolge, Geräteuhr-Erkennung, Statusautomatik, Konfliktregeln), `GET /v1/sync/pull` (lückenloser Delta-Abruf)                                                                                                           | 14                         |
| BC-Delta-Sync (Worker)             | Auftragsarten, Debitoren, Maschinen, Serviceaufträge, Zeilen, Zuordnungen → Zuweisungen, Löschungen, gebuchte Rechnungen → „Abgerechnet“; Cursor je Entität, Fehler je Entität isoliert, Advisory Lock                                                              | 9                          |
| Worker-Jobs                        | Vergessene Ausstempelung → Pflichtkorrektur am Folgetag                                                                                                                                                                                                             | 1                          |
| App                                | Stempelleiste (Kommen/Gehen, Auftrag, Pause, Gemeinkosten, Stopp), Auftragsdetail (Navigation, Anrufen, Maschine, Status, Verlauf), Kalender Tag/Woche/Liste, „Meine Zeiten“ mit ArbZG-Hinweisen, Dashboard aus lokalen Daten, Sync-Engine mit Outbox und Hinweisen | 9                          |
| E2E (Playwright)                   | Arbeitstag mit 3 Aufträgen, Fahrzeit, Pause komplett im Flugmodus → Sync → 8 Ereignisse genau einmal, Zeiten korrekt, Status „In Arbeit“                                                                                                                            | 1                          |

**Bewusst verschoben**

- Push-Erinnerung „Ausstempeln vergessen“ → Phase 5 (Web Push). Das Markieren zur Pflichtkorrektur läuft bereits.
- Korrektur und Freigabe von Zeiten durch den Meister → Phase 3.
- On-Demand-Aktualisierung eines einzelnen Auftrags aus BC → Phase 3 (zusammen mit dem Rückschreiben).
- Webhook-Empfang aus BC → Phase 3; bis dahin läuft der Delta-Sync alle 3 Minuten.

**Aufgefallen**

- Im E2E-Test ging ein Tap auf „Gehen“ verloren, als er unmittelbar nach „Stopp“ kam, während sich die Leiste umbaute. Der Test wartet jetzt auf den neuen Zustand; im echten Betrieb sollte das in der Pilotphase beobachtet werden (Phase 8: Härtung der Stempelleiste gegen Schnellklicks).

## Phase 3 – Meister ✅ (19.11.2026)

**Fertig**

| Bereich         | Inhalt                                                                                                                                                                                                                                                                           | Tests                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Plantafel-API   | Board je Standort (Monteure, Einplanungen, Abwesenheiten ohne Grund, nicht eingeplante und neu einzuplanende Aufträge), Zuweisen, Verschieben, Entfernen, Konflikte (Doppelbelegung, Abwesenheit – nur Warnung), Benachrichtigung an den Monteur, Statuswechsel Neu ↔ Eingeplant | 5                              |
| Freigabe-Inbox  | Tage je Monteur mit Zusammenfassung, ArbZG-Hinweisen, Geräteuhr-Markierung; Freigabe → BC-Servicezeilen (Ressource) und Ressourcen-Buch.-Blatt; Auftragsfreigabe → BC-Status „Erledigt“                                                                                          | 6                              |
| Korrekturen     | Meister storniert/ergänzt Stempelungen (Pflichtbegründung, Audit vorher/nachher); Korrekturantrag des Monteurs bei vergessenem Ausstempeln; RLS: Monteur kann sich keine Korrekturen selbst anlegen                                                                              | 3                              |
| Transfer-Worker | Warteschlange mit `SKIP LOCKED`, Reihenfolge je Gruppe, Backoff, Dead-Letter nach 10 Versuchen, Wiederaufnahme nach Absturz, Idempotenz belegt (Wiederholung erzeugt keine doppelte BC-Zeile)                                                                                    | 4                              |
| Admin           | „Übertragungen nach BC“: Filter, erneut senden, als erledigt markieren (Begründung, Audit)                                                                                                                                                                                       | in Matrix + Phase-3-Tests      |
| App             | Meister-Navigation, Plantafel Tag/Woche mit Drag & Drop (Maus, Touch, Tastatur, Dialog), Freigabe-Seite mit Korrektur-Dialog, Inbox-Kacheln; Monteur: Korrekturantrag „Ausstempeln vergessen“                                                                                    | –                              |
| AL-Extension    | Zuordnungen dürfen jetzt geändert werden (Verschieben/Stornieren)                                                                                                                                                                                                                | nicht kompilierbar ohne Tenant |
| E2E             | Meister plant per Drag & Drop, gibt Zeiten frei; Worker schreibt Zuordnung und Servicezeile (3 h, Arbeitstyp ARBEIT, Ressource R0002) in den BC-Mock                                                                                                                             | 1                              |

Rechtematrix: alle 26 Routen × 5 Rollen automatisch geprüft.

**Bewusst verschoben**

- Webhooks aus BC und Aktualisieren eines einzelnen Auftrags auf Knopfdruck: noch offen. Der Delta-Sync alle 3 Minuten deckt den Bedarf zunächst ab; ich schlage vor, das in Phase 8 (Härtung) mit echter Sandbox zu bauen, weil das Webhook-Verhalten von BC nur dort sinnvoll testbar ist.
- Material- und Urlaubsfreigaben in der Inbox: Phase 4 bzw. 6 (Platzhalter vorhanden).
- Push-Benachrichtigung an Monteure: Phase 5 (die Benachrichtigungen werden bereits gespeichert).

**Aufgefallen und behoben**

- dnd-kit legte die Auftragskarte nach größter Überlappung ab statt unter dem Zeiger → eine Stunde zu früh (E-40).
- Screenreader las interne IDs auf Englisch vor → deutsche Ansagen mit Auftragsnummer, Monteur und Uhrzeit.
- Ein vom Server getrennter Leerlauf-Datenbankclient hätte den Worker-Prozess beenden können → Fehlerbehandlung am Pool.
