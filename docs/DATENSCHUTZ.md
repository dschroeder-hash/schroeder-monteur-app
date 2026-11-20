# Datenschutz – Verarbeitungsübersicht Schröder Monteur-App

Grundlage für den Datenschutzbeauftragten (Verzeichnis von Verarbeitungstätigkeiten nach Art. 30 DSGVO,
Datenschutz-Folgenabschätzung, Betriebsvereinbarung). **Kein Rechtsgutachten** – die rechtliche Bewertung (Spalten
„Rechtsgrundlage“, Fristen) ist ein Vorschlag des Entwicklungsteams und durch DSB/Personal zu bestätigen.

## 1. Verantwortlicher und Zweck

- **Verantwortlicher:** Heinrich Schröder Landmaschinen KG (Schröder-Gruppe), Standorte gemäß Stammdaten.
- **Zweck der Anwendung:** Abwicklung von Werkstatt- und Außendienstaufträgen (Planung, Arbeitszeit am Auftrag,
  Material, Dokumentation, Kommunikation), Abwesenheiten der Monteure und Übergabe an Microsoft Dynamics 365 Business
  Central (BC) zur Abrechnung und Lohnabrechnung.
- **Betroffene:** Monteure und Auszubildende, Meister/Werkstattleiter, Teiledienst (Lager), Personalabteilung,
  Administratoren; mittelbar Kunden bzw. deren Ansprechpartner (aus BC übernommen).

## 2. Verarbeitungen je Modul

| Modul (Feature-Flag)                                       | Daten                                                                                                                 | Zweck                                                       | Rechtsgrundlage (Vorschlag)                                                                                                             | Wer sieht was                                                                                           |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Anmeldung / Benutzer                                       | Entra-Objekt-ID, Name, E-Mail, App-Rollen, Standortzuordnung, Zuordnung BC-Ressource/-Mitarbeiter                     | Zugriffssteuerung, Zuordnung der Buchungen                  | § 26 Abs. 1 BDSG / Art. 88 DSGVO (Durchführung des Beschäftigungsverhältnisses)                                                         | Admin; Name für Kollegen am Standort                                                                    |
| Stempelung, Arbeitszeit (`stamping`) ⚖                     | Kommen/Gehen, Pausen, Zeiten je Auftrag und Tätigkeit, Gemeinkosten, Geräteuhr-Abweichung, Korrekturen mit Begründung | Arbeitszeiterfassung, Auftragsabrechnung, ArbZG-Hinweise    | § 26 BDSG; Art. 6 Abs. 1 lit. c DSGVO i. V. m. § 16 Abs. 2 ArbZG / Arbeitszeiterfassungspflicht (BAG 1 ABR 22/21); Betriebsvereinbarung | Monteur: eigene; Meister: Standort; Personal: Anwesenheit (ohne Auftragsdetails)                        |
| Aufträge, Planung (`planning.board`)                       | Zuweisung Monteur ↔ Auftrag, Zeitfenster; Kundendaten aus BC (Name, Adresse, Ansprechpartner, Telefon)                | Einsatzplanung, Anfahrt                                     | § 26 BDSG; Art. 6 Abs. 1 lit. b/f DSGVO (Kundendaten, Vertragserfüllung)                                                                | Monteur: eigene Aufträge; Meister: Standort                                                             |
| Material (`materials`, `consumables`)                      | Entnahmen mit Monteur, Zeitpunkt, Zählerstände                                                                        | Abrechnung, Bestand                                         | § 26 BDSG; Art. 6 Abs. 1 lit. b DSGVO                                                                                                   | Monteur: eigene; Meister/Lager: Standort                                                                |
| Dokumentation, Fotos (`photos`)                            | Arbeitsbericht, Fotos (EXIF/GPS auf dem Gerät entfernt), Diktat (Text)                                                | Nachweis der Leistung, Gewährleistung                       | Art. 6 Abs. 1 lit. b/f DSGVO                                                                                                            | Am Auftrag Beteiligte; Meister; Lager (Auftragsbezug)                                                   |
| Chat (`chat`)                                              | Nachrichten, Lesebestätigungen, Fotos zum Auftrag                                                                     | Abstimmung zum Auftrag                                      | § 26 BDSG                                                                                                                               | Am Auftrag Beteiligte und Meister                                                                       |
| Diktat (`dictation`, `dictation.ai`)                       | Audio nur zur Umwandlung (Browser oder Azure Speech, Region Germany West Central), nicht gespeichert                  | Eingabehilfe                                                | § 26 BDSG; Einwilligung empfohlen für KI-Umformulierung (`dictation.ai`, standardmäßig aus)                                             | –                                                                                                       |
| Krankmeldung (`absence.sick`)                              | Zeitraum, Code `KRANK`, optionaler Kommentar (Hinweis: keine Diagnose). **Keine** AU-Bescheinigung, keine Diagnose    | Arbeitsorganisation, Entgeltfortzahlung (in BC)             | § 26 Abs. 3 BDSG / Art. 9 Abs. 2 lit. b DSGVO (Gesundheitsdatum „arbeitsunfähig“)                                                       | Monteur: eigene; **nur Meister des Standorts und Personal** (mit Art); Kollegen nur „abwesend“ ohne Art |
| Urlaub (`absence.vacation`)                                | Zeitraum, halber Tag, Kommentar, Entscheidung mit Begründung, Urlaubsanspruch                                         | Urlaubsverwaltung                                           | § 26 BDSG                                                                                                                               | Monteur: eigene; Meister: Standort; Personal: alle; Kollegen: „abwesend“                                |
| Produktivität (`productivity.self`, `productivity.team`) ⚖ | Kennzahlen aus freigegebenen Zeiten und Auftragsarten, Monats-Snapshots                                               | Steuerung, Grundlage eines möglichen Bonussystems (V1 ohne) | § 26 BDSG; **Betriebsvereinbarung erforderlich** (§ 87 Abs. 1 Nr. 6 BetrVG)                                                             | Monteur: nur eigene; Meister: Standort (Teamansicht separat schaltbar); Admin: **keine** Einzelwerte    |
| Benachrichtigungen, Web Push                               | Titel/Text der Mitteilung, Push-Endpunkt des Browsers                                                                 | Information über neue Aufträge, Entscheidungen, Nachrichten | § 26 BDSG                                                                                                                               | Empfänger; Abwesenheiten auf dem Sperrbildschirm nur mit neutralem Text                                 |
| Audit-Log                                                  | Wer, wann, alt → neu, Begründung (Korrekturen, Freigaben, Einstellungen)                                              | Nachvollziehbarkeit, Revisionssicherheit                    | Art. 6 Abs. 1 lit. c/f DSGVO                                                                                                            | Admin; eigene Einträge                                                                                  |

