# Sicherheit – Prüfung nach OWASP ASVS 4.0 Level 2

Stand: Phase 8 (20.11.2026). Die Prüfung wurde unabhängig vom Entwicklungsverlauf durchgeführt (Code, RLS-Richtlinien,
Infrastruktur, Abhängigkeiten); die Befunde wurden anschließend im Code nachvollzogen und behoben. Jeder behobene
Befund hat einen automatisierten Test (`api/test/phase8-security.test.ts`, sofern nicht anders angegeben).

`pnpm audit --prod` am 20.11.2026: **keine bekannten Schwachstellen.**

## 1. Befunde und Status

| Nr. | Schwere | Befund                                                                                                                                                             | Status                                                                                                                                                                                                         |
| --- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | hoch    | Eine Managed Identity für API, Worker, App und BC-Mock – API und Worker hätten dieselbe DB-Rolle (RLS wirkungslos); die Web-App hätte Secrets und Speicherzugriff. | **behoben:** drei Identitäten (E-57); Web-App nur Image-Pull. API/Worker prüfen beim Start die DB-Rolle und brechen in Azure ab, wenn RLS umgangen würde (Test „database role split“).                         |
| H2  | hoch    | Service Worker speicherte API-Antworten anderer Herkunft (u. a. Krankmeldungen) für 1 h – auch über Benutzerwechsel und Abmeldung hinweg.                          | **behoben:** keine Zwischenspeicherung fremder Herkunft (`NetworkOnly`), Abmeldung löscht Laufzeit-Caches, API sendet `Cache-Control: no-store` (Test „HTTP hardening“, E2E).                                  |
| M1  | mittel  | Push-Abo blieb nach Abmeldung bestehen; neues Abo auf geteiltem Gerät scheiterte (500).                                                                            | **behoben:** Abmeldung kündigt das Abo; ein Abo je Benutzer und Browser, der Worker stellt nur dem neuesten zu (Test „push on shared devices“).                                                                |
| M2  | mittel  | Krankmeldungstexte (Name, Zeitraum) auf Sperrbildschirmen; Benachrichtigungen ohne Löschfrist.                                                                     | **behoben:** neutraler Push-Text für Abwesenheiten; Löschfristen für Benachrichtigungen, Krankmeldungen, Kommentare (Tests). Empfänger „Personal“ aus den zuletzt gesehenen Entra-Rollen – Restrisiko siehe 3. |
| M3  | mittel  | Container-Apps-Adressen direkt erreichbar (WAF umgehbar).                                                                                                          | **behoben:** mit `FRONT_DOOR_ID` lehnt die API Verkehr ohne passende Front-Door-Kennung ab (Test). Für die Web-App (statische Seiten) bleibt die direkte Adresse erreichbar – unkritisch, da ohne Daten.       |
| M4  | mittel  | Umgebungsvariablen in Bicep passten nicht zum Code; Testumgebung hätte nur mit Entwicklungs-Login gestartet; DB-Passwort als Secret trotz Entra-Pflicht.           | **behoben:** Variablen angeglichen; Entwicklungs-Login in jeder Azure-Umgebung verboten (Test); Datenbank-Anmeldung per Entra-Token (`DATABASE_AUTH=entra`).                                                   |
| M5  | mittel  | Meister mit zusätzlicher Monteur-Rolle konnte eigene Zeiten, Entnahmen, Urlaub, Krankmeldung freigeben.                                                            | **behoben:** Vier-Augen-Prüfung in den Diensten (Tests). Die RLS-Richtlinie für Stempelereignisse lässt eigene Einträge weiter zu (eigene Stempelung), die Freigabe ist serverseitig gesperrt.                 |
| M6  | mittel  | Foto-Upload ohne serverseitige Prüfung von Größe und Dateityp; HTML/SVG im Speicher möglich; CORS `*`.                                                             | **behoben:** Abschluss prüft Größe (≤ 25 MB) und JPEG-Signatur, sonst Löschung (Test); Lese-Links erzwingen `image/jpeg`; CORS nur App-Adresse.                                                                |
| L1  | niedrig | Keine Prüfung von Scope und Client im Entra-Token; App-Tokens akzeptiert.                                                                                          | **behoben:** Scope `access_as_user` Pflicht, App-only-Tokens abgelehnt, erlaubte Clients konfigurierbar (Test). Empfehlung „Zuweisung erforderlich“ in `BETRIEB.md`.                                           |
| L2  | niedrig | Tabellen ohne RLS (`user_location`, `app_user`, `setting`, `feature_flag`, Stammdaten), auf die sich RLS stützt.                                                   | **offen (OP-40):** Schreibzugriffe nur über Admin-Routen mit Rollenprüfung; RLS-Schreibrichtlinien als Härtung geplant (erfordert Umbau der Erstanlage von Benutzern).                                         |
| L3  | niedrig | Breite Leserechte: Freigaben für Meister aller Standorte, Lager liest Chat/Fotos der Standortaufträge, Team-Kalender ohne Rollenprüfung.                           | **offen (OP-41):** fachlich zu bestätigen (Lager braucht Auftragskontext); Freigaben-Lesebereich auf Standort einschränken.                                                                                    |
| L4  | niedrig | BC-Client folgte `@odata.nextLink` mit Token zu beliebigem Host.                                                                                                   | **behoben:** nur gleicher Host (Test).                                                                                                                                                                         |
| L5  | niedrig | Admin sah in der Übertragungsliste Art (KRANK) und Text von Abwesenheiten.                                                                                         | **behoben:** geschwärzt (Test).                                                                                                                                                                                |
| L6  | niedrig | Signaturschlüssel des lokalen Speichers = Entwicklungs-Login-Secret; Query-Parser „extended“.                                                                      | **teilweise:** Query-Parser „simple“; lokaler Speicher nur dev/test (in prod gesperrt).                                                                                                                        |
| L7  | niedrig | Große Rohdaten (Upload, Diktat) wurden vor der Anmeldeprüfung gelesen; keine Ratenbegrenzung.                                                                      | **behoben:** Diktat nur mit Token, lokales Blob-Limit 1,1 MB; Ratenbegrenzung je Benutzer (600/min, anonym 150/min), Diktat 20/min (Test).                                                                     |
| L8  | niedrig | Web PubSub mit Zugriffsschlüssel; Key Vault, Storage, Web PubSub öffentlich erreichbar.                                                                            | **teilweise:** Web PubSub ohne Schlüssel (Managed Identity). Private Endpoints für Key Vault/Storage/Web PubSub: OP-42 (Kosten/Netzplanung).                                                                   |
| L9  | niedrig | `%`/`_` in der Artikelsuche nicht maskiert; Route-Matrix prüft `/dev/*` nicht.                                                                                     | **teilweise:** Suche maskiert. `/dev/*` ist in prod durch Konfiguration gesperrt (Test „dev login is refused“).                                                                                                |

