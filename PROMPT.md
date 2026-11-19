# Prompt für Claude Code – Schröder Monteur-App (Werkstatt & Außendienst)

> Diesen kompletten Text als ersten Prompt in Claude Code einfügen (oder als `PROMPT.md` ins Repo legen und mit „Lies PROMPT.md und lege los“ starten).

---

## 0. Deine Rolle

Du bist Senior Full-Stack-Engineer mit Erfahrung in Microsoft Dynamics 365 Business Central (AL, API-Pages, OAuth/Entra ID), Offline-first-PWAs und Werkstattsoftware für den Landtechnik-Handel. Du arbeitest selbstständig und lieferst lauffähigen, getesteten Produktionscode, keinen Prototyp. Halte an echten Entscheidungspunkten an. Alles andere entscheidest du selbst und dokumentierst es in `docs/ENTSCHEIDUNGEN.md`.

## 1. Kontext

- **Unternehmen:** Heinrich Schröder Landmaschinen KG (Schröder-Gruppe), Wildeshausen. Familienunternehmen, über 1.000 Mitarbeiter, viele Werkstattstandorte in Deutschland. AGCO-Partner (Fendt, Valtra, Massey Ferguson) sowie Amazone, Lemken, Horsch, Merlo und CAT Green Line.
- **ERP:** Microsoft Dynamics 365 Business Central (BC). BC ist führend für Serviceaufträge, Ressourcen, Artikel, Bestände und Buchungen.
- **Dokumente:** M-Files bleibt das führende Dokumentenarchiv.
- **Schwesterprojekt:** Ein neues, selbst entwickeltes CRM entsteht auf Azure (Region Deutschland) mit eigener Datenbank und direkter BC-API. Die Monteur-App ist eine **eigenständige App auf demselben Stack** und muss sich später als Modul in dieses CRM einhängen lassen (gemeinsamer Login, gemeinsamer BC-Connector, gemeinsames Designsystem).
- **Ersatzteillogistik:** Es gibt kein Zentrallager. Teile, die am Standort fehlen, kommen über Nacht aus einem der eigenen Läger. Bestellschluss ist 17:00 Uhr.
- **Nutzer:** Monteure (Werkstatt und Servicewagen), Auszubildende, Werkstattmeister bzw. Werkstattleiter, Personal und Admin.

## 2. Feste Entscheidungen (nicht neu verhandeln)

| Thema | Entscheidung |
|---|---|
| Plattform | Eigenständige App, gleicher Stack wie das neue CRM: Azure, Region Germany West Central, Login über Microsoft Entra ID (SSO mit den M365-Konten) |
| BC-Anbindung | **Bidirektional per API.** Lesen live bzw. per Delta-Sync. **Schreiben nur nach Freigabe durch den Meister**: Zeiten, Artikelverbrauch und Abwesenheiten werden in BC-Buchungsblätter bzw. Serviceauftragszeilen übertragen. Das Buchen bleibt in BC. |
| Rollout | **Nur Deutschland** (alle deutschen BC-Standorte). Kein Mehrländer-Overhead in V1. Die Standortlogik muss aber sauber sein. |
| Offline | **Voll offline-fähig**: Stempeln, Dokumentieren, Fotos, Artikelentnahme, Verbrauchsstoffe und Chat-Entwürfe funktionieren ohne Netz und werden automatisch synchronisiert. |
| Design | Schröder Corporate Design (siehe Abschnitt 8) |
| Sprache | UI komplett Deutsch, Code und Kommentare Englisch, Doku Deutsch |

## 3. Empfohlener Tech-Stack (Abweichung nur mit Begründung in ENTSCHEIDUNGEN.md)

