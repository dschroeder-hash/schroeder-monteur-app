# Betriebshandbuch – Schröder Monteur-App

Zielgruppe: IT-Betrieb der Schröder-Gruppe und der BC-Partner. Das Dokument beschreibt Aufbau, Erstinstallation,
täglichen Betrieb, Überwachung, Fehlerbilder und Wiederherstellung. Architektur und Entscheidungen stehen in
`ARCHITEKTUR.md` und `ENTSCHEIDUNGEN.md`, die BC-Seite in `SETUP-BC.md`, Datenschutz in `DATENSCHUTZ.md`,
die Sicherheitsprüfung in `SICHERHEIT.md`.

## 1. Überblick

| Komponente  | Azure-Ressource (Beispiel prod)       | Aufgabe                                                                                                                           |
| ----------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| App         | Container App `schr-monteur-prod-app` | Next.js-PWA (App-Shell, Service Worker). Keine Secrets, kein Datenzugriff.                                                        |
| API         | `schr-monteur-prod-api`               | REST-API, Anmeldung über Entra ID, Row Level Security in PostgreSQL.                                                              |
| Worker      | `schr-monteur-prod-worker`            | Hintergrundjobs: BC-Übertragung, BC-Abgleich, Push, Erinnerungen, Löschfristen, Produktivitäts-Abschluss. **Genau eine Instanz.** |
| Datenbank   | PostgreSQL Flexible Server `-psql`    | Alle App-Daten, privat im VNet, Anmeldung nur mit Entra ID.                                                                       |
| Speicher    | Storage Account `schrmontprodst`      | Fotos (privat, Zugriff nur über kurzlebige SAS-Links der API).                                                                    |
| Echtzeit    | Web PubSub `-wps`                     | Benachrichtigung „neue Daten“ an offene Apps (ohne Inhalte).                                                                      |
| Gateway     | Front Door Premium mit WAF `-afd`     | Einziger Weg von außen zu App und API (in prod).                                                                                  |
| Geheimnisse | Key Vault `schrmontprodkv`            | `BC-CLIENT-SECRET`, `VAPID-PRIVATE-KEY`.                                                                                          |
| Monitoring  | Log Analytics + Application Insights  | Logs, Metriken, Verfügbarkeit.                                                                                                    |

Region: **Germany West Central**. Umgebungen: `dev`, `test`, `prod` (je eine Ressourcengruppe).

**Identitäten (E-57):** `-id-api` (Datenbankrolle `monteur_app`), `-id-worker` (Datenbankrolle `monteur_worker`),
`-id-app` (nur Image-Pull). API und Worker prüfen beim Start ihre Datenbankrolle und **starten nicht**, wenn die
Row Level Security umgangen würde (Superuser, BYPASSRLS oder API als Mitglied von `monteur_worker`).

## 2. Erstinstallation (je Umgebung)

Reihenfolge einhalten – jeder Schritt mit Verantwortlichem.

1. **Entra ID (IT)** – App-Registrierungen anlegen (Details: `infra/README.md`, „Manuelle Schritte“):
   - „Monteur-App API“ mit App-Rollen `Werkstatt.Monteur|Meister|Lager|Personal|Admin` und Scope `access_as_user`.
     In der Unternehmensanwendung **„Zuweisung erforderlich“ = Ja** und nur die vorgesehenen Gruppen zuweisen.
   - „Monteur-App Web“ (SPA) mit Redirect-URI der Umgebung und Berechtigung auf `access_as_user`.
   - „Monteur-App BC-Connector“ (Client Credentials für BC, siehe `SETUP-BC.md`).
   - Werte in `infra/params/{env}.bicepparam` eintragen: `entraApiAudience`, `entraClientId`, `postgresAdminGroupObjectId`.
2. **Infrastruktur (IT)** – `az deployment group create --resource-group rg-schr-monteur-{env} --parameters infra/params/{env}.bicepparam`
   (oder Pipeline „Deploy“). Beim ersten Mal starten die Container Apps noch nicht sauber – das ist erwartet.