Zusätzlich im Lasttest gefunden und behoben: **Verbindungs-Deadlock** – Feature-Flag-Abfragen innerhalb offener
Transaktionen konnten unter Last den Datenbank-Pool blockieren (Anfragen hingen unbegrenzt). Flags werden jetzt vor
der Transaktion gelesen, der Pool hat ein Zeitlimit, Überlast wird mit 503 + Retry-After beantwortet
(`api/test/load-sync.test.ts`).

## 2. Umgesetzte Kontrollen (Auswahl, ASVS-Kapitel)

| ASVS                           | Umsetzung                                                                                                                                                                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| V1 Architektur                 | Rollen- und Standortmodell in der Datenbank (RLS) **und** der API; getrennte DB-Rollen und Identitäten; Vier-Augen-Prinzip.                                                                                                            |
| V2/V3 Authentisierung, Sitzung | Entra ID (OIDC, MFA nach Unternehmensrichtlinie); RS256, Aussteller, Zielgruppe, Mandant, Ablauf, Scope, Client geprüft; keine eigenen Passwörter.                                                                                     |
| V4 Zugriffskontrolle           | Standardmäßig verweigert (globaler Guard); Rechtematrix aller Routen × 5 Rollen automatisch getestet (`security/route-matrix.test.ts`); RLS mit `FORCE`.                                                                               |
| V5 Eingaben                    | Zod-Schemas für alle Bodies/Query-Parameter; Drizzle mit Parametern; keine dynamischen SQL-Bezeichner aus Eingaben.                                                                                                                    |
| V7 Fehler, Protokolle          | Einheitliche Fehlerantworten ohne interne Details; Audit-Log für Korrekturen, Freigaben, Einstellungen.                                                                                                                                |
| V8 Datenschutz                 | `no-store`; Service Worker ohne API-Cache; Abmeldung löscht Gerätedaten; Datensparsamkeit (siehe `DATENSCHUTZ.md`).                                                                                                                    |
| V9 Kommunikation               | TLS 1.2+, HSTS (API und App); Datenbank privat im VNet.                                                                                                                                                                                |
| V10 Schadcode                  | Abhängigkeiten über Lockfile, `pnpm audit` in der Routine (`BETRIEB.md`).                                                                                                                                                              |
| V12 Dateien                    | Fotos nur JPEG ≤ 25 MB, serverseitig geprüft; Speicher privat, kurzlebige SAS; Pfade serverseitig erzeugt.                                                                                                                             |
| V13 API                        | CORS mit fester Ursprungsliste ohne Credentials; Ratenbegrenzung; nur Front-Door-Verkehr.                                                                                                                                              |
| V14 Konfiguration              | Sicherheitsheader (API: CSP `default-src 'none'`, nosniff, frame-ancestors; App: CSP mit fester `connect-src`-Liste, `object-src 'none'`, `frame-ancestors 'none'`); Swagger nur außerhalb prod; Entwicklungs-Login in Azure verboten. |