- **Frontend:** Next.js (App Router) + TypeScript + React, als **PWA** (installierbar auf Android, iOS und iPad). Tailwind mit Design-Tokens aus der CI. Offline mit Service Worker (Workbox) und IndexedDB (Dexie).
- **Backend:** Node.js/TypeScript (NestJS oder Next.js Route Handlers mit klarer Service-Schicht), REST + OpenAPI.
- **Datenbank:** Azure Database for PostgreSQL (Flexible Server), Prisma oder Drizzle, Migrationen versioniert.
- **Dateien/Fotos:** Azure Blob Storage (privat, SAS-Links mit kurzer Laufzeit). Schnittstelle für einen späteren Export nach M-Files vorbereiten.
- **Echtzeit (Chat, Statuswechsel):** Azure Web PubSub oder SignalR. Push über Web Push (VAPID).
- **Auth:** Entra ID (MSAL). Rollen über App Roles bzw. Entra-Gruppen. Serverseitige Rechteprüfung auf **jedem** Endpunkt (Row-Level-Filter).
- **BC-Zugriff:** OAuth 2.0 Client Credentials (S2S, Entra App Registration), BC API v2.0 plus **eigene API-Pages per AL-Extension** (siehe Abschnitt 6).
- **Infrastruktur:** Bicep oder Terraform, GitHub Actions (Build, Test, Deploy), getrennte Umgebungen dev/test/prod, Key Vault für Secrets, Application Insights für Logging.
- **Tests:** Vitest (Unit), Playwright (E2E inkl. Offline-Szenarien), Contract-Tests gegen einen **BC-Mock**.

## 4. Rollen & Rechte

| Rolle | Darf |
|---|---|
| **Monteur / Azubi** | Sieht **nur eigene** Aufträge, eigene Zeiten, eigene Produktivität, eigene Abwesenheiten. Stempelt, dokumentiert, entnimmt Artikel und Verbrauchsstoffe, lädt Fotos hoch, chattet zum eigenen Auftrag, meldet sich krank, beantragt Urlaub. |
| **Meister / Werkstattleiter** | Sieht alle Aufträge und Monteure **seines Standorts**. Plant und weist zu (Plantafel), gibt Zeiten, Verbrauch und Urlaub frei, korrigiert Zeiten (immer mit Begründung und Audit-Log), chattet, sieht Team-Kennzahlen. |
| **Personal** | Sieht Abwesenheiten (Krankmeldungen ohne Diagnose, Urlaub) standortübergreifend und hat Lesezugriff auf Anwesenheitszeiten. |
| **Admin** | Stammdaten der App: Standorte, Zuordnung Benutzer ↔ BC-Ressource, Auftragsart-Mapping, Textbausteine, Tankanlagen und Gebinde, Rundungsregeln. |

Ein Monteur darf technisch **niemals** fremde Aufträge, Zeiten oder Kennzahlen abrufen können. Das muss durch Tests gegen die API belegt werden, nicht nur in der UI.

## 5. Funktionsumfang V1 (mit Akzeptanzkriterien)

### 5.1 Stempelung (Anwesenheit + auftragsbezogen)
- **Kommen/Gehen** (Anwesenheit) und **Auftragsstempelung** (Start, Pause, Stopp, direkter Wechsel auf einen anderen Auftrag). Pro Monteur läuft immer genau eine Auftragszeit.
- Startet der Monteur einen Auftrag, ohne eingestempelt zu sein, wird „Kommen“ automatisch gesetzt (Hinweis anzeigen).
- Tätigkeitsarten je Buchung: Arbeitszeit, Fahrzeit, Diagnose. Dazu Gemeinkostenzeiten ohne Auftrag (Werkstattpflege, Schulung, Warten auf Teile, Sonderaufgabe).
- Rundung konfigurierbar (Standard: Viertelstunde für die Verrechnung, Ist-Minuten werden immer gespeichert).
- **Arbeitszeitgesetz:** Pausenprüfung (30 min ab 6 h, 45 min ab 9 h), Warnung bei Unterschreitung der 11 h Ruhezeit und bei mehr als 10 h pro Tag. Es wird nur gewarnt, nichts gesperrt.
- Vergessene Ausstempelung: Erinnerung per Push zur konfigurierten Uhrzeit. Am Folgetag Pflichtkorrektur, die der Meister freigibt.
- Offline-Stempelung speichert den Gerätezeitstempel **und** den Sync-Zeitpunkt. Abweichungen bei der Geräteuhr werden erkannt und markiert.
- **Akzeptanz:** Ein Tag mit 3 Aufträgen, Fahrzeit und Pause ergibt korrekte Anwesenheits- und Auftragszeiten. Nach Meister-Freigabe stehen sie als Ressourcenzeilen am richtigen BC-Serviceauftrag bzw. im Buchungsblatt.

