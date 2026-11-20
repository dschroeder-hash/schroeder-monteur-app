# Fragen an IT, BC-Partner und Service

Stand 21.11.2026. Die App ist für alle Punkte gebaut und gegen einen Testersatz geprüft. Damit sie mit den echten
Systemen läuft, fehlen diese Angaben. Details zu jeder Frage stehen in `OFFENE-PUNKTE.md`.

## Service (Bianca)

1. **Servicecheckliste (OP-44):** Bitte die Feldarten je Zeile prüfen. Sie sind aus den Screenshots abgeleitet und
   stehen in `packages/shared/src/report/yellow-card.ts`. Zu prüfen sind:
   - Häkchen oder nicht;
   - Antwort als Text, Zahl oder Auswahl;
   - welche Einheiten zur Auswahl stehen;
   - welche Zeilen Pflicht sind (bisher nur die 12 Fragen „Checkliste für das Reparaturende“).
2. **Auswahllisten:** Welche Werte stehen bei „Auswahl Motoröl“, „Auswahl Getriebe- und Hydrauliköl“,
   „Auswahl Frostschutz“ und „Auswahl Fette“ zur Wahl? Kommen sie aus BC, etwa aus Artikeln?
3. **Werkstatt-PC (OP-49):** Welche Personalnummer tippen die Mitarbeiter heute ein? Sollen am PC später auch
   Bericht, Checkliste, Material und Fotos erfasst werden?

## BC-Partner

4. **Checklisten-Erweiterung (OP-44):** Wie heißen Tabelle und Felder der „Servicecheckliste (gelbe Karte)“?
   Die API-Seite ist als Vorlage vorbereitet (`bc-extension/templates/WSApiServiceChecklistLines.Page.al.txt`) und
   muss nur noch auf die Tabelle zeigen.
5. **Werkstattplaner-Modul (OP-43):** Welches Zusatzmodul wird für die Planung genutzt, und welche Tabellen oder
   welche API hat es? Bis dahin liest die App die Standard-Ressourcenzuordnungen.
6. **Dokumentanhänge am Serviceauftrag (OP-45):** Sind sie in eurer BC-Version sichtbar? Der unterschriebene
   Werkstattauftrag wird als PDF dort abgelegt.
7. **Nachfolgeartikel (OP-47):** Werden sie über den Artikelersatz gepflegt oder über ein eigenes Feld?
8. **Stempel-PIN:** Ist die vierstellige PIN in BC gespeichert? Wenn ja, wo? Dann könnte die App sie einmalig
   übernehmen, statt dass alle eine neue PIN festlegen.
9. **Neue API-Seiten einspielen:**
   - 50117 Anhänge
   - 50118–50120 Bemerkungen und Kontakte
   - 50121 Artikelersatz

   Beschreibung in `bc-extension/README.md`.

## IT

10. **M-Files (OP-48):**
    - Server-URL und Tresor-GUID;
    - Dienstkonto (oder Anmeldung über Entra);
    - Objekttyp „Maschine“ und die Eigenschaft, in der die BC-Serviceartikelnummer steht;
    - Klasse für Fotos;
    - Verweis-Eigenschaft auf die Maschine;
    - Eigenschaft für die Auftragsnummer;
    - ist M-Files aus Azure (Germany West Central) erreichbar?
11. **Entra:**
    - App-Rolle `Werkstatt.Terminal` anlegen;
    - je Standort ein Konto für den Werkstatt-PC anlegen;
    - Conditional Access für diese PCs festlegen: feste Geräte, keine wiederholte MFA-Abfrage.
12. **Mitarbeiter ohne Microsoft-Konto:** Wer legt sie in der App an (Name, Personalnummer, Standort)?
