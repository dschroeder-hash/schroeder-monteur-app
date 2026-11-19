# Setup Business Central – Checkliste für die IT

Ziel: Die Monteur-App liest und schreibt per API in Business Central (BC), ohne dass ein Benutzer angemeldet ist (Service-to-Service, OAuth 2.0 Client Credentials). Diese Liste beschreibt, was im Entra-Tenant und in BC vorbereitet werden muss. Erst die **Sandbox**, nach erfolgreichem Test die **Produktion**.

Legende: ☐ offen · Verantwortlich in Klammern.

---

## 1. Umgebung und Lizenz

- ☐ **BC-Sandbox** anlegen (Admin Center → Umgebungen → Neu → Sandbox, Kopie der Produktion empfohlen, damit echte Auftragsarten, Ressourcen und Lagerorte vorhanden sind). Name z. B. `monteur-sandbox`. (IT)
- ☐ BC-Version notieren (mindestens 25.0, siehe `bc-extension/app.json`). (IT)
- ☐ **Lizenz:** Service Management (Serviceaufträge, Serviceartikel, Zuordnungen) ist Bestandteil von **Dynamics 365 Business Central Premium**. Bestätigen, dass der Tenant Premium nutzt. Die S2S-Anwendung selbst benötigt keine Benutzerlizenz. (IT)
- ☐ Mandantenstruktur dokumentieren: welche BC-Mandanten (Companies) gehören zu den deutschen Standorten, welche **Zuständigkeitseinheit** steht für welchen Standort (Annahme OP-07). (IT / BC-Partner)

## 2. Entra App Registration (S2S)

- ☐ Im Entra Admin Center → _App-Registrierungen_ → _Neue Registrierung_: Name `Schroeder Monteur-App BC Connector (dev|test|prod)`, nur dieser Tenant. Je Umgebung eine eigene Registrierung. (IT)
- ☐ **Anmeldeinformationen:** Zertifikat (bevorzugt) oder geheimer Clientschlüssel. Ablage **nur im Azure Key Vault** der jeweiligen App-Umgebung, nie in Repo, E-Mail oder Ticket. Ablaufdatum im Kalender vermerken. (IT)
- ☐ **API-Berechtigungen** → _Berechtigung hinzufügen_ → _Dynamics 365 Business Central_ → **Anwendungsberechtigungen** → `API.ReadWrite.All`. (Nicht „Delegiert“.) (IT)
- ☐ **Administratorzustimmung erteilen** (Global Admin / Privileged Role Admin). (IT)
- ☐ Notieren und an das App-Team geben: Tenant-ID, Client-ID (Application ID), Umgebungsname. **Das Secret geht nur in den Key Vault.** (IT)

Token-Abruf zur Kontrolle:

```
POST https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/token
grant_type=client_credentials
client_id={clientId}
client_secret={secret}            (bzw. client_assertion bei Zertifikat)
scope=https://api.businesscentral.dynamics.com/.default
```

## 3. Anwendung in BC registrieren

- ☐ In BC (Sandbox) die Seite **„Microsoft Entra-Anwendungen“** öffnen → _Neu_. (BC-Admin)
  - Client-ID eintragen, Beschreibung `Monteur-App`, Status **Aktiviert**.
  - Unter _Benutzerberechtigungssätze_ zuweisen (je Mandant oder mandantenübergreifend leer lassen):
    - `WS WERKSTATT API` (aus der Extension, siehe Abschnitt 4 – erst nach Installation verfügbar),
    - zusätzlich **Standard-Berechtigungssätze für Lesen und Servicebearbeitung**, weil das Validieren von Servicezeilen und Buch.-Blatt-Zeilen viele weitere Tabellen liest (Einrichtung, Dimensionen, Preise, Reservierungen …). Empfehlung als Startpunkt: `D365 READ` plus der Satz für die Bearbeitung von Serviceaufträgen (Name im Mandanten prüfen, in der Liste der Berechtigungssätze nach „SERV“ suchen). **Nicht** `SUPER` vergeben.
  - Danach _Zustimmung erteilen_ auf der Karte ausführen.
- ☐ In der Sandbox prüfen: Werden beim Testen Berechtigungsfehler gemeldet, den fehlenden Tabellenzugriff dokumentieren und gezielt ergänzen (Berechtigungsrecorder in BC hilft). (BC-Admin / BC-Partner)

## 4. Extension installieren