3. **Secrets (IT)** – im Key Vault anlegen:
   ```bash
   az keyvault secret set --vault-name schrmont{env}kv --name BC-CLIENT-SECRET --value "<Secret des BC-Connectors>"
   az keyvault secret set --vault-name schrmont{env}kv --name VAPID-PRIVATE-KEY --value "<privater VAPID-Schlüssel>"
   ```
   VAPID-Schlüsselpaar einmalig mit `npx web-push generate-vapid-keys` erzeugen; den öffentlichen Schlüssel als
   Parameter `vapidPublicKey` hinterlegen (OP-28).
4. **Datenbank – automatisch.** Die Pipeline (`infra/scripts/deploy.sh`) startet vor jedem Ausrollen den
   Container-Apps-Job `schr-monteur-{env}-migrate`. Er meldet sich mit seiner eigenen Identität `-id-migrate`
   (zweiter Entra-Administrator des Servers, Eigentümer des Schemas) an, führt die Migrationen aus und legt die Logins
   der Identitäten an: `-id-api` **nur** in `monteur_app`, `-id-worker` in `monteur_worker` (idempotent, korrigiert
   falsche Zuordnungen). Beim allerersten Deployment läuft der Job direkt nach dem Bicep-Deployment.
   Manuell (z. B. nach einem Fehlschlag): `az containerapp job start -n schr-monteur-{env}-migrate -g rg-schr-monteur-{env}`;
   Protokoll in Log Analytics (`ContainerAppConsoleLogs_CL`, Containername `migrate`).
5. **Images (Pipeline)** – Workflow „Deploy“ starten; baut und verteilt App, API/Worker und (nicht prod) BC-Mock.
6. **Front Door abschließen (IT, prod/test)** – `frontDoorId` ermitteln und in `params/{env}.bicepparam` eintragen,
   erneut deployen. Danach lehnt die API direkte Aufrufe ohne Front-Door-Kennung ab.
   ```bash
   az afd profile show -g rg-schr-monteur-{env} --profile-name schr-monteur-{env}-afd --query frontDoorId -o tsv
   ```
7. **Business Central (BC-Partner/BC-Admin)** – Extension installieren und einrichten: `SETUP-BC.md`.
8. **Stammdaten in der App (Admin)** – Standorte, Benutzerzuordnungen (Standort, Rolle, BC-Ressource/-Mitarbeiter),
   Auftragsart-Zuordnung Produktivität, Zielkorridor.
9. **Module freischalten (Admin, erst nach Zustimmung des Betriebsrats)** – unter Administration → Module je Standort.
   In prod sind Stempelung, Produktivität und die Meister-Teamansicht **standardmäßig aus** (§ 87 Abs. 1 Nr. 6 BetrVG).
   Beim Einschalten fragt die App nach der Referenz der Betriebsvereinbarung; sie steht im Audit-Log.
10. **Abnahme** – Checkliste in `SETUP-BC.md` Abschnitt 9 und `STATUS.md` (Definition of Done).

## 3. Konfiguration

Alle Werte setzt Bicep; manuelle Änderungen an den Container Apps werden beim nächsten Deployment überschrieben.