⚖ = Modul mit Mitbestimmung (§ 87 Abs. 1 Nr. 6 BetrVG). Alle Module sind je Standort einzeln schaltbar; in
Produktion sind Stempelung, Produktivität und Meister-Teamansicht standardmäßig **aus**. Das Einschalten wird mit
Referenz auf die Betriebsvereinbarung im Audit-Log festgehalten.

## 3. Empfänger und Auftragsverarbeiter

| Empfänger                                                              | Daten                                                                                                                                 | Ort                              | Grundlage                                                                              |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------- |
| Microsoft Azure (App, Datenbank, Speicher, Web PubSub, Speech)         | alle Daten der App                                                                                                                    | Germany West Central (Frankfurt) | AVV Microsoft (DPA), EU Data Boundary                                                  |
| Microsoft Entra ID                                                     | Anmeldung                                                                                                                             | EU Data Boundary                 | AVV Microsoft                                                                          |
| Microsoft Dynamics 365 Business Central                                | freigegebene Zeiten, Material, Zuweisungen, Berichtstext, Abwesenheiten (Code `KRANK`/`URLAUB`, Zeitraum, Menge – **ohne Kommentar**) | Mandant der Schröder-Gruppe      | AVV Microsoft; bestehende Verarbeitung                                                 |
| Push-Dienste der Browserhersteller (Apple, Google, Mozilla, Microsoft) | verschlüsselte Push-Nachricht (Titel, Text, Link)                                                                                     | ggf. USA                         | Art. 44 ff. DSGVO (DPF / SCC des Herstellers); Inhalt minimiert, Abwesenheiten neutral |
| BC-Partner (Support)                                                   | nur bei Fehleranalyse, nach Freigabe                                                                                                  | –                                | AVV mit Partner                                                                        |

Keine Weitergabe an Dritte zu Werbezwecken, kein Tracking, keine Analysedienste in der App.

## 4. Löschfristen

| Daten                                                          | Frist (Standard, einstellbar)                                                                                 | Umsetzung                                                                                                              |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Chat und Fotos am Auftrag                                      | 24 Monate nach Abrechnung des Auftrags                                                                        | Worker-Job `retention` (Fotos inkl. Datei)                                                                             |
| Krankmeldungen in der App                                      | 12 Monate nach Ende (danach nur noch in BC)                                                                   | Worker-Job `retention` löscht Datensatz und Kalendereintrag                                                            |
| Kommentare zu Urlaub                                           | 12 Monate nach Ende (Zeitraum bleibt für Urlaubskonto)                                                        | Worker-Job `retention`                                                                                                 |
| Benachrichtigungen                                             | 180 Tage                                                                                                      | Worker-Job `retention`                                                                                                 |
| Arbeitszeiten, Stempelungen, Korrekturen, Audit-Log, Freigaben | 6 Jahre (Anlehnung an § 257 HGB / Lohnunterlagen; ArbZG mind. 2 Jahre), einstellbar `retention.timeDataYears` | Worker-Job `retention`                                                                                                 |
| Produktivitäts-Snapshots, Urlaub                               | wie Arbeitszeiten                                                                                             | Worker-Job `retention`                                                                                                 |
| Technisches Sync-Protokoll                                     | 90 Tage                                                                                                       | Worker-Job `retention`                                                                                                 |
| Offline-Daten auf dem Gerät                                    | Abmeldung                                                                                                     | IndexedDB und Caches werden geleert; nicht übertragene Einträge bleiben bis zur nächsten Anmeldung desselben Benutzers |
| Benutzerkonto                                                  | Deaktivierung durch Admin; nach Ablauf der Frist ohne Aktivität anonymisiert (Name, E-Mail, Rollen)           | Worker-Job `retention`                                                                                                 |