- ☐ ID-Bereich der Extension (`50100–50199`, Platzhalter) mit dem BC-Partner abstimmen und ggf. in `bc-extension` anpassen. (BC-Partner)
- ☐ Extension einmal in VS Code gegen die Symbole der Sandbox kompilieren und in der Sandbox veröffentlichen (Anleitung: `bc-extension/README.md`). (App-Team / BC-Partner)
- ☐ Funktionstest mit `bc-extension/test/requests.http`: Lesen, Servicezeile zweimal mit gleicher `monteurAppId` senden (es darf nur eine Zeile entstehen), Zuordnung, Kommentar, Abwesenheit. (App-Team)
- ☐ Aufgabenwarteschlangenposten für Codeunit **50101 „WS Deleted Record Cleanup“** anlegen, täglich nachts. (BC-Admin)
- ☐ Nach Abnahme: `.app`-Datei in der Produktion über _Erweiterungsverwaltung → Erweiterung hochladen_ bereitstellen. (BC-Admin)

## 5. Stammdaten und Einrichtung in BC

| ☐   | Was                       | Wert (Default der App, konfigurierbar)                                                                                 | Wo in BC                        |
| --- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| ☐   | Ursachencodes Abwesenheit | `KRANK` (Krankheit), `URLAUB` (Urlaub), Einheit `TAG`                                                                  | Abwesenheitsursachen            |
| ☐   | Arbeitstypen              | `ARBEIT`, `FAHRT`, `DIAGNOSE` (Einheit `STUNDE`, Verrechnung je nach Preisstruktur)                                    | Arbeitstypen                    |
| ☐   | Ressourcen-Buch.-Blatt    | Vorlage `MONTEUR`, Buch.-Blatt-Name je Standort (z. B. `WILD`), Nummernserie für Belegnr.                              | Ressourcen Buch.-Blatt-Vorlagen |
| ☐   | Artikel-Buch.-Blatt       | Vorlage `MONTEUR` (Typ Artikel), Buch.-Blatt-Name je Standort, Nummernserie                                            | Artikel Buch.-Blatt-Vorlagen    |
| ☐   | Kostenstelle              | Welche Shortcut-Dimension (1 oder 2) ist die Kostenstelle?                                                             | Finanzbuchhaltung Einrichtung   |
| ☐   | Tankanlagen               | je Standort Lagerort (z. B. `WILD-TANK`) mit Artikel Diesel in Litern (Annahme E-17/OP-09)                             | Lagerorte, Artikel              |
| ☐   | Verbrauchsstoffe          | Öle, AdBlue, Fette als Artikel mit Basiseinheit bzw. Verkaufseinheit `L` / `KG`                                        | Artikel, Artikeleinheiten       |
| ☐   | Servicewagen              | je Servicewagen ein Lagerort (z. B. `WILD-SW03`)                                                                       | Lagerorte                       |
| ☐   | Ressourcen ↔ Mitarbeiter  | Jeder Monteur hat eine Ressource (Art Person) und einen Mitarbeiter; Zuordnung wird in der App-Administration gepflegt | Ressourcen, Mitarbeiter         |
| ☐   | Auftragsarten             | Liste aller Serviceauftragsarten inkl. Garantie/Kulanz/intern (OP-02) an das App-Team                                  | Serviceauftragsarten            |

## 6. Webhooks (optional, empfohlen)

BC benachrichtigt die App über Änderungen an Serviceaufträgen, Servicezeilen und Zuordnungen. Der Delta-Sync alle 2–5 Minuten bleibt die verlässliche Quelle; Webhooks verkürzen nur die Reaktionszeit.

- ☐ Öffentlich erreichbare **HTTPS-Notification-URL** der App-API (z. B. `https://<api-host>/bc/webhook`), TLS-Zertifikat gültig. (IT / App-Team)
- ☐ **Validierungs-Handshake:** Beim Anlegen einer Subscription ruft BC die URL mit `?validationToken=…` auf; die API muss innerhalb weniger Sekunden mit HTTP 200 und genau diesem Token als Text antworten. Das ist in der App implementiert.
- ☐ `clientState` (gemeinsames Geheimnis) im Key Vault ablegen; die API verwirft Notifications mit falschem `clientState`.
- Subscriptions laufen nach **3 Tagen** ab; der Worker der App erneuert sie automatisch. BC bündelt Benachrichtigungen (ca. 30 Sekunden Verzögerung).
- API-Queries (`itemAvailabilities`) unterstützen keine Webhooks.