## 3. Restrisiken (bewusst akzeptiert bzw. offen)

- **CSP der App mit `'unsafe-inline'` für Skripte:** Die App-Shell ist statisch und wird offline aus dem Cache
  geladen; Nonces würden serverseitiges Rendern je Anfrage erfordern. Die Wirkung liegt in der festen Liste erlaubter
  Ziele (`connect-src`, `frame-src`), `object-src 'none'`, `base-uri 'none'`. Tokens liegen im Browser-Speicher (MSAL) –
  ein XSS wäre kritisch; React maskiert Ausgaben, `dangerouslySetInnerHTML` kommt nur einmal vor – für das
  feste Theme-Skript in `app/src/app/layout.tsx` ohne jede Benutzereingabe.
- **Offline-Daten unverschlüsselt im Browser:** Geräteverschlüsselung per MDM vorausgesetzt (`DATENSCHUTZ.md`).
- **Personal-Empfänger aus zuletzt gesehenen Entra-Rollen:** Wer die Rolle verliert, erhält bis zur nächsten Anmeldung
  weiter Hinweise (neutral formuliert). Abhilfe bei Austritt: Konto in der App deaktivieren.
- **Bicep lokal nicht kompiliert** (kein Bicep-Compiler in der Entwicklungsumgebung): vor dem ersten Deployment
  `az deployment group what-if` ausführen.
- **Offen:** L2 (OP-40), L3 (OP-41), private Endpunkte (OP-42).

## 4. Barrierefreiheit (zur Vollständigkeit)

axe-core-Prüfung aller Hauptseiten je Rolle in hellem und dunklem Modus (`e2e/tests/a11y.spec.ts`): **0 Befunde**
(WCAG 2.1 A/AA). Lighthouse-Ergebnisse siehe `STATUS.md`.
