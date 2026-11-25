# Entscheidungen

Format: kurze Architecture Decision Records. Status: **entschieden** (von mir getroffen, änderbar mit Begründung), **vorgegeben** (aus dem Auftrag, nicht neu verhandeln), **vorläufig** (Annahme bis zur Klärung in OFFENE-PUNKTE.md).

| Nr.  | Thema                                                                      | Status      |
| ---- | -------------------------------------------------------------------------- | ----------- |
| E-01 | Monorepo mit pnpm + Turborepo, zusätzlicher Ordner `/packages`             | entschieden |
| E-02 | Backend: NestJS (API + Worker aus einer Codebasis)                         | entschieden |
| E-03 | ORM: Drizzle statt Prisma                                                  | entschieden |
| E-04 | Hosting: Azure Container Apps                                              | vorläufig   |
| E-05 | PWA-Tooling: Serwist (Workbox-basiert)                                     | entschieden |
| E-06 | Sync über idempotente Kommandos + Cursor-Pull                              | entschieden |
| E-07 | Stempelereignisse append-only, Zeiten abgeleitet                           | entschieden |
| E-08 | Rechte doppelt: Service-Scope + PostgreSQL RLS                             | entschieden |
| E-09 | BC-Transfer-Queue in PostgreSQL statt Service Bus                          | entschieden |
| E-10 | Echtzeit: Azure Web PubSub                                                 | entschieden |
| E-11 | Infrastruktur als Code: Bicep                                              | entschieden |
| E-12 | Zusätzliche Rolle „Lager“                                                  | vorläufig   |
| E-13 | Zuweisungen werden sofort nach BC geschrieben                              | entschieden |
| E-14 | BC-Status wird nur bei Meister-Freigabe geschrieben                        | entschieden |
| E-15 | Rundung auf Tagessumme je Auftrag und Tätigkeit                            | vorläufig   |
| E-16 | Bestand = BC-Bestand − noch nicht in BC gebuchte App-Entnahmen             | entschieden |
| E-17 | Diesel intern als ungebuchte Artikel-Buch.-Blatt-Zeile                     | vorläufig   |
| E-18 | Barcode-Scan mit zxing-wasm                                                | entschieden |
| E-19 | Feature-Flags je Modul **und** Standort                                    | entschieden |
| E-20 | Fremde Datensätze → 404 statt 403                                          | entschieden |
| E-21 | Plantafel mit dnd-kit                                                      | entschieden |
| E-22 | Feiertage nach Bundesland des Standorts                                    | entschieden |
| E-23 | Auftragsart-Mapping versioniert (`valid_from`)                             | entschieden |
| E-24 | ~~Abwesenheit nach BC: eine Zeile je Kalendertag~~ → E-51                  | ersetzt     |
| E-25 | Mock-Server mit Fastify, gemeinsame Contract-Schemas                       | entschieden |
| E-26 | NestJS 11 statt 12                                                         | entschieden |
| E-27 | PWA-Build mit Webpack statt Turbopack                                      | entschieden |
| E-28 | Eigene Datenbankrollen für API und Worker                                  | entschieden |
| E-29 | Unbekannte Entra-Benutzer werden ohne Rechte angelegt                      | entschieden |
| E-30 | Service Worker cacht keine API-Daten                                       | entschieden |
| E-31 | Logo auf weißer Fläche im Dunkelmodus                                      | entschieden |
| E-32 | Sync-Auslöser: Fokus, Online-Event, Intervall – keine Background Sync API  | entschieden |
| E-33 | Lückenloser Delta-Pull über Transaktions-IDs (xid8)                        | entschieden |
| E-34 | Auftragsdetail über Query-Parameter, App-Seiten vorab gecacht              | entschieden |
| E-35 | Stempelregeln: implizites Kommen, Pause unterbricht und setzt fort         | entschieden |
| E-36 | Zeitbuchungen werden bei jedem Stempel neu abgeleitet                      | entschieden |
| E-37 | Korrekturen als stornierte + neue Stempelereignisse                        | entschieden |
| E-38 | Zeitfreigabe je Monteur und Tag, eine BC-Zeile je Auftrag × Tätigkeit      | entschieden |
| E-39 | Fehlgeschlagene Übertragung blockiert ihre Gruppe                          | entschieden |
| E-40 | Plantafel: Ablegen an der Zeigerposition, Tastatur- und Dialog-Alternative | entschieden |
| E-41 | Eigene Feiertagsberechnung statt Bibliothek `date-holidays`                | entschieden |
| E-42 | Eine BC-Zeile je Entnahme; reservierter Bestand wird inkrementell geführt  | entschieden |
| E-43 | Bestandskonflikte werden angenommen und gemeldet, nie abgelehnt            | entschieden |
| E-44 | Barcode-Leser lokal ausgeliefert und vorab gecacht                         | entschieden |
| E-45 | Statusnachrichten im Chat per Datenbank-Trigger                            | entschieden |
| E-46 | Lokaler Speicher emuliert das Azure-Blob-Blockprotokoll                    | entschieden |
| E-47 | Offline-Navigation über volle Seitenaufrufe                                | entschieden |
| E-48 | AGCO-Absprung ohne Suchparameter (Zwischenablage)                          | entschieden |
| E-49 | Team-Kalender über Spiegeltabelle ohne Art und Kommentar                   | entschieden |
| E-50 | BC erst nach Meister-Entscheidung – auch bei Krankmeldungen                | entschieden |
| E-51 | Abwesenheiten in BC: löschen und neu schreiben                             | entschieden |
| E-52 | Offene Krankmeldungen zählen bei Überschneidungen bis heute                | entschieden |
| E-53 | Genehmigter Urlaub sperrt die Plantafel, Krankheit markiert                | entschieden |
| E-54 | Produktivitäts-Snapshot bis zum 10. des Folgemonats, dann fest             | entschieden |
| E-55 | Produktivität nur aus freigegebenen Tagen; Fahrzeit zählt mit              | entschieden |
| E-56 | Mapping-Änderungen nur ab dem laufenden Monat                              | entschieden |
| E-57 | Eine Managed Identity je Komponente, Datenbank per Entra-Token             | entschieden |
| E-58 | Service Worker speichert keine fremden Antworten; Abmeldung leert alles    | entschieden |
| E-59 | Feature-Flags vor der Transaktion lesen; Überlast als 503                  | entschieden |
| E-60 | Lasttest als eigener Lauf (`test:load`) mit frischer Datenbank             | entschieden |
| E-61 | „Aus BC aktualisieren“ als Auftrag an den Worker                           | entschieden |
| E-62 | Migrationen und Datenbank-Logins durch eigenen Job mit eigener Identität   | entschieden |
| E-63 | Stammdaten per RLS schreibgeschützt; Erstanmeldung ohne Session            | entschieden |
| E-64 | Neues Bedienkonzept: Seitenleiste links, aufrechte Überschriften, Symbole  | entschieden |
| E-65 | iPad als Hauptgerät: Tests mit WebKit, Plantafel per Finger                | entschieden |

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

