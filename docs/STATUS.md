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

## Phase 4 – Material ✅ (19.11.2026)

**Fertig**

| Bereich     | Inhalt                                                                                                                                                                                                                                                                                                                                                                                                                                     | Tests            |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------- |
| Fachlogik   | Bestellschluss 17:00 → Liefertag mit Wochenenden und Feiertagen je Bundesland, verfügbarer Bestand, Zählerstand-Plausibilität, AGCO-Absprung (nur Link, https-Pflicht), Teilenummer aus Einfügetext erkennen                                                                                                                                                                                                                               | 11               |
| BC-Sync     | Artikel, Barcodes (Artikelreferenzen), Bestand je Lagerort (Lager, Servicewagen, Tank), gebuchte Mengen der App-Zeilen                                                                                                                                                                                                                                                                                                                     | in Phase-4-Tests |
| Entnahme    | Offline-Befehle Entnehmen, Rückgängig, Bestellanforderung; Bestand sofort reduziert; Bestandskonflikt und Mindestbestand → Meldung an Meister und Lager                                                                                                                                                                                                                                                                                    | 16               |
| Freigabe    | Meister gibt Entnahmen je Auftrag frei oder lehnt ab; Auftrag → BC-Servicezeile Typ Artikel mit Lagerort; intern (Diesel) → Artikel-Buch.-Blatt, Abgang, Kostenstelle                                                                                                                                                                                                                                                                      | in Phase-4-Tests |
| Teiledienst | Rolle Lager: Bestellanforderungen (bestellt/geliefert/storniert, Monteur wird benachrichtigt), Liste „unter Mindestbestand“                                                                                                                                                                                                                                                                                                                | in Phase-4-Tests |
| App         | Teile-Shop (Suche offline im Standortkatalog, online zusätzlich andere Läger), Kamera-Scan (EAN/Code128/QR/DataMatrix, offline), Warenkorb je Auftrag, Bestellen mit Lieferhinweis, „Teil nicht im Stamm“, AGCO-Absprung + Teilenummer übernehmen; Verbrauchsstoffe-Shop mit Schnellwahl, Diesel an Kundenmaschine oder intern mit Kostenstelle und Zählerständen; Material am Auftrag mit Rückgängig; Meister-Freigabe; Teiledienst-Seite | –                |
| E2E         | 12 l Motoröl und ein Filter im Flugmodus entnommen (lokaler Bestand sinkt sofort) → Sync → Meister gibt frei → Artikelzeilen 12 L bzw. 1 STK im BC-Mock                                                                                                                                                                                                                                                                                    | 1                |

**Akzeptanz 5.4 belegt:** 12 l Motoröl auf Auftrag X ergeben nach Freigabe eine Artikelzeile mit 12 Liter am BC-Serviceauftrag; der angezeigte Bestand stimmt vor und nach dem Buchen in BC.

**Aufgefallen und behoben**

- Neue Seiten fehlten im Vorab-Cache → offline nicht erreichbar (E2E-Test hat es gefunden); `orderId` wird beim Cache-Abgleich jetzt ignoriert.
- Sperre des BC-Syncs konnte auf einer anderen Pool-Verbindung freigegeben werden als gesetzt → Sync hätte dauerhaft blockiert. Jetzt auf einer festen Verbindung, mit Test.
- Teile-Seite war auf dem Smartphone breiter als der Bildschirm; zwei Servicewagen hießen gleich; AGCO-Seriennummer wurde auch bei Fremdmarken angeboten.

**Offen / Hinweise**

- Gebinde pflegt der Admin vorerst über die API (`/v1/admin/containers`); eine Oberfläche dafür folgt mit der Admin-Stammdatenpflege in Phase 8.
- Gebuchte interne Entnahmen (Artikel-Buch.-Blatt) werden noch nicht aus BC zurückgemeldet; bis dahin reduziert der Worker-Abgleich den reservierten Bestand nicht automatisch (OP-25).

## Phase 5 – Dokumentation und Kommunikation ✅ (19.11.2026)

**Fertig**

| Bereich          | Inhalt                                                                                                                                                                                                                  | Tests            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Arbeitsbericht   | Pflichtfelder (ausgeführte Arbeiten, Befund), Textbausteine je Standort, offline speicherbar; „Fertig“ ohne vollständigen Bericht → „Fertig – Doku offen“, nach Nachtrag automatisch „Fertig“                           | in Phase-5-Tests |
| BC-Übertragung   | Bericht als Kommentarzeilen (≤ 80 Zeichen, Wortumbruch) am Serviceauftrag, immer vor der Statusänderung – erst nach Meister-Freigabe                                                                                    | in Phase-5-Tests |
| Fotos            | Komprimierung auf dem Gerät (max. 2.000 px, EXIF/GPS entfernt), Warteschlange offline, fortsetzbarer Upload in 1-MB-Blöcken (Azure-Blob-Protokoll; lokal emuliert), Kategorien (Schaden, Typenschild, Vorher/Nachher …) | in Phase-5-Tests |
| Chat             | Chat je Auftrag zwischen Monteur und Meister, offline schreiben, Lesebestätigungen, Fotos im Chat, Systemnachrichten bei Statuswechsel (Datenbank-Trigger)                                                              | in Phase-5-Tests |
| Benachrichtigung | Glocke mit Ungelesen-Zähler, Web Push (VAPID) wenn eingerichtet, Echtzeit über Azure Web PubSub (ohne Konfiguration: Abruf beim Sync), Erinnerung „vergessen auszustempeln“                                             | in Phase-5-Tests |
| Diktat           | Web Speech im Browser, alternativ Azure Speech (Region Germany West Central) über die API; KI-Umformulierung nur hinter Feature-Flag `dictation.ai` und ohne Anbieter deaktiviert                                       | in Phase-5-Tests |
| Löschfristen     | Nachtjob löscht Chat und Fotos nach Frist (OP-18)                                                                                                                                                                       | in Phase-5-Tests |
| E2E              | Bericht, Foto und Chat im Flugmodus → Sync → Foto-Upload → Meister sieht Foto und Statusnachricht, antwortet, gibt frei → Kommentarzeilen im BC-Mock                                                                    | 1                |