### 5.2 Auftragsübersicht & Kalender (Zuweisung durch Meister)
- **Meister:** Plantafel (Tag/Woche, Monteure als Zeilen) mit Drag & Drop von Serviceaufträgen auf Monteur, Datum und Uhrzeit. Konflikte (Doppelbelegung, Abwesenheit) werden markiert. Die Zuweisung wird als **Serviceauftragszuordnung** nach BC geschrieben (Tabelle Service Order Allocation bzw. Ressource am Serviceartikel).
- **Monteur:** Kalender (Tag/Woche/Liste) nur mit eigenen Zuweisungen. Pro Auftrag: Kunde, Adresse mit Navigation (Deeplink Google/Apple Maps), Maschine (Marke, Modell, Seriennummer, Betriebsstunden), Fehlerbeschreibung, Auftragsart, Priorität, Ansprechpartner mit Tap-to-Call.
- Änderungen erzeugen eine Push-Nachricht an den Monteur.

### 5.3 Status & Dashboard
- **App-Feinstatus** (konfigurierbar) wird auf den BC-Status (Offen / In Bearbeitung / Erledigt / Zurückgestellt) gemappt:
  `Neu → Eingeplant → Unterwegs → In Arbeit → Wartet auf Teile → Wartet auf Kunde/Freigabe → Fertig – Doku offen → Fertig → Freigegeben (Meister) → Abgerechnet (aus BC)`
- Statuswechsel passieren teils automatisch (Stempelstart → In Arbeit) und teils manuell. Jeder Wechsel kommt in die Auftragshistorie.
- **Monteur-Dashboard:** Kacheln je Status mit Anzahl, heute fällige Aufträge, laufende Stempelung, offene Dokumentationen, offene Chat-Nachrichten. **Nur eigene Aufträge.**
- **Meister-Dashboard:** dieselbe Sicht für den ganzen Standort plus Freigabe-Inbox (Zeiten, Verbrauch, Urlaub).

### 5.4 Verbrauchsstoffe als Shop (Öl, Diesel, AdBlue, Fette)
- Kachel-Shop mit Produktbild, Bezeichnung, Gebinde und **aktuellem Bestand** am Standort bzw. Lagerort.
- **Öle und Schmierstoffe:** Entnahme aus dem Gebinde (Fass, IBC) in Litern mit Schnellwahl (z. B. 5 / 10 / 20 / 40 l und frei). Buchung auf den aktiven Auftrag. Basis ist der BC-Artikel mit Einheit Liter.
- **Diesel:** Tankanlage je Standort mit Bestand in Litern. Abgabe an einen Auftrag (Kundenmaschine betanken) oder intern (Servicewagen, Vorführmaschine, mit Kostenstelle). Optional Zählerstand vorher/nachher zur Plausibilisierung.
- Bestände werden lokal sofort reduziert (auch offline) und beim Sync mit BC abgeglichen. Unterschreitet ein Bestand den Mindestbestand, bekommen Meister und Lager eine Warnung.
- **Akzeptanz:** 12 l Motoröl auf Auftrag X erzeugen nach Freigabe eine Artikelzeile mit 12 Liter am BC-Serviceauftrag, und der Bestand stimmt.

### 5.5 Artikel / Ersatzteile wie im Shop
- Suche im BC-Artikelstamm nach Teilenummer, Bezeichnung oder **Barcode/QR-Scan** (Kamera). Treffer mit Bestand am eigenen Standort, im Servicewagen-Lager und in den anderen eigenen Lägern.
- Warenkorb pro Auftrag. Entnahme aus dem Lager oder dem Servicewagen.
- **Fehlt ein Teil am Standort:** Bestellanforderung ans Lager mit Hinweis „Bestellschluss 17:00 → Lieferung morgen“ und Zuordnung zum Auftrag. Der Auftrag geht auf „Wartet auf Teile“, sobald der Monteur das bestätigt.
- **Herstellerkatalog AGCO (shop.agcoparts.com):** Integration **nur per Deeplink/Absprung** (Suche mit Teilenummer bzw. Maschinenseriennummer im neuen Tab). Die gefundene Teilenummer wird per Eingabe, Zwischenablage oder Scan übernommen und dann gegen den BC-Artikelstamm aufgelöst. **Kein Scraping, kein automatisiertes Auslesen**, weil AGCO beim Crawling Bedenken hat. Die Anbindung muss als Adapter gekapselt sein, damit später AGCO-Produktdaten über die MDI-Anbindung angeschlossen werden können.
- Teilenummern, die nicht im BC-Stamm stehen: Anlage als „Neuer Artikel – Anfrage ans Lager“, keine direkte Neuanlage in BC.