### E-24 Abwesenheit: eine BC-Zeile je Kalendertag (ersetzt durch E-51)

**Stand Phase 6:** Umgesetzt ist ein BC-Eintrag je Abwesenheit (Zeitraum, Menge = Arbeitstage). Änderungen löschen und schreiben neu (E-51). Die ursprüngliche Überlegung:

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

### E-37 Korrekturen als stornierte und neue Stempelereignisse

**Entscheidung:** Der Meister ändert keine Zeiten direkt. Er storniert falsche Stempelereignisse (`stamp_event_void`) und fügt richtige hinzu (`created_by`, `correction_reason`). Die Zeitbuchungen werden daraus neu berechnet. Ein Korrekturantrag des Monteurs (vergessenes Ausstempeln) wird nach Annahme genauso umgesetzt.
**Begründung:** Rohdaten bleiben unverändert und nachvollziehbar (E-07). Das Audit-Log enthält Tageszusammenfassung vorher/nachher und die Pflichtbegründung. Die Datenbank erlaubt Korrekturereignisse nur dem Meister des Standorts, nie dem Monteur selbst (RLS, Test belegt).

### E-38 Zeitfreigabe je Monteur und Tag

**Entscheidung:** Freigegeben wird ein abgeschlossener Arbeitstag eines Monteurs. Je Auftrag × Tätigkeit entsteht eine BC-Servicezeile (Typ Ressource) mit den gerundeten Stunden und dem Arbeitstyp (`ARBEIT`/`FAHRT`/`DIAGNOSE`). Gemeinkosten gehen ins Ressourcen-Buch.-Blatt. Das Ziel für Auftragszeiten ist per Einstellung `timeTarget` auf das Buch.-Blatt umstellbar (OP-16). Tage mit laufender Buchung oder fehlendem Ausstempeln sind nicht freigebbar.
**Begründung:** Der Tag ist die Einheit, in der Arbeitszeitgesetz-Warnungen, Pausen und vergessenes Ausstempeln geprüft werden. Eine Zeile je Auftrag und Tätigkeit hält den BC-Auftrag übersichtlich.

### E-39 Fehlgeschlagene Übertragung blockiert ihre Gruppe

**Entscheidung:** Übertragungen derselben Gruppe (ein Serviceauftrag, eine Einplanung) laufen strikt nacheinander. Schlägt eine fachlich fehl (z. B. Auftrag in BC bereits erledigt), warten die folgenden, bis der Admin erneut sendet oder „als erledigt“ markiert (beides im Audit-Log).
**Begründung:** Sonst könnte z. B. „Status erledigt“ vor den Zeitzeilen in BC ankommen oder ein Verschieben vor dem Anlegen.

### E-40 Plantafel-Bedienung

**Entscheidung:** Abgelegt wird in der Zelle unter dem Finger/Mauszeiger (`pointerWithin`). Zusätzlich gibt es Tastatur-Drag & Drop mit deutschen Screenreader-Ansagen und für jeden Auftrag den Dialog „Einplanen ohne Ziehen …“.
**Begründung:** Die Standard-Erkennung nach größter Überlappung legte die breite Auftragskarte im Test eine Stunde zu früh ab. Barrierefreiheit verlangt eine Alternative zum Ziehen.

### E-41 Eigene Feiertagsberechnung

**Entscheidung:** Gesetzliche Feiertage je Bundesland (inkl. Ostern-abhängiger Tage und Buß- und Bettag in Sachsen) werden in `packages/shared/material/holidays.ts` berechnet; E-22 ist damit umgesetzt, aber ohne die Bibliothek `date-holidays`.
**Begründung:** Die Lieferzeit-Anzeige („Bestellschluss 17:00 → Lieferung morgen“) muss offline auf dem Gerät identisch zum Server rechnen. `date-holidays` enthält Daten aller Länder und wäre für den Browser unverhältnismäßig groß. Nur teilweise geltende Feiertage (z. B. Mariä Himmelfahrt in Teilen Bayerns) sind nicht enthalten.

### E-42 Eine BC-Zeile je Entnahme, inkrementeller reservierter Bestand

**Entscheidung:** Jede freigegebene Entnahme wird eine eigene BC-Servicezeile (bzw. Artikel-Buch.-Blatt-Zeile). `item_stock.pending_withdrawal` wird bei Entnahme, Storno, Ablehnung und gebuchter Menge in BC unter Zeilensperre erhöht bzw. verringert.
**Begründung:** Die gebuchte Menge aus BC (`quantityConsumed/Shipped`) lässt sich so eindeutig der Entnahme zuordnen und aus dem reservierten Bestand herausrechnen (E-16) – der angezeigte Bestand bleibt vor und nach dem Buchen in BC gleich (Test belegt). Eine Summe über alle Entnahmen wäre für den Monteur wegen RLS nicht berechenbar, da er fremde Entnahmen nicht sehen darf.