| Variable (API/Worker)                                                                       | Bedeutung                                                                                                  |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `APP_ENV`                                                                                   | `dev`/`test`/`prod`. In prod sind Entwicklungs-Login, lokaler Speicher und BC-Mock gesperrt.               |
| `AUTH_MODE`                                                                                 | Immer `entra` in Azure (Entwicklungs-Login wird in jeder Azure-Umgebung abgelehnt).                        |
| `ENTRA_TENANT_ID`, `ENTRA_API_AUDIENCE`, `ENTRA_ALLOWED_CLIENT_IDS`, `ENTRA_REQUIRED_SCOPE` | Tokenprüfung (nur Benutzertokens der eigenen SPA mit Scope `access_as_user`).                              |
| `DATABASE_URL`, `DATABASE_AUTH=entra`                                                       | Datenbank ohne Passwort, Anmeldung mit Token der Identität.                                                |
| `STORAGE_MODE=azure`, `STORAGE_ACCOUNT_URL`                                                 | Fotos im Storage Account.                                                                                  |
| `BC_MODE`, `BC_API_BASE_URL`, `BC_TOKEN_URL`, `BC_CLIENT_ID`, `BC_CLIENT_SECRET`            | Business Central (`mock` nur dev/test).                                                                    |
| `BC_SYNC_INTERVAL_SEC`                                                                      | Abgleich mit BC (Standard 180 s, 60–600).                                                                  |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`                                                     | Web Push. Ohne Schlüssel: Hinweise nur in der App.                                                         |
| `WEB_PUBSUB_ENDPOINT`                                                                       | Echtzeit. Ohne Endpunkt: die App fragt beim Sync ab.                                                       |
| `SPEECH_KEY`, `SPEECH_REGION`                                                               | Diktat über Azure Speech (optional, OP-30).                                                                |
| `CORS_ORIGINS`, `PUBLIC_API_URL`                                                            | Adresse der App.                                                                                           |
| `FRONT_DOOR_ID`, `TRUST_PROXY_HOPS`                                                         | Nur Front-Door-Verkehr; Client-IP für Ratenbegrenzung.                                                     |
| `RATE_LIMIT_PER_MIN`                                                                        | Anfragen je Benutzer und Minute (Standard 600; anonym ein Viertel). `0` = aus.                             |
| `DB_POOL_MAX`                                                                               | Datenbankverbindungen je API-Instanz (Standard 20). Summe aller Instanzen < `max_connections` des Servers. |

Fachliche Einstellungen (Tabelle `setting`, je Standort überschreibbar) pflegt der Admin: Zeiterfassungsziel in BC,
Arbeitstypen, Buch.-Blätter, Pflichtfelder Arbeitsbericht, Löschfristen, Abwesenheitsziel (`absence.bcTarget`,
Ursachencodes), Produktivität (Zielkorridor, Altdaten-Regel).

## 4. Hintergrundjobs (Worker)

| Job                            | Intervall | Aufgabe                                                                                                                                                                                                                                                                                                     |
| ------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bc-transfer`                  | 15 s      | Freigegebene Daten nach BC (idempotent, Wiederholung mit Backoff, nach 10 Versuchen „DEAD“).                                                                                                                                                                                                                |
| `bc-sync`                      | 180 s     | Aufträge, Artikel, Bestand, Stammdaten aus BC (Delta über `lastModifiedDateTime`, Sperre gegen Doppellauf).                                                                                                                                                                                                 |
| `web-push`                     | 20 s      | Benachrichtigungen an Geräte; Abwesenheiten nur mit neutralem Text.                                                                                                                                                                                                                                         |
| `forgotten-clock-out`          | 15 min    | Markiert vergessene „Gehen“-Buchungen zur Korrektur.                                                                                                                                                                                                                                                        |
| `forgotten-clock-out-reminder` | 5 min     | Erinnerung 19:00 Uhr Standortzeit (OP-17).                                                                                                                                                                                                                                                                  |
| `retention`                    | 6 h       | Löschfristen: Chat/Fotos 24 Monate nach Abrechnung, Krankmeldungen und Kommentare 12 Monate nach Ende, Benachrichtigungen 180 Tage, Sync-Protokoll 90 Tage; Zeitdaten, Audit-Log, Freigaben, Produktivität und Urlaub nach 6 Jahren (`retention.timeDataYears`); lange inaktive Konten werden anonymisiert. |
| `productivity-snapshot`        | 6 h       | Vormonat bis zum 10. neu berechnen, danach fest (E-54).                                                                                                                                                                                                                                                     |

`GET /health/ready` des Workers (Port `WORKER_HEALTH_PORT`, Standard 4001) liefert je Job den Zeitpunkt des letzten
erfolgreichen Laufs.

## 5. Überwachung

