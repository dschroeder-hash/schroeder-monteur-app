# Entscheidungen

Format: kurze Architecture Decision Records. Status: **entschieden** (von mir getroffen, änderbar mit Begründung), **vorgegeben** (aus dem Auftrag, nicht neu verhandeln), **vorläufig** (Annahme bis zur Klärung in OFFENE-PUNKTE.md).

| Nr.  | Thema                                                                     | Status      |
| ---- | ------------------------------------------------------------------------- | ----------- |
| E-01 | Monorepo mit pnpm + Turborepo, zusätzlicher Ordner `/packages`            | entschieden |
| E-02 | Backend: NestJS (API + Worker aus einer Codebasis)                        | entschieden |
| E-03 | ORM: Drizzle statt Prisma                                                 | entschieden |
| E-04 | Hosting: Azure Container Apps                                             | vorläufig   |
| E-05 | PWA-Tooling: Serwist (Workbox-basiert)                                    | entschieden |
| E-06 | Sync über idempotente Kommandos + Cursor-Pull                             | entschieden |
| E-07 | Stempelereignisse append-only, Zeiten abgeleitet                          | entschieden |
| E-08 | Rechte doppelt: Service-Scope + PostgreSQL RLS                            | entschieden |
| E-09 | BC-Transfer-Queue in PostgreSQL statt Service Bus                         | entschieden |
| E-10 | Echtzeit: Azure Web PubSub                                                | entschieden |
| E-11 | Infrastruktur als Code: Bicep                                             | entschieden |
| E-12 | Zusätzliche Rolle „Lager“                                                 | vorläufig   |
| E-13 | Zuweisungen werden sofort nach BC geschrieben                             | entschieden |
| E-14 | BC-Status wird nur bei Meister-Freigabe geschrieben                       | entschieden |
| E-15 | Rundung auf Tagessumme je Auftrag und Tätigkeit                           | vorläufig   |
| E-16 | Bestand = BC-Bestand − noch nicht in BC gebuchte App-Entnahmen            | entschieden |
| E-17 | Diesel intern als ungebuchte Artikel-Buch.-Blatt-Zeile                    | vorläufig   |
| E-18 | Barcode-Scan mit zxing-wasm                                               | entschieden |
| E-19 | Feature-Flags je Modul **und** Standort                                   | entschieden |
| E-20 | Fremde Datensätze → 404 statt 403                                         | entschieden |
| E-21 | Plantafel mit dnd-kit                                                     | entschieden |
| E-22 | Feiertage nach Bundesland des Standorts                                   | entschieden |
| E-23 | Auftragsart-Mapping versioniert (`valid_from`)                            | entschieden |
| E-24 | Abwesenheit nach BC: eine Zeile je Kalendertag                            | vorläufig   |
| E-25 | Mock-Server mit Fastify, gemeinsame Contract-Schemas                      | entschieden |
| E-26 | NestJS 11 statt 12                                                        | entschieden |
| E-27 | PWA-Build mit Webpack statt Turbopack                                     | entschieden |
| E-28 | Eigene Datenbankrollen für API und Worker                                 | entschieden |
| E-29 | Unbekannte Entra-Benutzer werden ohne Rechte angelegt                     | entschieden |
| E-30 | Service Worker cacht keine API-Daten                                      | entschieden |
| E-31 | Logo auf weißer Fläche im Dunkelmodus                                     | entschieden |
| E-32 | Sync-Auslöser: Fokus, Online-Event, Intervall – keine Background Sync API | entschieden |
| E-33 | Lückenloser Delta-Pull über Transaktions-IDs (xid8)                       | entschieden |
| E-34 | Auftragsdetail über Query-Parameter, App-Seiten vorab gecacht             | entschieden |
| E-35 | Stempelregeln: implizites Kommen, Pause unterbricht und setzt fort        | entschieden |
| E-36 | Zeitbuchungen werden bei jedem Stempel neu abgeleitet                     | entschieden |

---

### E-01 Monorepo mit pnpm + Turborepo, zusätzlicher Ordner `/packages`