### E-43 Bestandskonflikte werden gemeldet, nicht abgelehnt

**Entscheidung:** Entnimmt jemand mehr als verfügbar (z. B. zwei Monteure offline aus demselben Fass), wird die Entnahme angenommen, als Bestandskonflikt markiert und Meister sowie Lager werden benachrichtigt. Mindestbestand: einmalige Meldung beim Unterschreiten.
**Begründung:** Das Material ist real verbraucht; eine Ablehnung würde nur die Dokumentation verfälschen (ARCHITEKTUR 4.3).

### E-44 Barcode-Leser lokal

**Entscheidung:** Die WebAssembly-Datei von zxing-wasm wird beim Build nach `public/zxing/` kopiert und vom Service Worker vorab gespeichert; der Standard (Laden vom CDN jsDelivr) ist abgeschaltet.
**Begründung:** Scannen muss im Funkloch funktionieren, und es soll keine Anfrage an fremde Server gehen.

### E-45 Statusnachrichten im Chat per Datenbank-Trigger

**Entscheidung:** Jede Statusänderung eines Auftrags erzeugt per Trigger auf `order_status_event` eine Systemnachricht im Auftragschat („Status: Fertig – Doku offen“).
**Begründung:** Statusänderungen kommen aus mehreren Wegen (Offline-Befehl, Meister, BC-Sync). Der Trigger garantiert, dass keiner davon vergessen wird, und die Nachricht entsteht in derselben Transaktion.

### E-46 Lokaler Speicher emuliert das Azure-Blob-Blockprotokoll

**Entscheidung:** Fotos werden direkt vom Gerät in den Speicher hochgeladen (zeitlich begrenzte SAS-URL), in 1-MB-Blöcken mit Abschluss über eine Blockliste. Für Entwicklung und Tests bildet `LocalBlobStorage` genau dieses Protokoll in der API nach.
**Begründung:** Abgebrochene Uploads im Funkloch werden fortgesetzt statt neu begonnen; derselbe Client-Code läuft lokal, in E2E und in Azure. Produktion verweigert den lokalen Speicher.

### E-47 Offline-Navigation über volle Seitenaufrufe

**Entscheidung:** Ohne Verbindung wandelt `OfflineNavigation` Link-Klicks und `navigate()` in normale Seitenaufrufe um, die der Service Worker aus dem Vorab-Cache bedient (Abfrageparameter `id`/`orderId` werden beim Cache-Abgleich ignoriert).
**Begründung:** Die Client-Navigation von Next lädt Seitendaten vom Server und bleibt offline hängen. Volle Aufrufe sind offline zuverlässig; die Daten kommen ohnehin aus IndexedDB.

### E-48 AGCO-Absprung ohne Suchparameter

**Entscheidung:** Solange das Suchformat von `parts.agcocorp.com` nicht bekannt ist, öffnet die App die Katalog-Startseite und legt Teile- bzw. Seriennummer in die Zwischenablage.
**Begründung:** Kein Raten von URL-Formaten, kein Auslesen fremder Seiten; sobald das Format geklärt ist, genügt eine Einstellung mit `{query}` (OP-24).

### E-49 Team-Kalender über Spiegeltabelle statt Sicht mit erhöhten Rechten

**Entscheidung:** Kollegen lesen Abwesenheiten aus `team_absence` (nur Person, Zeitraum, halber Tag), die ein Trigger auf `absence` pflegt. Die Tabelle `absence` selbst bleibt für Monteure auf eigene Zeilen beschränkt.
**Begründung:** Eine `SECURITY DEFINER`-Funktion oder Sicht würde RLS umgehen und hängt davon ab, wem sie gehört. Mit der Spiegeltabelle erzwingt die Datenbank, dass Art und Kommentar einer Krankmeldung nie bei Kollegen ankommen (PROMPT 5.10, 9).

### E-50 BC nur nach Meister-Entscheidung – auch bei Krankmeldungen

**Entscheidung:** Eine Krankmeldung des Monteurs geht erst nach „Zur Kenntnis genommen“ durch den Meister nach BC, und erst sobald ihr Ende feststeht. Ändert der Monteur das Ende, landet sie erneut in der Inbox. Erfasst Meister oder Personal die Krankmeldung, gilt sie als bestätigt.
**Begründung:** Grundsatz „Schreiben nur nach Freigabe“ (PROMPT 2). Zugleich darf die Sitzung eines Monteurs per RLS keine BC-Übertragungen anlegen.

### E-51 Änderungen an Abwesenheiten in BC: löschen und neu schreiben

**Entscheidung:** Jede Änderung (Ende verschoben, Urlaub storniert) löscht die bisher geschriebenen BC-Einträge und schreibt bei Bedarf einen neuen. Der BC-Mitarbeiter wird erst beim Senden aus der Benutzerzuordnung gelesen; fehlt sie, schlägt die Übertragung mit klarer Meldung fehl und kann nach dem Pflegen erneut gesendet werden.
**Begründung:** Mitarbeiterabwesenheiten sind in BC keine gebuchten Posten und dürfen gelöscht werden; ein PATCH bräuchte Schreibrechte auf mehr Felder. Löschen und Neuschreiben laufen in derselben Gruppe streng nacheinander, Duplikate sind ausgeschlossen (Test).

### E-52 Offene Krankmeldungen zählen bei Überschneidungen nur bis heute

**Entscheidung:** Für die Prüfung auf Überschneidungen gilt eine Krankmeldung ohne Ende als „bis heute“. Auf der Plantafel und im Team-Kalender gilt sie dagegen bis auf Weiteres.
**Begründung:** Sonst wäre jeder spätere Urlaubsantrag blockiert; für die Planung ist die vorsichtige Annahme richtig.

### E-53 Genehmigter Urlaub sperrt die Plantafel, Krankheit markiert nur