| Was                        | Wie                                                                              | Alarm empfohlen bei                                  |
| -------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Verfügbarkeit API          | `GET /health/live` (Prozess), `GET /health/ready` (Datenbank erreichbar)         | 2 Fehlschläge in Folge                               |
| Worker                     | Log „[worker] … failed“, `/health/ready` (letzter Erfolg je Job)                 | `bc-transfer` oder `bc-sync` > 15 min ohne Erfolg    |
| BC-Übertragungen           | Admin → Übertragungen nach BC (Status FAILED/DEAD), Log `[bc-transfer] … failed` | ≥ 1 DEAD oder FAILED > 1 h                           |
| Fehler 5xx / Antwortzeiten | Application Insights (Requests, Dependencies)                                    | 5xx > 1 % oder p95 > 2 s über 15 min                 |
| Ratenbegrenzung            | Anzahl HTTP 429                                                                  | auffälliger Anstieg (Fehlkonfiguration oder Angriff) |
| WAF                        | Front Door WAF-Logs                                                              | Häufung blockierter Anfragen                         |
| Datenbank                  | CPU, Speicher, Verbindungen, Replikation (prod HA)                               | CPU > 80 % über 15 min, Speicher > 80 %              |

Lastwerte zur Orientierung (Messung Phase 8, **eine** API-Instanz mit 20 DB-Verbindungen, siehe `STATUS.md`):
30 Geräte × 40 Befehle (jedes Paket doppelt gesendet) → p95 1,6 s, rund 200 Befehle/s, keine Duplikate;
150 Geräte gleichzeitig → p95 ca. 12 s bei gleichem Durchsatz – hier skaliert Container Apps ab 50 parallelen Anfragen
weitere Instanzen. Ist kurzfristig keine Verbindung frei, antwortet die API mit **503 + Retry-After** und die App
wiederholt automatisch. 500 BC-Übertragungen mit zwei Workern: ca. 100 je Sekunde, jede genau einmal.

## 6. Fehlerbilder und Abhilfe

| Symptom                                                                              | Ursache / Prüfung                                                                                | Abhilfe                                                                                                               |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| API oder Worker startet nicht, Log „[db-role] … Row Level Security wäre wirkungslos“ | Datenbank-Login falsch berechtigt                                                                | Migrations-Job erneut starten (Abschnitt 2, Schritt 4) – er korrigiert die Rollen. **Nie** die Prüfung abschalten.    |
| Übertragung FAILED „Dem Benutzer ist kein BC-Mitarbeiter zugeordnet“                 | Zuordnung Benutzer ↔ BC-Mitarbeiter fehlt                                                        | Admin → Benutzer: BC-Mitarbeiter-Nr. pflegen, dann „Erneut senden“.                                                   |
| Übertragung FAILED mit BC-Meldung (z. B. Lagerort, Arbeitstyp)                       | Fachlicher Fehler in BC                                                                          | Ursache in BC beheben, „Erneut senden“. Falls bereits manuell in BC erfasst: „Als erledigt markieren“ mit Begründung. |
| Übertragung DEAD                                                                     | 10 erfolglose Versuche (BC nicht erreichbar, Drosselung)                                         | Erreichbarkeit/Secret prüfen (Key Vault, Ablauf des Client-Secrets), „Erneut senden“.                                 |
| Gruppe von Übertragungen hängt                                                       | Ein FAILED/DEAD-Eintrag blockiert absichtlich die Folgeeinträge desselben Auftrags (Reihenfolge) | Den ältesten Eintrag der Gruppe beheben.                                                                              |
| Neue Aufträge kommen nicht an                                                        | `bc-sync` Fehler im Log; Cursor in Tabelle `bc_sync_cursor` (`last_error`)                       | BC-Berechtigungen/Secret prüfen; der nächste Lauf holt den Rückstand automatisch nach.                                |
| Monteur: „x ausstehend“ verschwindet nicht                                           | Gerät offline oder Befehl abgelehnt (Hinweis in der App)                                         | Netz prüfen; abgelehnte Befehle zeigt die App mit Grund. Daten bleiben auf dem Gerät.                                 |
| Keine Push-Benachrichtigungen                                                        | VAPID-Schlüssel fehlen, iOS nur bei installierter PWA, Benachrichtigungen im Gerät aus           | Schlüssel setzen; App zum Home-Bildschirm hinzufügen; Glocke in der App funktioniert immer.                           |
| HTTP 503 „Server ausgelastet“                                                        | Keine freie Datenbankverbindung innerhalb von 10 s (Lastspitze)                                  | Die App wiederholt selbst. Bei Häufung: `DB_POOL_MAX` bzw. `maxReplicas` erhöhen, Datenbank-SKU prüfen.               |
| HTTP 429 bei Benutzern                                                               | Ratenbegrenzung                                                                                  | `RATE_LIMIT_PER_MIN` prüfen; bei geteiltem Gerät wirkt die Grenze je Anmeldung, nicht je IP.                          |
| HTTP 403 „Zugriff nur über das Gateway“                                              | Aufruf an der Container-App-Adresse vorbei                                                       | Über die Front-Door-Adresse aufrufen; `frontDoorId` korrekt?                                                          |
| Foto-Upload schlägt fehl                                                             | CORS des Storage Accounts (App-Adresse), Datei kein JPEG oder > 25 MB                            | `appBaseUrl` im Parameterfile prüfen und deployen.                                                                    |
| Modul fehlt bei einem Standort                                                       | Feature-Flag aus                                                                                 | Admin → Module je Standort (nur mit Zustimmung des Betriebsrats).                                                     |