**Kontext:** Vorgegeben sind `/app`, `/api`, `/bc-extension`, `/bc-mock`, `/infra`, `/docs`. Domänenlogik (Zeitberechnung, ArbZG, Produktivität, Statusautomat) muss offline im Browser **und** auf dem Server identisch laufen; BC-Connector und Designsystem sollen ins CRM übernommen werden.
**Entscheidung:** Ergänzend `/packages/shared`, `/packages/bc-contract`, `/packages/ui`. pnpm Workspaces, Turborepo für Build-Cache.
**Folge:** Eine Wahrheit für Berechnungen, kein Auseinanderlaufen von Client und Server. Die Pakete lassen sich später als `@schroeder/*` veröffentlichen.

### E-02 Backend: NestJS

**Kontext:** Auftrag erlaubt NestJS oder Next.js Route Handlers.
**Entscheidung:** NestJS als eigener Dienst. Guards/Interceptors für Rollen, Feature-Flags und Scope; `@nestjs/swagger` für OpenAPI; derselbe Code startet als `worker` (BC-Sync, Transfer-Queue, Cronjobs) ohne HTTP-Server.
**Begründung:** Saubere Service-Schicht, testbare Dependency Injection, unabhängige Skalierung von UI und API, und das CRM kann die API direkt nutzen, ohne an das Next.js-Deployment gebunden zu sein.

### E-03 ORM: Drizzle

**Entscheidung:** Drizzle ORM + drizzle-kit (versionierte SQL-Migrationen im Repo).
**Begründung:** RLS braucht `SET LOCAL` je Transaktion und eigene Policies – Drizzle arbeitet nah an SQL, Migrationen sind lesbares SQL und können Policies, Sequenzen (`row_version`) und Trigger direkt enthalten. Prisma wäre möglich, erschwert aber genau diese Punkte.

### E-04 Hosting: Azure Container Apps (vorläufig)

**Entscheidung:** `app`, `api`, `worker` und (in dev/test) `bc-mock` als Container Apps in Germany West Central, private Anbindung an PostgreSQL, Ingress über Azure Front Door mit WAF.
**Begründung:** Gleiche Container-Images für alle Umgebungen, Worker als eigener Prozess, Skalierung auf null in dev.
**Vorbehalt:** Sollte das CRM-Team App Service nutzen, gleichen wir an (OP-11). Die Images ändern sich dadurch nicht.

### E-05 PWA-Tooling: Serwist

**Entscheidung:** Serwist (`@serwist/next`) statt `next-pwa`.
**Begründung:** `next-pwa` wird nicht mehr gepflegt und unterstützt den App Router nur eingeschränkt. Serwist ist der Workbox-basierte Nachfolger – die Vorgabe „Workbox“ bleibt inhaltlich erfüllt.

### E-06 Sync über idempotente Kommandos + Cursor-Pull

**Entscheidung:** Der Client schickt fachliche Kommandos mit Client-UUID in Gerätereihenfolge; der Server verarbeitet idempotent und liefert Änderungen per globalem `row_version`-Cursor.
**Begründung:** Erfüllt „ohne Duplikate“ technisch zwingend (Primärschlüssel-Konflikt statt Heuristik), bewahrt die Reihenfolge (Chat, Stempel) und erlaubt serverseitige Validierung jedes Schritts. Generischer Datensatz-Abgleich (CRDT, Replikation) wäre für fachliche Regeln wie „genau eine laufende Auftragszeit“ ungeeignet.

### E-07 Stempelereignisse append-only

**Entscheidung:** Rohereignisse werden nie verändert; Zeitsegmente werden deterministisch abgeleitet, Korrekturen als Revision mit Begründung gespeichert.
**Begründung:** Revisionssicherheit (Audit, Betriebsrat), reproduzierbare Berechnung, robuste Offline-Zusammenführung.

### E-08 Rechte doppelt: Service-Scope + RLS

**Entscheidung:** Jede Repository-Methode verlangt einen `AccessScope`; zusätzlich PostgreSQL Row-Level Security auf allen personenbezogenen Tabellen.
**Begründung:** „Monteur darf technisch niemals fremde Daten abrufen“ – ein vergessener Filter im Code soll nicht reichen, um Daten offenzulegen.