**Entscheidung:** Einplanen auf einen genehmigten Urlaubstag wird abgelehnt (409). Krankmeldungen und beantragter Urlaub erzeugen nur einen Hinweis; betroffene Aufträge erscheinen unter „Neu einplanen“, berechnet aus den aktiven Abwesenheiten statt gespeichert.
**Begründung:** PROMPT 5.9/5.10. Die Berechnung bleibt richtig, wenn das Ende einer Krankmeldung geändert oder der Auftrag umgeplant wird, und braucht keine Schreibrechte des Monteurs auf Einplanungen.

### E-54 Produktivitäts-Snapshot bis zum 10. des Folgemonats, dann fest

**Entscheidung:** Der Worker berechnet den Vormonat täglich bis zum 10. des Folgemonats neu und speichert ihn als `productivity_snapshot` (mit Mapping-Version und Konfigurations-Hash). Danach bleibt der Wert fest; die API liefert abgeschlossene Monate aus dem Snapshot. Nur der Worker darf Snapshots schreiben (RLS, getestet).
**Begründung:** Späte Freigaben und Korrekturen fließen noch ein; danach ist der Monatswert reproduzierbar – Grundlage für ein späteres Bonussystem (PROMPT 5.11). Die Frist ist ein Vorschlag (OP-35).

### E-55 Produktivität nur aus freigegebenen Tagen; Fahrzeit zählt als verrechnet

**Entscheidung:** Zähler und Nenner berücksichtigen nur Tage, die der Meister vollständig freigegeben hat; offene Tage werden als Hinweis angezeigt. Fahrzeit auf produktiven Aufträgen zählt als verrechnete Zeit (sie wird in BC als Arbeitstyp `FAHRT` abgerechnet); der Fahrzeitanteil wird zusätzlich ausgewiesen (Fahrzeit ÷ Anwesenheit). Standortsummen werden aus den Minutensummen berechnet, nicht als Mittelwert der Quoten.
**Begründung:** Gleiche Basis für Zähler und Nenner; Mittelwerte von Quoten verzerren bei unterschiedlicher Anwesenheit. Ob Fahrzeit produktiv zählen soll: OP-34.

### E-56 Mapping-Änderungen nur ab dem laufenden Monat

**Entscheidung:** Der Admin legt neue Versionen der Auftragsart-Zuordnung an (`valid_from`); ein Datum in einem abgeschlossenen Monat wird abgelehnt. Jede Änderung steht im Audit-Log. Der Admin sieht keine Produktivitätswerte einzelner Monteure.
**Begründung:** E-23 (reproduzierbare Monatswerte) und Datenschutz (Rollenkonzept, PROMPT 4).

### E-57 Eine Managed Identity je Komponente, Datenbank per Entra-Token

**Entscheidung:** API, Worker und Web-App haben je eine eigene Identität. Die API-Identität ist in PostgreSQL nur Mitglied von `monteur_app`, die des Workers von `monteur_worker`; die Web-App darf nur Images ziehen. API und Worker melden sich mit einem Entra-Token an (kein Passwort) und prüfen beim Start ihre Rolle – in Azure brechen sie ab, wenn RLS umgangen würde.
**Begründung:** Sicherheitsbefund H1: Mit einer gemeinsamen Identität wäre die Rollentrennung der RLS hinfällig, und ein Fehler in der Web-App hätte Zugriff auf alle Geheimnisse.

### E-58 Service Worker speichert keine fremden Antworten; Abmeldung leert alles

**Entscheidung:** Antworten anderer Herkunft (API, Fotos) werden nie zwischengespeichert; die API sendet `no-store`. Die Abmeldung löscht IndexedDB, Laufzeit-Caches und das Push-Abo.
**Begründung:** Sicherheitsbefund H2/M1: Auf geteilten Tablets hätte der nächste Benutzer offline Daten des vorherigen gesehen bzw. dessen Push-Nachrichten erhalten. Offline-Daten liegen ausschließlich in der IndexedDB des angemeldeten Benutzers (E-30).

### E-59 Feature-Flags vor der Transaktion lesen; Überlast als 503

**Entscheidung:** Der Sync liest alle Flags einmal vor der ersten Transaktion; der Flag-Cache lädt einmal für alle Wartenden; der Datenbank-Pool wartet höchstens 10 s auf eine Verbindung, danach antwortet die API mit 503 und `Retry-After`.
**Begründung:** Im Lasttest blockierte eine Flag-Abfrage in einer offenen Transaktion den Pool vollständig (alle Verbindungen warteten auf eine weitere). Eine klare 503 ist für die App wiederholbar, ein hängender Request nicht.

### E-60 Lasttest als eigener Lauf mit frischer Datenbank

**Entscheidung:** `pnpm --filter @schroeder/api test:load` läuft in der CI als eigener Schritt; Umfang per `LOAD_DEVICES`/`LOAD_COMMANDS` skalierbar.
**Begründung:** Der Lasttest legt viele Benutzer an und leert die BC-Warteschlange; im gemeinsamen Testlauf hätte er – je nach Reihenfolge – den Zustand anderer Tests verändert.

### E-61 „Aus BC aktualisieren“ als Auftrag an den Worker

**Entscheidung:** Ein Klick auf „Aus BC aktualisieren“ legt eine Anfrage an (`bc_refresh_request`, RLS: nur wer den Auftrag sieht); der Worker liest Auftrag, Serviceartikel und Zuordnungen innerhalb von ca. 10 s direkt aus BC – unabhängig vom Delta-Cursor.
**Begründung:** Nur der Worker hält die BC-Zugangsdaten (E-57); die API braucht keine. BC-Webhooks bleiben die spätere Ergänzung, wenn sie gegen die echte Sandbox getestet werden können (`SETUP-BC.md` Abschnitt 6).

### E-62 Migrationen und Datenbank-Logins durch eigenen Job mit eigener Identität