## 7. Aktualisierung und Rückfall

- **Bereitstellung:** Pipeline „Deploy“ (dev automatisch nach Freischaltung, test/prod mit Freigabe in GitHub).
  Images werden je Commit gebaut und in test/prod übernommen.
- **Migrationen** laufen automatisch vor dem Ausrollen (Abschnitt 2, Schritt 4). Migrationen sind nur additiv;
  die laufenden älteren Images arbeiten mit dem neuen Schema weiter. Schlägt der Job fehl, bricht die Pipeline ab,
  bevor neue Images ausgerollt werden.
- **Rückfall:** vorherige Revision der Container App aktivieren (`az containerapp revision activate`) bzw. Pipeline
  mit dem vorherigen Commit erneut ausführen. Datenbankänderungen werden nicht zurückgerollt.
- **Offline-Geräte** behalten ihre Daten über Updates hinweg; der Service Worker aktualisiert die App beim nächsten Start.
- **BC-Extension:** neue Version nach `bc-extension/README.md`, Abschnitt „Updates“.

## 8. Sicherung und Wiederherstellung

| Daten         | Sicherung                                                                              | Wiederherstellung                                                                                                                          |
| ------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Datenbank     | Automatisch, Point-in-Time 35 Tage (prod), 7 Tage (dev/test); prod zonenredundant (HA) | `az postgres flexible-server restore` auf neuen Server, dann `DATABASE_URL` umstellen.                                                     |
| Fotos         | Storage mit Soft Delete (siehe `infra/modules/storage.bicep`)                          | Gelöschte Blobs innerhalb der Frist wiederherstellen.                                                                                      |
| Konfiguration | Bicep im Repository, Secrets im Key Vault (Soft Delete, Löschschutz prod)              | Erneut deployen.                                                                                                                           |
| BC-Daten      | Führend ist BC; die App überträgt idempotent                                           | Nach einer Wiederherstellung der App-Datenbank sendet der Worker offene Übertragungen erneut – BC erkennt Duplikate über `Monteur App Id`. |

Geo-Backup ist bewusst aus (Daten bleiben in Deutschland, siehe `infra/README.md`). RPO ≤ 5 min (PITR),
RTO ca. 1–2 h für eine Wiederherstellung auf neuen Server.

## 9. Routineaufgaben

| Wann                        | Aufgabe                                                                                          | Wer           |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ------------- |
| täglich                     | Admin → Übertragungen nach BC: FAILED/DEAD bearbeiten                                            | Admin         |
| monatlich bis zum 10.       | Meister: offene Tage freigeben (danach ist die Produktivität des Vormonats fest)                 | Meister       |
| vor Ablauf                  | Client-Secret „BC-Connector“ erneuern (Key Vault `BC-CLIENT-SECRET`), Container Apps neu starten | IT            |
| jährlich                    | Urlaubsansprüche des neuen Jahres (Personal → Urlaubskonten)                                     | Personal      |
| jährlich                    | Berechtigungen prüfen: Gruppenzuweisungen der App-Rollen, Standortzuordnungen                    | IT / Personal |
| bei Abhängigkeits-Warnungen | `pnpm audit --prod`, Updates über Pull Request (CI prüft)                                        | Entwicklung   |