Tests gesamt: 449 API, 38 Fachlogik, 33 UI-Bausteine, 33 BC-Mock, 2 BC-Vertrag, 10 App, 4 E2E – alle grün. Rechtematrix um alle neuen Routen erweitert.

**Aufgefallen und behoben**

- Im Offline-Betrieb führte `router.push` ins Leere (Next lädt die Seitendaten vom Server) → Links werden offline als normale Seitenaufrufe aus dem Vorab-Cache geöffnet (E-47).
- Die lokale Datenbank-Transaktion beim Erfassen kannte die neuen Tabellen nicht → Bericht/Chat/Foto offline nicht speicherbar. Behoben, mit Unit-Test „jeder Befehlstyp ist offline erfassbar“.
- Neuere Chromium-Versionen geben bei `scrollIntoView` ein Promise zurück → React-Aufräumfunktion brach ab. Effekte haben jetzt Blockkörper.
- Kopfzeile war mit Glocke auf schmalen Smartphones zu breit → kompakte Darstellung.

**Offen / Hinweise**

- VAPID-Schlüssel, Speech-Schlüssel und CORS-Regel des Storage-Kontos für direkte Uploads müssen bei der Einrichtung gesetzt werden (OP-28 bis OP-30).
- KI-Umformulierung bleibt aus, bis ein Anbieter mit Datenverarbeitung in der EU freigegeben ist (OP-31).

## Phase 6 – Abwesenheiten ✅ (20.11.2026)

**Fertig**

| Bereich       | Inhalt                                                                                                                                                                                                                                             | Tests            |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Fachlogik     | Arbeitstage ohne Wochenende und Feiertage je Bundesland, halbe Tage, Aufteilung nach Jahren, Resturlaub (Anspruch + Übertrag − genehmigt − beantragt)                                                                                              | 7                |
| Krankmeldung  | Monteur in 2 Taps (Startseite → „Krank melden“ → „Krankmeldung senden“), offline; Hinweis auf eAU, kein Upload, keine Diagnose; Meister und Personal sofort benachrichtigt; Meister/Personal können für einen Monteur erfassen und das Ende setzen | in Phase-6-Tests |
| Urlaub        | Antrag ganz- oder halbtags offline, Resturlaub auf dem Gerät berechnet; Meister genehmigt oder lehnt mit Pflichtbegründung ab; Stornoantrag; Push an den Antragsteller                                                                             | in Phase-6-Tests |
| Team-Kalender | Kollegen sehen nur „abwesend“ – ohne Art und Kommentar, per Datenbank-Spiegeltabelle und RLS abgesichert (direkter Tabellenzugriff als Kollege getestet)                                                                                           | in Phase-6-Tests |
| Plantafel     | Aufträge eines krank gemeldeten Monteurs erscheinen unter „Neu einplanen“; genehmigter Urlaub sperrt das Einplanen (409); Zellen zeigen „krank“, „Urlaub“, „Urlaub beantragt“                                                                      | in Phase-6-Tests |
| BC-Transfer   | Adapter Mitarbeiterabwesenheit (Ursachencodes `KRANK`/`URLAUB`), BC-Mitarbeiter wird beim Senden aus der Zuordnung gelesen; Änderung oder Storno löscht den BC-Eintrag und schreibt ggf. neu – keine Duplikate                                     | in Phase-6-Tests |
| Personal      | Übersicht aller Standorte mit Art, Status und BC-Stand; Urlaubskonten pflegen                                                                                                                                                                      | –                |
| E2E           | Krankmeldung und Urlaubsantrag im Flugmodus → Sync → Meister bestätigt bzw. genehmigt, setzt das Ende → beide Einträge im BC-Mock → Personal sieht beides                                                                                          | 1                |

Tests gesamt: 514 API, 45 Fachlogik, 33 UI-Bausteine, 33 BC-Mock, 2 BC-Vertrag, 10 App, 5 E2E – alle grün.

**Akzeptanz (DoD) belegt:** Urlaub und Krankmeldung laufen Ende-zu-Ende inklusive BC-Transfer (E2E-Test `vacation-sick.spec.ts`).

**Aufgefallen und behoben**

- Eine Krankmeldung ohne Enddatum hätte jeden späteren Urlaubsantrag blockiert (E2E-Test hat es gefunden) → offene Krankmeldungen zählen bei Überschneidungen nur bis heute (E-52).
- Ein abgelehnter Offline-Antrag blieb in der App als „wird übertragen“ stehen → wird jetzt entfernt, der Grund erscheint als Hinweis.
- Auf der Plantafel galt eine offene Krankmeldung nur für ihren ersten Tag.
- Die E2E-Tests schlugen morgens vor 09:00 Uhr UTC fehl (Testtag über Mitternacht) → fester Tagesbeginn für den Offline-Arbeitstag.
- Die vierte Navigationsschaltfläche „Abwesenheit“ war auf dem Smartphone abgeschnitten.

**Offen / Hinweise**

- `docs/DATENSCHUTZ.md` (Verarbeitungsübersicht inkl. Krankmeldungen) folgt mit Phase 8.
- Krank während Urlaub und Eskalation offener Krankmeldungen: OP-32, OP-33.