### 5.6 Dokumentation & Schnelldoku
- Freitext-Arbeitsbericht pro Auftrag, Pflichtfelder je Auftragsart konfigurierbar (z. B. Betriebsstunden bei Wartung).
- **Schnelldoku:** auswählbare Textbausteine bzw. Checklisten je Auftragsart und Maschinengruppe, z. B. „Wartung nach Herstellerplan durchgeführt“, „Öle und Filter gewechselt“ oder „Probefahrt ohne Befund“. Mehrfachauswahl, editierbar, mit Platzhaltern (`{Betriebsstunden}`, `{Maschine}`). Meister und Admin pflegen die Bausteine.
- **Diktat:** Spracheingabe → Text (Browser-Spracherkennung, Azure Speech als Fallback). Optional formuliert eine KI das Diktat zu einem sauberen Arbeitsbericht um. Der Monteur bestätigt immer vor dem Speichern.
- Der Arbeitsbericht wird nach Freigabe als Kommentar bzw. Arbeitsbeschreibung an den BC-Serviceauftrag übertragen.

### 5.7 Fotos
- Mehrere Fotos pro Auftrag direkt aus der Kamera oder Galerie, mit Kategorie (Schaden vorher, nachher, Typenschild, Betriebsstundenzähler, Teil). Clientseitige Komprimierung (max. ca. 2.000 px), EXIF-GPS entfernen, Zeitstempel behalten.
- Offline-Queue mit fortsetzbarem Upload. Speicherung in Blob Storage, Referenz am Auftrag. Fotos sind auch im Chat nutzbar.

### 5.8 Chat zum Auftrag (Monteur ↔ Meister)
- Ein Thread pro Auftrag, Text und Fotos, Lesebestätigung, Push-Benachrichtigung. Systemnachrichten bei Statuswechseln.
- Offline geschriebene Nachrichten werden beim Sync in der richtigen Reihenfolge zugestellt.

### 5.9 Krankmeldung
- Der Monteur meldet sich mit 2 Taps krank: ab Datum, voraussichtlich bis (optional), Kommentar optional. **Keine Diagnose, kein AU-Upload.** Die eAU ruft der Arbeitgeber bei der Krankenkasse ab, die App weist nur darauf hin.
- Meister und Personal werden sofort benachrichtigt. Die zugewiesenen Aufträge im Zeitraum werden auf der Plantafel als **„neu einplanen“** markiert.
- Übertragung nach BC als Abwesenheit mit Ursachencode `KRANK` (Ziel siehe 6.3).

### 5.10 Urlaubsanträge mit Genehmigung
- Der Monteur beantragt Urlaub (ganztags oder halbtags, Zeitraum). Er sieht seinen Resturlaub (Quelle konfigurierbar: BC oder Pflege in der App) und die Abwesenheiten seines Teams **ohne Gründe** (nur „abwesend“).
- Workflow: beantragt → genehmigt oder abgelehnt (mit Begründung) durch den Meister → optional Stornoantrag. Push an den Antragsteller.
- Nach Genehmigung automatischer Transfer in die **BC-Zeiterfassungsposten** bzw. Mitarbeiterabwesenheit (Ursachencode `URLAUB`). Genehmigter Urlaub blockiert die Plantafel.

### 5.11 Produktivität (nur eigene Sicht für den Monteur)
**Definition (in der App konfigurierbar, mit diesen Defaults):**

```
Produktivität = verrechnete Stunden ÷ Anwesenheitsstunden
```

- **Anwesenheitsstunden:** gestempelte Anwesenheit ohne Urlaub, Krankheit, Feiertage, Schulungen und angeordnete Sonderaufgaben.
- **Verrechnete Stunden je Kategorie** über ein Mapping der **BC-Serviceauftragsarten**:

| Kategorie | BC-Auftragsarten (Default) | Zählt als produktiv |
|---|---|---|
| Kundenservice | `KUNDE`, `KLEING` | ja (extern) |
| Wartung Kunde | `WARTUNG` | ja (extern) |
| Wartung intern / Wartungsvertrag | `INTWART` (Wartung auf interne Kosten, z. B. Wartungsvertrag, erkennbar über die Maschinennummer) | ja (intern verrechnet), separat ausweisen |
| Garantie / Kulanz | Garantie-Auftragsarten (in BC prüfen) | ja, wenn vom Hersteller vergütet bzw. vom Meister freigegeben |
| Intern sonstige | alle übrigen (z. B. Gebrauchtmaschinen-Aufbereitung, Übergabeinspektion) | als **interner Umsatz** sichtbar, eigener Balken |
| Nacharbeit | Kennzeichen am Auftrag | nein |

- Hinweis: Ältere Wartungen sind teils als Kundenaufträge mit „Wartung“ im Titel gebucht. Für Auswertungen von Altdaten muss das Mapping diese Regel optional anwenden können.
- **Ansicht Monteur:** aktueller Monat, Vormonat und 12-Monats-Trend. Aufteilung der Stunden nach Kategorie (gestapelter Balken), Produktivität als Kennzahl mit Zielkorridor (Default-Ziel 80–85 %, konfigurierbar), Anteil Fahrzeit, Dokumentationsquote (Anteil Aufträge mit vollständiger Doku bis Ende des Folgetags).
- **Ansicht Meister:** dieselben Kennzahlen pro Monteur seines Standorts plus Standortsumme.
- Die Berechnung muss so gebaut sein, dass ein späteres monatliches Bonussystem (Produktivität über einer Schwelle × Qualitätsfaktor) direkt darauf aufsetzen kann. Das Bonussystem selbst baust du in V1 **nicht**.

## 6. Business-Central-Integration (Detail)

### 6.1 Lesen
- Standard API v2.0, wo möglich (Artikel, Bestände, Lagerorte, Debitoren, Mitarbeiter).
- **Serviceaufträge, Servicezeilen, Serviceartikel (Maschinen), Ressourcen, Serviceauftragszuordnungen und Auftragsarten sind nicht in der Standard-API enthalten.** Baue dafür eine **AL-Extension** mit eigenen API-Pages (`APIPublisher = 'schroeder'`, `APIGroup = 'werkstatt'`, `APIVersion = 'v1.0'`) im Unterordner `/bc-extension`. Inklusive `app.json`, Permission Set und Doku zur Installation.
- Delta-Sync über `lastModifiedDateTime` bzw. SystemModifiedAt, alle 2–5 Minuten plus On-Demand-Refresh. Webhooks (Subscriptions), wo BC sie unterstützt.

### 6.2 Schreiben (nur nach Meister-Freigabe)
- Zeiten → Servicezeilen vom Typ Ressource am Serviceauftrag bzw. Service-/Ressourcen-Buch.-Blatt (Ziel konfigurierbar, sauber gekapselt).
- Artikel und Verbrauchsstoffe → Servicezeilen vom Typ Artikel mit Lagerort.
- Zuweisungen → Serviceauftragszuordnungen.
- Arbeitsbericht → Kommentarzeilen bzw. Arbeitsbeschreibung.
- **Kein automatisches Buchen.** Lieferung und Rechnung bleiben in BC.
- Jede Übertragung ist **idempotent** (Idempotency-Key = App-Buchungs-ID, in BC in einem eigenen Feld gespeichert), mit Retry/Backoff, Dead-Letter-Liste und Admin-Ansicht „Fehlgeschlagene Übertragungen“ mit erneutem Senden.

### 6.3 Abwesenheiten / Zeiterfassungsposten
- Die Zieltabelle für Urlaub, Krankheit und Anwesenheit nennt der Fachbereich „Zeiterfassungsposten“. **Prüfe im BC-Tenant, ob das eine Standardtabelle (Arbeitszeittabellen / Mitarbeiterabwesenheit) oder eine Branchen-/ISV-Erweiterung ist.** Baue das Ziel als austauschbaren Adapter. Solange das nicht geklärt ist, gilt der Standard „Mitarbeiterabwesenheit“ (Employee Absence) mit Ursachencodes.
- Benutzer ↔ BC-Ressource ↔ BC-Mitarbeiter ist ein gepflegtes Mapping in der App-Administration.