### E-09 BC-Transfer-Queue in PostgreSQL

**Entscheidung:** Tabelle `bc_transfer`, Abarbeitung mit `SELECT … FOR UPDATE SKIP LOCKED`, Backoff, Dead-Letter-Status.
**Begründung:** Die Freigabe und das Einreihen passieren in **derselben** Datenbanktransaktion (Transactional Outbox) – kein Verlust, kein Doppel. Das Volumen (einige tausend Zeilen pro Tag) braucht keinen Service Bus. Admin-Ansicht und „Erneut senden“ sind einfache SQL-Abfragen.

### E-10 Echtzeit: Azure Web PubSub

**Entscheidung:** Azure Web PubSub mit serverseitig ausgestellten Gruppen-Tokens.
**Begründung:** Funktioniert unabhängig von der API-Instanz (Container Apps skalieren horizontal), kein Sticky Session nötig, Gruppenrechte werden beim Token ausgestellt.

### E-11 Bicep

**Entscheidung:** Bicep statt Terraform.
**Begründung:** Reines Azure-Ziel, kein State-File zu verwalten, Entra-/Azure-Teams kennen es in der Regel. Wechselt das CRM auf Terraform, ist die Modulstruktur 1:1 übertragbar.

### E-12 Zusätzliche Rolle „Lager“ (vorläufig)

**Kontext:** 5.4 und 5.5 verlangen Warnungen und Bestellanforderungen „ans Lager“; die Rollentabelle in Abschnitt 4 kennt kein Lager.
**Entscheidung:** App Role `Werkstatt.Lager`: sieht Bestellanforderungen und Mindestbestandswarnungen seines Standorts, keine Zeiten, keine Produktivität.
**Alternative:** Nur Benachrichtigung an eine konfigurierbare Postfach-/Teams-Adresse je Standort.

### E-13 Zuweisungen sofort nach BC

**Kontext:** „Schreiben nur nach Freigabe durch den Meister“.
**Entscheidung:** Eine Zuweisung auf der Plantafel **ist** eine Meister-Handlung und gilt als freigegeben; sie wird ohne zweiten Freigabeschritt als Service Order Allocation übertragen.

### E-14 BC-Status nur bei Meister-Freigabe

**Entscheidung:** Der Feinstatus lebt in der App. Nach BC wird standardmäßig nur bei „Freigegeben (Meister)“ der Status `Finished` geschrieben. Je Feinstatus konfigurierbar.
**Begründung:** Hält den Grundsatz „Schreiben nur nach Freigabe“ ein und vermeidet Statusflattern in BC, das Disposition und Abrechnung stört.

### E-15 Rundung auf Tagessumme je Auftrag und Tätigkeit (vorläufig)

**Entscheidung:** Ist-Minuten je Segment werden gespeichert; gerundet wird die Tagessumme je Monteur × Auftrag × Tätigkeitsart, Raster 15 min, kaufmännisch. Konfigurierbar: Raster, Modus (kaufmännisch/auf/ab), Basis (Segment/Tagessumme).
**Begründung:** Segmentrundung bei häufigem Auftragswechsel verfälscht stark (z. B. 4 × 8 min = 1 h statt 0,5 h). Klärung OP-08.

### E-16 Verfügbarer Bestand

**Entscheidung:** Angezeigter Bestand = BC-Bestand je Lagerort − App-Entnahmen, die in BC noch nicht gebucht sind (Abgleich über `Quantity Consumed/Shipped` der Servicezeile bzw. Buch.-Blatt-Status).
**Begründung:** Zwischen Freigabe und Buchung in BC sinkt der BC-Bestand noch nicht; ohne diese Korrektur würde Ware doppelt verfügbar erscheinen.

### E-17 Diesel intern (vorläufig)

**Entscheidung:** Abgabe an Servicewagen/Vorführmaschine → Artikel Buch.-Blatt-Zeile (Abgang) mit Dimension Kostenstelle, **nicht gebucht**. Tankanlage = BC-Lagerort je Standort mit Artikel „Diesel“ in Litern.
**Klärung:** OP-09 (wie wird Diesel heute gebucht?).