**Entscheidung:** Ein Container-Apps-Job (`-migrate`) mit eigener Identität – zweiter Entra-Administrator des PostgreSQL-Servers und Eigentümer des Schemas – führt vor jedem Ausrollen die Migrationen aus und legt die Logins von API und Worker mit genau ihrer Rolle an. Die Pipeline startet den Job über `infra/scripts/deploy.sh`; schlägt er fehl, wird nichts ausgerollt.
**Begründung:** OP-37; kein manueller DBA-Schritt je Deployment, keine Administratorrechte in API oder Worker, und eine falsche Rollenzuordnung wird bei jedem Deployment korrigiert.

### E-63 Stammdaten per RLS schreibgeschützt; Erstanmeldung ohne Session

**Entscheidung:** `user_location`, `app_user`, `bc_resource_mapping`, `setting` und `feature_flag` sind für alle lesbar, schreiben dürfen nur Admin und Worker. Die Erstanmeldung legt ohne Session nur Konten ohne Rollen an; der Benutzer aktualisiert danach nur seine eigene Rollen-Momentaufnahme, Status und Azubi-Kennzeichen schützt ein Trigger.
**Begründung:** Sicherheitsbefund L2: Diese Tabellen bestimmen, was RLS erlaubt – ein Schreibfehler in der API wäre sonst eine Rechteausweitung.

### E-64 Neues Bedienkonzept: Seitenleiste links, aufrechte Überschriften, Symbole

**Entscheidung:** Alle Bereiche liegen in einer dunklen Seitenleiste links (iPad quer: Symbol und Text; iPad hoch: schmale Symbolleiste mit Kurztext; Smartphone: Menü-Knopf). Wer mehrere Rollen hat, sieht die Bereiche nach Rollen gruppiert. Das Stempeln sitzt im Querformat unten in der Seitenleiste, sonst als Leiste am unteren Rand der Monteur-Seiten. Überschriften und Zahlen sind aufrecht und fett statt kursiv; alle Navigationspunkte und Hauptknöpfe haben Symbole (lucide). Die Monteur-Startseite zeigt nur noch „Heute fällig“, weitere offene Aufträge und Hinweise, die Aufmerksamkeit brauchen (Arbeitszeit, Wartet auf Teile, Doku offen) – statt neun Zählerkacheln.
**Begründung:** Rückmeldung des Auftraggebers vom 20.11.2026: Navigation zu kompliziert (Reiter unten plus Knopfreihe beim Meister, die im Hochformat abgeschnitten war), Design zu blass, zu viel auf einmal, Kursivschrift unpassend, Symbole fehlen. Das CD-Grün bleibt Akzent (aktiver Menüpunkt, Uhrzeit-Block der Auftragskarte, Hauptknöpfe), große grüne Flächen werden weiter vermieden; alle Farbpaare der Leiste sind im Kontrasttest (`packages/ui`).

### E-65 iPad als Hauptgerät: Tests mit WebKit, Plantafel per Finger

**Entscheidung:** Die E2E-Tests laufen in der CI je Gerät mit eigener Datenbank: iPad quer und iPad hoch mit WebKit (die Safari-Technik, die auf dem iPad jeder Browser nutzt) sowie das Smartphone mit Chromium. Die Pflichtprüfung `e2e` ist nur grün, wenn alle drei grün sind. Auf der Plantafel startet das Ziehen mit dem Finger nach kurzem Halten (200 ms), damit Wischen weiter blättert; im Hochformat liegen die nicht eingeplanten Aufträge als waagrechte Leiste über dem Raster.
**Begründung:** Die App wird überwiegend auf dem iPad bedient. Ein nachgestelltes iPad ersetzt den Pilottest auf echten Geräten nicht, fängt aber Darstellungs- und Safari-Fehler vorher ab. Einrichtung der Geräte: `docs/IPAD.md`.

### E-66 Kein Meister in der App: Planung in BC, Übergabe nach BC ohne Prüfung

**Entscheidung (Auftraggeber, 20.11.2026):** Der Meister arbeitet nicht in der App. Meister-Übersicht, Plantafel und Freigaben entfallen. Geplant wird im Werkstattplaner-Zusatzmodul in Business Central; die App liest die Zuordnungen (bis zur Anbindung des Moduls die Standard-Ressourcenzuordnungen, OP-43). Der Monteur sieht keine Workflow-Status mehr, nur „Arbeit abgeschlossen“. Stunden, Entnahmen und abgeschlossene Aufträge gehen **ohne Prüfung** nach BC: Ein Worker-Job (jede Minute) übernimmt Korrekturanträge, gibt abgeschlossene Arbeitstage (nichts läuft, keine offene Korrektur, letzte Buchung älter als die Karenzzeit `approval.graceMinutes`, Standard 30 Minuten) und Entnahmen frei und übergibt abgeschlossene Aufträge – mit denselben Regeln wie bisher (Rundung, Arbeitstypen, eine BC-Zeile je Entnahme). Handelnder ist der technische Benutzer „Automatik“. Urlaub und Krankmeldung entfallen in der App (Abwesenheiten laufen wie bisher außerhalb). `approval.mode = 'meister'` stellt die Freigabe-Logik wieder her (Oberfläche wäre neu zu bauen).
**Begründung:** Der Meister plant und prüft in BC; doppelte Pflege entfällt. Die Karenzzeit lässt dem Monteur Zeit, Fehler selbst zu korrigieren (Entnahme rückgängig, Stempelung korrigieren), bevor etwas in BC steht. Ersetzt die Vorgabe „Schreiben nach BC erst nach Meister-Freigabe“ (PROMPT) und E-09 in diesem Punkt.

### E-67 Servicechecklisten als Vorlage aus BC, Pflicht beim Abschluss

**Entscheidung:** Checklisten-Vorlagen (Punkte „i.O. / n.i.O. / entfällt“, Messwerte mit Einheit, Freitext; optional nach Abschnitten) pflegt der Admin als JSON nach der Vorlage aus BC (OP-44). Es gilt die genaueste passende Vorlage (Standort + Auftragsart + Marke vor Auftragsart vor allgemein); ohne passende Vorlage braucht ein Auftrag keine Checkliste. Pflichtpunkte müssen beantwortet sein, „n.i.O.“ braucht eine Bemerkung. Die Checkliste wird offline ausgefüllt und geht beim Abschluss als Kommentarzeilen (Typ „Allgemein“) und im PDF nach BC.
**Begründung:** Vorgabe des Auftraggebers; das genaue Layout liefert der Service (Bianca) – das JSON-Format nimmt es ohne Codeänderung auf.