## 5. Technische und organisatorische Maßnahmen (Auszug)

Ausführlich: `SICHERHEIT.md`.

- **Zugriff:** Anmeldung nur über Entra ID (MFA nach Unternehmensrichtlinie), App-Rollen und Standortzuordnung.
  Durchgesetzt **in der Datenbank** (Row Level Security je Anfrage) und zusätzlich in der API; automatisierte Tests
  für jede Route und Rolle. Vier-Augen-Prinzip: niemand gibt eigene Zeiten, Entnahmen oder Abwesenheiten frei.
- **Datensparsamkeit:** keine Diagnose, kein AU-Upload; Kollegen sehen nur „abwesend“ (eigene Tabelle ohne Art und
  Kommentar); Kommentar geht nie nach BC; Admin sieht bei Abwesenheits-Übertragungen weder Art noch Text; Fotos ohne
  EXIF/GPS; Push-Texte zu Abwesenheiten neutral.
- **Verschlüsselung:** TLS 1.2+ für alle Verbindungen, HSTS; Daten in Azure verschlüsselt gespeichert; Fotos nur über
  kurzlebige, signierte Links (10 min).
- **Geheimnisse:** Key Vault, Managed Identities, Datenbank ohne Passwort; getrennte Identitäten für API, Worker, App.
- **Protokollierung:** Audit-Log für Korrekturen, Freigaben, Einstellungen; Fehlerprotokolle der API enthalten technische Fehlermeldungen, keine Anfrageinhalte (Berichte, Chat, Kommentare).
- **Endgeräte:** Offline-Daten liegen unverschlüsselt in der IndexedDB des Browsers. **Empfehlung:** Dienstgeräte mit
  Geräteverschlüsselung und Bildschirmsperre (MDM, z. B. Intune); bei geteilten Tablets Abmelden nach der Schicht
  (die App löscht dabei alle personenbezogenen Daten des Benutzers vom Gerät).
- **Verfügbarkeit:** Point-in-Time-Wiederherstellung 35 Tage, zonenredundant (prod); siehe `BETRIEB.md`.

## 6. Betroffenenrechte

| Recht                                         | Umsetzung                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Auskunft / Datenübertragbarkeit (Art. 15, 20) | Jeder Benutzer lädt seine Daten selbst herunter: Benutzermenü → „Meine Daten herunterladen“ (JSON, nur eigene Datensätze). Fotos auf Anfrage durch den Admin. |
| Berichtigung (Art. 16)                        | Zeitkorrekturantrag in der App; Meister korrigiert mit Begründung (Audit-Log).                                                                                |
| Löschung / Einschränkung                      | Nach Ablauf der Fristen automatisch; vorher durch Admin nach Prüfung der Aufbewahrungspflichten.                                                              |
| Widerspruch (Art. 21)                         | Prüfung durch Personal/DSB.                                                                                                                                   |

## 7. Datenschutz-Folgenabschätzung (Art. 35 DSGVO)

**Empfehlung: DSFA durchführen.** Gründe: systematische Erfassung des Verhaltens von Beschäftigten (Arbeitszeit,
Produktivitätskennzahlen), Verarbeitung von Gesundheitsdaten (Arbeitsunfähigkeit), Einsatz auf mobilen Geräten.
Die in Abschnitt 5 genannten Maßnahmen, die getrennt schaltbaren Module und die fehlende Leistungsbewertung durch den
Admin sind als risikomindernde Maßnahmen in die DSFA aufzunehmen. Beteiligung des Betriebsrats vor Go-live
(§ 87 Abs. 1 Nr. 6 BetrVG) – Feature-Flags erlauben die Freischaltung je Modul und Standort nach Zustimmung.

## 8. Offene Punkte (aus `OFFENE-PUNKTE.md`)

- OP-18: Löschfristen bestätigen.
- OP-31: KI-Umformulierung – Anbieter, AVV, ggf. Einwilligung.
- OP-38 und OP-39 sind umgesetzt (Löschroutine 6 Jahre, Selbstauskunft); die Frist von 6 Jahren ist durch DSB/Personal zu bestätigen.