### E-18 Barcode-Scan mit zxing-wasm

**Begründung:** `BarcodeDetector` fehlt in Safari/iOS. zxing-wasm liest EAN-13, Code 128, QR und DataMatrix auf allen Zielplattformen gleich.

### E-19 Feature-Flags je Modul und Standort

**Begründung:** Betriebsratszustimmungen können betriebs- bzw. standortweise erfolgen. Flags werden serverseitig erzwungen, nicht nur ausgeblendet.

### E-20 404 statt 403

**Begründung:** Verhindert das Ausspähen, ob eine Auftrags- oder Zeit-ID existiert.

### E-21 Plantafel mit dnd-kit

**Begründung:** Touch- und Tastaturbedienung (iPad, Barrierefreiheit), aktiv gepflegt, kein jQuery-Erbe.

### E-22 Feiertage nach Bundesland

**Begründung:** Deutsche Standorte liegen in verschiedenen Bundesländern; Feiertage beeinflussen Anwesenheitssoll, Plantafel und Urlaubstage. Bibliothek `date-holidays` + Admin-Pflege.

### E-23 Auftragsart-Mapping versioniert

**Begründung:** Ein späteres Bonussystem braucht reproduzierbare Monatswerte. Mappingänderungen wirken ab `valid_from` und verändern abgeschlossene Monate nicht.

### E-24 Abwesenheit: eine BC-Zeile je Kalendertag (vorläufig)

**Begründung:** Employee Absence arbeitet tagesbezogen (From/To Date, Quantity). Eine Zeile je Arbeitstag erlaubt halbe Tage, Teilstornos und saubere Idempotenz (`Monteur App Id` = Abwesenheits-ID + Datum). Wochenenden und Feiertage werden ausgelassen.

### E-25 BC-Mock mit Fastify und gemeinsamen Contract-Schemas

**Begründung:** Leichtgewichtig, schnell im CI-Start. Mock und Connector validieren gegen dieselben Zod-Schemas aus `packages/bc-contract`; Abweichungen zur echten Sandbox werden über aufgezeichnete Fixtures erkannt.

### E-26 NestJS 11 statt 12

**Entscheidung:** NestJS 11 (wird weiter gepflegt, letzte Version 11.2.11 vom 18.11.2026).
**Begründung:** Breiter erprobt, alle Zusatzpakete (Swagger, Testing) stabil. Ein Wechsel auf 12 ist später ohne Architekturänderung möglich.

### E-27 PWA-Build mit Webpack

**Entscheidung:** `next build --webpack`.
**Begründung:** Serwist (E-05) erzeugt den Service Worker über ein Webpack-Plugin. Turbopack ist in Next.js 16 Standard, für den Service-Worker-Build aber noch nicht ausreichend unterstützt.

### E-28 Eigene Datenbankrollen für API und Worker

**Entscheidung:** Die Migration legt die Gruppenrollen `monteur_app` (API) und `monteur_worker` (Hintergrunddienst) an. Logins (in Azure: Managed Identities mit Entra-Authentifizierung) werden Mitglied einer dieser Rollen. Row-Level Security erkennt den Worker über die Rollenmitgliedschaft, nicht über eine Sitzungsvariable. Die API-Rolle darf Stempelereignisse, Audit-Log, Freigaben und Revisionen nicht ändern oder löschen.
**Begründung:** Eine Sitzungsvariable wie „ich bin der Worker“ könnte bei einer Sicherheitslücke in der API gesetzt werden; eine Datenbankrolle nicht. `BYPASSRLS` steht in Azure Flexible Server nicht zur Verfügung.
**Folge:** In der Entwicklung darf die API **nicht** als Superuser `postgres` verbinden, sonst greift RLS nicht (siehe README).

### E-29 Unbekannte Entra-Benutzer werden ohne Rechte angelegt

