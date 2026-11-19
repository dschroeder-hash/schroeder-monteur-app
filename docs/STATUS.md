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