### E-68 Kundenunterschrift; unterschriebener Werkstattauftrag als PDF-Anhang in BC

**Entscheidung:** Auf der Abschluss-Seite prüft der Monteur den Werkstattauftrag (Stunden je Tag und Tätigkeit, Teile, Bericht, Checkliste); der Kunde unterschreibt mit Finger oder Stift, mit Namen in Druckschrift. Kann der Kunde nicht unterschreiben, wird der Grund vermerkt. „Arbeit abgeschlossen“ ist erst mit Bericht, Checkliste und Unterschrift (oder Grund) möglich (`completion.signatureRequired`, Standard an). Bei der Übergabe erzeugt der Transfer-Worker den Werkstattauftrag als PDF (pdf-lib, mit Unterschrift) und legt ihn über die neue API-Seite `serviceOrderAttachments` (AL-Erweiterung, Standard-Dokumentanhang) am Serviceauftrag ab. Das Unterschriftsbild bleibt auf dem Server und im PDF; andere Geräte erhalten nur Name und Zeitpunkt.
**Begründung:** Nachweis der Leistung gegenüber dem Kunden ohne Papier; das PDF zeigt den Stand bei der Übergabe und ist in BC beim Auftrag abrufbar.

Ergänzung zu E-67 (21.11.2026): Die Checkliste bildet die BC-„Servicecheckliste (gelbe Karte)“ ab – Überschriften, Zeilen mit dem Häkchen „Eingabe“, Antwort als Text, Zahl oder Auswahl, Einheit fest oder wählbar, Pflichtzeilen, Abschnitte nur für bestimmte Auftragsarten. Hat der BC-Serviceauftrag eigene Checklistenzeilen (`serviceChecklistLines`), gelten diese; die Antworten werden beim Abschluss **in genau diese Zeilen zurückgeschrieben** (PATCH), nicht als Kommentar. Ohne BC-Zeilen gilt die App-Vorlage (die gelbe Karte ist als Vorlage hinterlegt). Einstellung `checklist.bcLines` schaltet das Lesen aus BC ab.

### E-69 Stempeluhr im Viertelstundentakt wie in BC

**Entscheidung (Service, 20.11.2026):** Jede Stempelung zählt auf der Viertelstunde – Kommen, Auftrag starten und Pausenende mit 5 Minuten Karenz (bis 07:35:59 → 07:30, ab 07:36:00 → 07:45), Gehen, Stopp und Pausenbeginn immer abgerundet (16:29:59 → 16:15). Gilt auch für die Zeiten am Auftrag. Bei einem direkten Wechsel zwischen Aufträgen zählt die Startzeit für beide Abschnitte, es entsteht keine Lücke. Gleiche Regel auf dem Gerät und auf dem Server; `rounding.stampClock = null` schaltet auf minutengenau zurück.
**Begründung:** So rechnet die Stempeluhr in BC heute; Monteure und Lohnbuchhaltung sehen dieselben Zeiten.

### E-70 Bemerkungen und Kontakte aus BC am Auftrag (nur lesen)

**Entscheidung:** Bemerkungen zum Debitor (Comment Line), zur Maschine (Serviceartikel-Bemerkungen) und zum Auftrag sowie die Kontaktpersonen des Debitors (Telefon, Mobil, E-Mail) kommen über drei neue API-Seiten aus BC und stehen offline am Auftrag – eingeklappt, damit die Seite kurz bleibt. Die Geräte erhalten nur Daten zu den Kunden ihrer aktuellen Aufträge.
**Begründung:** Rückmeldung Service; der Monteur sieht heute in BC dieselben Informationen. Datensparsamkeit durch Beschränkung auf eigene Aufträge.

### E-71 Artikelabfrage ohne Auftrag mit Ersatz- und Nachfolgeartikeln

**Entscheidung:** Eigener Menüpunkt „Artikel“: Suche nach Nummer, Bezeichnung, EAN oder Scan im Artikelstamm des Standorts (offline), online zusätzlich Bestand anderer Standorte und Ersatzartikel aus BC (Artikelersatz, Tabelle 5715): austauschbar = „Ersatzartikel“, einseitig = „Nachfolger“ bzw. „Vorgänger“.
**Begründung:** Rückmeldung Service. Ob „Nachfolgeartikel“ in BC anders gepflegt wird, klärt OP-47.

### E-72 Werkstatt-PC: Gerätekonto, Stempeln mit Personalnummer + PIN

**Entscheidung:** Der Stempel-PC eines Standorts ist dauerhaft mit einem gemeinsamen Gerätekonto angemeldet (App-Rolle `Werkstatt.Terminal`, Standortzuordnung „Werkstatt-PC“). Gestempelt wird mit Personalnummer (BC-Mitarbeiter- oder Ressourcennummer) und 4-stelliger PIN, danach ein Tipp: Kommen, Pause, Auftrag starten/beenden, Gehen. Die Stempelung läuft als der Mitarbeiter über denselben Weg wie auf dem iPad (Viertelstunden, Protokoll). Falsche PIN und unbekannte Nummer ergeben dieselbe Meldung; nach 5 Fehlversuchen ist die PIN 15 Minuten gesperrt. Die PIN legt jeder Mitarbeiter im Benutzermenü selbst fest oder der Admin setzt sie; gespeichert wird nur ein scrypt-Hash. Mitarbeiter ohne eigenes Gerät zählen am PC als Monteur ihres Standorts. Am PC steht außerdem die Artikelabfrage zur Verfügung. Bericht, Checkliste, Material und Fotos am PC folgen in einem zweiten Schritt (OP-49).
**Begründung:** Nicht jeder Werkstattmitarbeiter hat ein iPad; eine volle Anmeldung am PC würde morgens Wartezeit verursachen (Rückmeldung Service). Die PIN entspricht dem heutigen Vorgehen in BC.