**Entscheidung:** Meldet sich ein Benutzer mit gültiger App-Rolle erstmals an, wird er angelegt, sieht aber nichts, bis ein Admin Standort und BC-Ressource zuordnet. Ein Standortrecht zählt nur, wenn zusätzlich die passende Entra-App-Rolle im Token steht.
**Begründung:** Admins sehen neue Kollegen direkt in der Benutzerliste; zwei unabhängige Stellen (Entra und App-Administration) müssen zustimmen.

### E-30 Service Worker cacht keine API-Daten

**Entscheidung:** Der Service Worker speichert nur die App-Oberfläche. Offline-Daten liegen ausschließlich in IndexedDB und werden über die Outbox geschrieben.
**Begründung:** Keine veralteten oder fremden personenbezogenen Daten aus einem HTTP-Cache. Beim Abmelden wird der lokale Bestand gezielt gelöscht.

### E-31 Logo auf weißer Fläche im Dunkelmodus

**Entscheidung:** Das Logo steht immer auf einer kleinen weißen Fläche.
**Begründung:** Die Reinzeichnung enthält schwarzen Text, der auf dunklem Grund nicht lesbar wäre. Liefert Marketing eine Negativversion, wird diese im Dunkelmodus verwendet.

### E-32 Sync-Auslöser ohne Background Sync API

**Entscheidung:** Synchronisiert wird nach jeder Eingabe (0,5 s verzögert), beim `online`-Event, wenn die App in den Vordergrund kommt, und jede Minute.
**Begründung:** Safari/iOS unterstützt die Background Sync API nicht, und der Service Worker hat keinen Zugriff auf das MSAL-Token. Ein zweiter Weg nur für Android brächte doppelte Logik ohne echten Gewinn: Monteure öffnen die App ohnehin regelmäßig. Die Outbox bleibt bis zur Übertragung erhalten.

### E-33 Lückenloser Delta-Pull über Transaktions-IDs

**Entscheidung:** Jede Zeile speichert per Trigger `pg_current_xact_id()`. Der Pull läuft in einer REPEATABLE-READ-Transaktion, liefert `tx_id >= cursor` und gibt den Snapshot-Horizont (`pg_snapshot_xmin`) als neuen Cursor zurück.
**Begründung:** Ein reiner Sequenzzähler verliert Änderungen, wenn eine Transaktion mit kleinerer Nummer erst nach dem Pull committet. Der Test `pull › does not skip a change committed after the pull started` belegt das Verhalten. Doppelt gelieferte Zeilen sind harmlos, weil der Client per Upsert speichert.

### E-34 Auftragsdetail über Query-Parameter

**Entscheidung:** `/monteur/auftrag?id=…` statt `/monteur/auftrag/[id]`. Alle Monteur-Seiten werden vom Service Worker vorab gespeichert; der Parameter `id` wird beim Cache-Abgleich ignoriert.
**Begründung:** Dynamische Routen wären offline nur erreichbar, wenn genau dieser Auftrag vorher online geöffnet wurde. So öffnet jeder synchronisierte Auftrag auch im Funkloch.

### E-35 Stempelregeln

**Entscheidung:** Auftragsstart ohne „Kommen“ eröffnet die Anwesenheit implizit zur selben Zeit (Hinweis in der App). „Pause“ unterbricht einen laufenden Auftrag, „Pause beenden“ setzt ihn als neues Segment fort. „Gehen“ beendet alles. Doppelte oder sinnlose Ereignisse werden ignoriert, nie abgelehnt.
**Begründung:** Zwei Taps maximal bis zur Kernaktion, keine Datenverluste durch Bedienfehler offline.

### E-36 Zeitbuchungen werden bei jedem Stempel neu abgeleitet

**Entscheidung:** Der Server berechnet nach jedem Stempelereignis die Zeitbuchungen des Tages und des Vortags neu (deterministische Schlüssel, Upsert). Offene, abgeleitete Buchungen darf nur ihr Eigentümer löschen (restriktive RLS-Richtlinie). Sind Buchungen eines Tages bereits eingereicht oder freigegeben, wird nichts automatisch geändert; der Monteur erhält einen Hinweis (Freigabe-Workflow: Phase 3).