### 6.4 Entwicklung ohne Tenant
- Baue einen **BC-Mock-Server** (gleiche Endpunkte, realistische Landtechnik-Testdaten: Fendt, Valtra, Massey Ferguson, Amazone, Lemken, CAT; Auftragsarten wie in 5.11; mehrere deutsche Standorte). So ist die App komplett ohne BC-Zugang entwickel- und testbar. Umschalten per ENV.

## 7. Offline-Architektur
- Local-first: Alle Schreibaktionen gehen zuerst in IndexedDB (Outbox mit UUID, Zeitstempel, Gerätezeit). Danach Hintergrund-Sync (Background Sync API plus Fallback beim App-Fokus).
- Vorab-Cache: zugewiesene Aufträge der nächsten 7 Tage, Artikelstamm des eigenen Standorts und Servicewagens (kompakt), Verbrauchsstoffe, Textbausteine.
- Konfliktregeln: Stempelzeiten des Monteurs gewinnen gegenüber Status-Überschreibungen. Bei Zuweisungsänderungen durch den Meister während der Offline-Phase sieht der Monteur einen klaren Hinweis. Bestandskonflikte werden auf dem Server aufgelöst und dem Meister gemeldet.
- Sichtbarer Sync-Status im Header: online/offline, Anzahl ausstehender Einträge, letzter Sync.
- E2E-Tests: Arbeitstag komplett im Flugmodus → Sync → Daten vollständig und ohne Duplikate.

## 8. Design – Schröder Corporate Design
- **Farben (Design-Tokens):**
  - Primär Grün HKS 57: `#07915E` (RGB 7/145/94)
  - Grau HKS 92: `#676C6E` (RGB 103/108/110)
  - Schwarz HKS 88: `#1D1D1B` (Annäherung, Wert gegen das CD-Manual prüfen)
  - Abgeleitete Töne (Hover, Hintergründe, Statusfarben Warnung/Fehler) definierst du selbst, mit WCAG-AA-Kontrast. Grün ist nur Akzent- und Primärfarbe, keine Flächenflut.
- **Schriften laut Manual:** *Delta BQ Jaeger Medium Italic* (Headlines) und *Helvetica Neue Heavy Italic* (Auszeichnungen). Webfont-Lizenzen sind ungeklärt, also über `@font-face` mit Platzhalterpfad einbinden und als Fallback eine lizenzfreie Sans verwenden (z. B. Inter). Fließtext immer gut lesbar, nicht kursiv.
- **Logo:** „Schröder Landmaschinen“ liegt als Reinzeichnung (PDF) vor. Platzhalter `public/brand/logo.svg` vorsehen, die Datei wird nachgeliefert.
- **Werkstatt-tauglich:** große Touch-Ziele (min. 48 px), Bedienung mit Handschuhen und einer Hand, hoher Kontrast für Sonnenlicht draußen, Dark Mode für die Werkstatt, große Stempel-Buttons (Start/Stopp) immer erreichbar (Sticky Bottom Bar), maximal 2 Taps zu den Kernaktionen.
- Responsive: Smartphone (Monteur), iPad (Monteur und Meister), Desktop (Meister-Plantafel).

## 9. Datenschutz, Mitbestimmung, Recht
- Zeiterfassung und Produktivitätskennzahlen sind eine technische Leistungs- und Verhaltenskontrolle (**§ 87 Abs. 1 Nr. 6 BetrVG**). Der Betriebsrat muss vor dem Go-live zustimmen. Baue deshalb **Feature-Flags** pro Modul (insbesondere Produktivität und Meister-Teamansicht), damit einzelne Module getrennt aktiviert werden können.
- Krankmeldungen: keine Gesundheitsdaten speichern, nur Zeitraum und Code. Zugriff nur für Meister und Personal.
- Löschkonzept: Chat und Fotos am abgeschlossenen Auftrag nach konfigurierbarer Frist archivieren bzw. löschen. Zeitdaten nach den gesetzlichen Aufbewahrungsfristen.
- Vollständiges Audit-Log für alle Korrekturen und Freigaben (wer, wann, alt → neu, Begründung).
- DSGVO-Doku: `docs/DATENSCHUTZ.md` mit Verarbeitungsübersicht als Grundlage für den Datenschutzbeauftragten.