### E-73 Fotos als Dokument am Maschinenobjekt in M-Files

**Entscheidung:** Der Worker überträgt jedes hochgeladene Foto über die M-Files-REST-Schnittstelle: Datei hochladen, dann ein Dokument der konfigurierten Klasse mit Verweis auf das Maschinenobjekt (gefunden über die BC-Serviceartikelnummer) und der Auftragsnummer anlegen. Bestehende Objekte werden weder ausgecheckt noch geändert. Fehler (z. B. Maschine in M-Files unbekannt) stehen am Foto und werden bis zu 10-mal wiederholt; auf dem Gerät erscheint „in M-Files“. Tresor, Klasse und Eigenschafts-IDs sind Konfiguration (OP-48); ohne Konfiguration bleiben die Fotos im App-Speicher.
**Begründung:** Heute hängen die Fotos am Maschinenobjekt in M-Files und werden in BC in der M-Files-Ansicht angesehen – der Ablageort bleibt gleich.

### E-74 AGCO-Katalog in der Teile-Seite (Versuch, abschaltbar)

**Entscheidung:** Auf der Teile-Seite zeigt „Katalog hier anzeigen“ die AGCO-Katalogseite groß im Inhaltsbereich (Seitenleiste und Kopfzeile bleiben sichtbar, Suche und Warenkorb werden solange ausgeblendet); oben eine schmale Leiste zum Hineinziehen/Einfügen und „Zurück“, übernommene Teile erscheinen in einem Bereich unter dem Katalog – ohne Fensterwechsel und ohne Split View. Teilenummern werden aus dem Rahmen in den Bereich „Herstellerkatalog“ gezogen oder über „Teilenummer aus Zwischenablage“ übernommen. Die App liest nichts aus dem Katalog (fremde Seite, getrennt vom App-Inhalt). Abschaltbar mit `partsCatalogs.agcoEmbed = false`; die Content-Security-Policy erlaubt Rahmen nur für die AGCO-Hosts.
**Begründung:** Split View ist auf iPadOS 26 umständlich (Fenster-Apps). Ob AGCO die Anzeige in fremden Seiten zulässt (X-Frame-Options/CSP) und ob die AGCO-Anmeldung im Rahmen funktioniert (Safari blockiert Drittanbieter-Cookies), lässt sich nur mit dem echten Katalog auf dem iPad prüfen. Klappt es nicht, bleibt „AGCO-Katalog öffnen“ im neuen Fenster.

### E-75 Servicecheckliste während der Arbeit, Zurück-Knopf auf allen Auftragsseiten

**Entscheidung:** Die Servicecheckliste hat eine eigene Seite (`/monteur/checkliste`), erreichbar über die Kachel „Servicecheckliste“ am Auftrag (Stand: noch nicht ausgefüllt / n offen / vollständig). „Arbeit abschließen“ prüft sie nur noch und verweist bei offenen Punkten auf diese Seite. Alle Unterseiten eines Auftrags (Bericht, Checkliste, Teile, Öl & Diesel, Chat, Abschluss) haben oben „Zurück zum Auftrag“ bzw. ohne Auftrag „Zurück zur Übersicht“.
**Begründung:** Die Checkliste gehört zur Arbeitszeit und wird während der Arbeit ausgefüllt, nicht erst beim Abschluss (Rückmeldung Auftraggeber). Als installierte App auf dem iPad gibt es keinen Browser-Zurück-Knopf.

### E-76 „Warenkorb übertragen“: Warenkorb des Herstellershops per KI aus einem Bild lesen

**Entscheidung:** Auf der Teile-Seite (auch über dem eingebetteten Katalog) gibt es den Knopf „Warenkorb übertragen“ (Symbol: zaubernder Traktor). Am Laptop/Werkstatt-PC nimmt die App einmalig ein Bild des eigenen Browser-Tabs auf (der Browser fragt nach der Freigabe); am iPad wählt der Monteur ein vorher gemachtes Bildschirmfoto. Der Server schickt das Bild an ein KI-Modell (Anthropic Claude; nur Zeilen im Warenkorb-Bereich zählen, empfohlene/zuletzt angesehene Artikel werden verworfen, Einstellung `CART_AI=claude`, Modell `CART_AI_MODEL`), das Teilenummern und Mengen als strukturierte Liste zurückgibt; jede Zeile wird gegen den BC-Artikelstamm geprüft. „Alle in den Warenkorb“ legt die erkannten Teile mit Menge in den Auftrags-Warenkorb (Hauptlager bevorzugt, sonst Lagerort mit genug Bestand). Es wird nichts bestellt, das Bild wird nicht gespeichert. Freischaltung je Standort über das Feature `parts.cartAi` (in Produktion standardmäßig aus).
**Begründung:** Der Browser lässt die App die fremde Shop-Seite nicht auslesen; Markieren/Kopieren ist den Monteuren zu umständlich (Rückmeldung Auftraggeber). Ein Bild ist der einzige Weg ohne Mitwirkung von AGCO.
**Offen:** KI-Anbieter und Datenverarbeitung (OP-50).

### E-77 Lesezeichen „Warenkorb kopieren“: ganzer Warenkorb ohne Bildschirmfoto