## 7. Konfiguration der App (je Umgebung)

| Variable                                 | Beispiel                                        | Ablage                                        |
| ---------------------------------------- | ----------------------------------------------- | --------------------------------------------- |
| `BC_MODE`                                | `mock` · `sandbox` · `production`               | App-Konfiguration                             |
| `BC_TENANT_ID`                           | Entra-Tenant-GUID                               | App-Konfiguration                             |
| `BC_ENVIRONMENT`                         | `monteur-sandbox` / `production`                | App-Konfiguration                             |
| `BC_CLIENT_ID`                           | Client-ID der App Registration                  | App-Konfiguration                             |
| `BC_CLIENT_SECRET` bzw. `BC_CLIENT_CERT` | –                                               | **Key Vault** (Referenz per Managed Identity) |
| `BC_WEBHOOK_CLIENT_STATE`                | –                                               | **Key Vault**                                 |
| `BC_API_BASE_URL`                        | `https://api.businesscentral.dynamics.com/v2.0` | App-Konfiguration (Default)                   |

Basis-URL der Aufrufe: `https://api.businesscentral.dynamics.com/v2.0/{BC_TENANT_ID}/{BC_ENVIRONMENT}/api/…`

## 8. Offene Frage „Zeiterfassungsposten“ (OP-01)

Der Fachbereich nennt die Zieltabelle für Urlaub, Krankheit und Anwesenheit „Zeiterfassungsposten“. So prüfen Sie im Mandanten, was das ist (BC-Admin, ca. 10 Minuten):

1. In BC über die Suche (Alt+Q) „Zeiterfassungsposten“ öffnen – bzw. die Seite, auf der der Fachbereich diese Posten sieht.
2. **Seiteninspektion** öffnen: `Strg+Alt+F1` (bzw. Hilfe-Menü „?“ → _Hilfe und Support_ → _Seite untersuchen_).
3. Notieren: **Tabellenname und Tabellennummer** der Quelltabelle sowie den Abschnitt **„Erweiterungen“** (welche App stellt die Tabelle/Seite bereit, Herausgeber).
4. Auswertung:
   - Tabelle **5207 „Mitarbeiterabwesenheit“** (Employee Absence) → Standard, Default der App passt.
   - Tabellen **950–952 / 954** („Arbeitszeittabelle“, „Arbeitszeittabellenzeile“, „Arbeitszeittabellendetail“ …) → Standard-Arbeitszeittabellen; die App bekommt dafür einen eigenen Adapter (Standard-API `timeRegistrationEntries` oder eigene Page).
   - Tabellennummer im Partner-/ISV-Bereich (z. B. ≥ 70.000.000 oder ein anderer Herausgeber als Microsoft) → **Branchen-/ISV-Erweiterung**. Dann bitte Herausgeber, App-Name, Version und Feldliste der Tabelle an das App-Team; ggf. stellt der ISV eine API bereit, sonst wird eine API-Page in unserer Extension ergänzt.
5. Ergebnis in `docs/OFFENE-PUNKTE.md` (OP-01) eintragen.

Ebenso bitte prüfen (gleiches Vorgehen über die Seiteninspektion auf der Serviceartikelkarte): **Wo stehen die Betriebsstunden der Maschine?** (OP-20)

## 9. Abnahme Sandbox (Definition of Done BC-Teil)

- ☐ Lesen: Serviceaufträge, Serviceartikel, Ressourcen, Bestände je Lagerort kommen in der App an.
- ☐ Meister plant einen Auftrag → Zuordnung steht in BC am Serviceauftrag.
- ☐ Freigegebene Zeiten → Servicezeilen Typ Ressource mit richtigem Arbeitstyp und gerundeter Menge.
- ☐ 12 l Motoröl → Servicezeile Typ Artikel, 12 Liter, richtiger Lagerort.
- ☐ Urlaub genehmigt → Mitarbeiterabwesenheit mit `URLAUB`.
- ☐ Doppelter Versand (Retry) erzeugt keine doppelten Zeilen.
- ☐ Nichts wurde gebucht (Posten unverändert, bis in BC manuell gebucht wird).
- ☐ Testprotokoll mit Datum, BC-Version und Belegnummern in `docs/BETRIEB.md` ablegen.