## 10. Vorgehen
1. **Phase 0 – Analyse & Plan:** Lies diesen Prompt vollständig. Lege `docs/ARCHITEKTUR.md` (Komponenten, Datenmodell als ER-Diagramm in Mermaid, Sync-Konzept, BC-Mapping-Tabelle), `docs/ENTSCHEIDUNGEN.md` und `docs/OFFENE-PUNKTE.md` an. Danach **stopp und kurze Zusammenfassung an mich**.
2. **Phase 1 – Fundament:** Monorepo (`/app`, `/api`, `/bc-extension`, `/bc-mock`, `/infra`, `/docs`), Auth mit Entra ID und Rollen, Datenmodell und Migrationen, BC-Mock, CI-Pipeline, Designsystem mit CI-Tokens.
3. **Phase 2 – Kernprozess Monteur:** Stempelung, Auftragsliste und Kalender, Status, Monteur-Dashboard, Offline-Grundgerüst.
4. **Phase 3 – Meister:** Plantafel mit Zuweisung, Freigabe-Inbox, BC-Rückschreiben inklusive Idempotenz und Fehlerliste.
5. **Phase 4 – Material:** Artikelsuche und Scan, Warenkorb, Bestellanforderung, Verbrauchsstoffe-Shop (Öl/Diesel), AGCO-Deeplink-Adapter.
6. **Phase 5 – Doku & Kommunikation:** Arbeitsbericht, Schnelldoku-Bausteine, Diktat, Fotos, Auftrags-Chat, Push.
7. **Phase 6 – Abwesenheiten:** Krankmeldung, Urlaubsantrag mit Workflow, Transfer nach BC.
8. **Phase 7 – Produktivität:** Kennzahlen-Engine mit Auftragsart-Mapping, Monteur- und Meisteransicht.
9. **Phase 8 – Härtung:** E2E-Tests inklusive Offline-Szenarien, Last- und Sync-Tests, Security-Review (OWASP ASVS L2), Barrierefreiheit, Betriebshandbuch `docs/BETRIEB.md`, Installationsanleitung für die AL-Extension.

Nach jeder Phase: Tests grün, kurzer Statusbericht (was fertig ist, was offen ist, welche Entscheidungen du getroffen hast), dann weiter. Erneut stoppen nur bei echten Blockern.

## 11. Offene Punkte (in OFFENE-PUNKTE.md führen, bis dahin mit Annahme weiterbauen)
- Was genau ist „Zeiterfassungsposten“ in unserem BC (Standard oder Erweiterung)? → Adapter, Default Mitarbeiterabwesenheit.
- Exakte Codes der Garantie- und internen Auftragsarten in BC → Mapping konfigurierbar, Defaults wie in 5.11.
- Quelle des Resturlaubs (BC oder App).
- Webfont-Lizenzen und Logo-Datei.
- BC-Umgebung (Sandbox/Production), Entra App Registration und Berechtigungen → Checkliste in `docs/SETUP-BC.md` für unsere IT.
- Zustimmung des Betriebsrats zu Stempelung und Produktivitätsansicht → Feature-Flags.

## 12. Definition of Done (V1)
- Ein Monteur kann einen kompletten Arbeitstag **offline** abwickeln: einstempeln, 3 Aufträge mit Teilen, Öl, Diesel, Fotos, Schnelldoku und Chat, ausstempeln. Nach dem Sync ist alles vollständig und ohne Duplikate.
- Der Meister plant per Drag & Drop, gibt frei, und die Daten stehen korrekt am BC-Serviceauftrag (im Mock und mit dokumentiertem Test gegen die BC-Sandbox).
- Monteure sehen nachweislich (API-Tests) nur eigene Daten.
- Urlaub und Krankmeldung laufen Ende-zu-Ende inklusive BC-Transfer.
- Die Produktivität wird gemäß Mapping korrekt berechnet (Unit-Tests mit Referenzfällen).
- Lighthouse PWA/Performance/Accessibility ≥ 90 auf Mobile. Das CI-Design ist umgesetzt.
- Doku vollständig: Architektur, Entscheidungen, Setup BC, Datenschutz, Betrieb.