**Entscheidung:** Ein Browser-Lesezeichen (Bookmarklet) läuft auf der Warenkorbseite des Herstellershops, liest alle Positionen mit Menge – auch unterhalb des sichtbaren Ausschnitts – und legt sie in einem eigenen Format (`WERKSTATT-APP-WARENKORB v1`, „Teilenummer TAB Menge“) in die Zwischenablage. „Warenkorb übertragen“ in der App liest zuerst die Zwischenablage; nur wenn dort kein Warenkorb liegt und die KI freigeschaltet ist, folgt das Bild (E-76). Als Warenkorbzeile zählt ein Element mit „Teilenr.“, dessen eigene Zeile (ohne weitere Teilenummer) eine Menge hat (Eingabefeld oder „n X … € pro Stück“); Empfehlungen ohne Mengenfeld fallen heraus. Einrichtung einmalig über „Lesezeichen ‚Warenkorb kopieren‘ einrichten“ auf der Teile-Seite (Laptop: in die Lesezeichenleiste ziehen; iPad: Code kopieren oder per MDM verteilen). Das Lesezeichen funktioniert nur, wenn der AGCO-Shop als eigener Tab offen ist (nicht im eingebetteten Katalog).
**Begründung:** Ein Bildschirmfoto zeigt nur den sichtbaren Ausschnitt (Rückmeldung Auftraggeber). Das Lesezeichen ist der einzige Weg ohne AGCO, die Seite vollständig zu lesen, weil es auf der Shop-Seite selbst läuft. Seitenaufbau von AGCO kann sich ändern → bei Abweichungen Lesezeichen anpassen (`packages/shared/src/material/shop-cart.ts`).

### E-78 Lesezeichen „→ Werkstatt-App“: Warenkorb mit einem Tipp übergeben (ersetzt E-77)

**Entscheidung:** Jeder Monteur erzeugt auf der Teile-Seite einmalig sein persönliches Lesezeichen. Im AGCO-Warenkorb tippt er darauf; es nimmt den Text der ganzen Seite (auch unterhalb des sichtbaren Ausschnitts) und öffnet damit die App-Seite `/warenkorb-senden` (Daten und Schlüssel nur im URL-Fragment, danach aus dem Verlauf entfernt). Diese Seite gibt den Text an die API (`POST /v1/parts/shop-cart`, ohne Anmeldung, der persönliche Schlüssel – gespeichert nur als SHA-256-Hash – bestimmt den Monteur). Die API erkennt die Warenkorbzeilen (Teilenummer + „n X … € pro Stück“; Empfehlungen ohne Menge fallen heraus) und legt sie in den „Briefkasten“ des Monteurs. Die Teile-Seite holt den Briefkasten selbst ab (beim Zurückwechseln und alle 5 Sekunden): der Traktor fliegt, die Positionen stehen mit Menge da. Kein Kopieren, kein Bildschirmfoto, kein Knopf in der App; funktioniert auch geräteübergreifend (AGCO am PC, App am iPad). Ein neues Lesezeichen macht das alte ungültig; abgeholte Warenkörbe werden gelöscht, nicht abgeholte nach einem Tag.
**Begründung:** Rückmeldung Auftraggeber: Lesezeichen tippen + zurück in die App + Knopf war zu umständlich. Die Übergabe als Seitenaufruf statt als Anfrage aus der Shop-Seite kann von deren Sicherheitsregeln nicht blockiert werden.
**Grenze:** Das Lesezeichen läuft nur, wenn der AGCO-Shop als eigener Tab offen ist, nicht im eingebetteten Katalog.

### E-79 Servicecheckliste freiwillig

**Entscheidung:** Die Servicecheckliste blockiert „Arbeit abgeschlossen“ nicht mehr – weder in der App noch auf dem Server (Vollständigkeit = Arbeitsbericht mit Pflichtfeldern + Unterschrift bzw. Grund). Sie bleibt über die Kachel „Servicecheckliste“ (Stand: freiwillig / n offen / vollständig) und auf der Abschlussseite erreichbar; was ausgefüllt ist, geht wie bisher nach BC und in den Werkstattauftrag (PDF).
**Begründung:** Vorgabe des Auftraggebers: die Checkliste muss nicht zwingend ausgefüllt werden.

### E-80 Herstellerkataloge mit Warenkorb-Rückgabe (OCI) wie im Schröder-Teileshop (ersetzt E-77/E-78)

**Entscheidung:** Die Teile-Seite zeigt je Herstellerkatalog eine Kachel (zunächst AGCO und Grimme, Spezifikation „Katalog-Anbindung AGCO & Grimme“). Ein Tipp öffnet den Händlerkatalog – AGCO-Partsbook (`eme.apb.agcocorp.com`) groß in der Seite, Grimme (agroparts/LexCom) als eigenes Fenster – mit einer Rücksprung-Adresse (OCI `HOOK_URL`) für diesen Monteur und Auftrag (`POST /v1/parts/catalog-sessions`, Geheimnis nur als SHA-256-Hash, 8 Stunden gültig). „Warenkorb übergeben“ im Katalog schickt den Warenkorb als OCI-Formular (`NEW_ITEM-VENDORMAT/MATNR`, `NEW_ITEM-QUANTITY`, `NEW_ITEM-DESCRIPTION`) an `POST|GET /v1/parts/catalog-return/:token` (ohne Anmeldung). Die Antwortseite meldet es der App (`postMessage`) und schließt sich; die App holt den Warenkorb des Auftrags ab (sofort bzw. beim Zurückwechseln/alle 5 Sekunden), der Traktor fliegt, die Positionen stehen mit Menge da („Alle in den Warenkorb“). Katalogliste und Adressen kommen aus der Einstellung `partsCatalogs.catalogs` (je Standort) bzw. `PARTS_CATALOGS`; `{HOOK_URL}` in der Adresse schaltet die Rückgabe ein. Ohne eingerichteten Händlerzugang öffnen die Kacheln nur die Startseiten (keine Rückgabe). Für Demo und Tests gibt es einen Test-Händlerkatalog (`/v1/dev/partsbook`, in Produktion 404).
**Begründung:** So bindet der Schröder-Teileshop die Kataloge heute schon an (iframe/Popup + Warenkorbübergabe, `exportCartToSAP`). Lesezeichen, Bildschirmfoto und Zwischenablage hat der Auftraggeber abgelehnt; die E-Mail-Bestellanfrage kommt zu spät.
**Offen:** Händlerzugänge, Katalogadressen und das genaue Rückgabeformat je Hersteller (OP-51).
