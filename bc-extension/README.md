# AL-Extension „Schroeder Werkstatt API“

Per-Tenant-Extension (PTE) für Business Central. Stellt die Endpunkte bereit, die die Monteur-App braucht und die in der Standard-API v2.0 fehlen.

- Endpunkt-Präfix: `/api/schroeder/werkstatt/v1.0/companies({id})/…`
- Feldnamen entsprechen exakt dem Vertrag in `packages/bc-contract/src/index.ts`.
- **Kein Buchungscode.** Die Extension legt nur Zeilen an (Servicezeilen, Zuordnungen, Kommentare, Abwesenheiten, ungebuchte Buch.-Blatt-Zeilen). Lieferung, Rechnung und Buch.-Blatt-Buchung bleiben in BC.

## Struktur

```
app.json
src/Table/WSDeletedRecord.Table.al            Löschprotokoll (50100)
src/TableExt/*.TableExt.al                    Feld "Monteur App Id" + Schlüssel an 5902, 5950, 5906, 5207, 207, 83
src/Codeunit/WSDeletedRecordLog.Codeunit.al   Event-Subscriber OnAfterDelete → Löschprotokoll
src/Codeunit/WSDeletedRecordCleanup.Codeunit.al  Aufgabenwarteschlange: Protokoll > 30 Tage löschen
src/Codeunit/WSApiHelper.Codeunit.al          Zeilennummern, Kommentartexte, Pflichtprüfung Idempotenz-ID
src/Page/WSApi*.Page.al                        API-Pages (50100–50116)
src/Query/WSItemAvailability.Query.al         Bestand je Artikel und Lagerort (API-Query)
src/PermissionSet/WSWerkstattApi.PermissionSet.al  Berechtigungssatz "WS WERKSTATT API"
test/requests.http                            Beispielaufrufe (VS Code REST Client)
```

## Endpunkte

| Entity Set                | Quelle                                                              | Schreiben                           |
| ------------------------- | ------------------------------------------------------------------- | ----------------------------------- |
| `serviceOrders`           | 5900 Service Header (Belegart Auftrag)                              | PATCH nur `status` (mit `If-Match`) |
| `serviceOrderItems`       | 5901 Service Item Line                                              | –                                   |
| `serviceItems`            | 5940 Service Item                                                   | –                                   |
| `resources`               | 156 Resource                                                        | –                                   |
| `serviceOrderTypes`       | 5903 Service Order Type                                             | –                                   |
| `responsibilityCenters`   | 5714 Responsibility Center                                          | –                                   |
| `causesOfAbsence`         | 5206 Cause of Absence                                               | –                                   |
| `workTypes`               | 200 Work Type                                                       | –                                   |
| `itemReferences`          | 5777 Item Reference                                                 | –                                   |
| `itemAvailabilities`      | Query über 32 Item Ledger Entry (Summe Menge je Artikel × Lagerort) | –                                   |
| `serviceOrderAllocations` | 5950 Service Order Allocation                                       | POST                                |
| `serviceLines`            | 5902 Service Line (Belegart Auftrag)                                | POST                                |
| `serviceCommentLines`     | 5906 Service Comment Line (Service Header, Auftrag)                 | POST                                |
| `employeeAbsences`        | 5207 Employee Absence                                               | POST, DELETE (Storno)               |
| `resourceJournalLines`    | 207 Res. Journal Line                                               | POST                                |
| `itemJournalLines`        | 83 Item Journal Line                                                | POST                                |
| `postedServiceInvoices`   | 5992 Service Invoice Header                                         | –                                   |
| `deletedRecords`          | 50100 WS Deleted Record                                             | –                                   |

### Idempotenz

Jede schreibbare Page verlangt `monteurAppId` (GUID, = Buchungs-ID der App). Existiert bereits ein Datensatz mit dieser ID, wird **dieser** zurückgegeben und nichts neu angelegt. Ein Retry nach Timeout ist dadurch gefahrlos.

### Validierungsreihenfolge

Die Felder werden in der Reihenfolge validiert, in der sie auf der Page stehen (nicht in der Reihenfolge im JSON). Die Pages sind deshalb so sortiert, dass z. B. bei Servicezeilen Belegnr. → Serviceartikelzeile → Art → Nr. → Lagerort → Menge → Einheit → Arbeitstyp validiert werden. Beim Ändern der Pages diese Reihenfolge beibehalten.

### Entscheidungen und Annahmen in der Extension

- **Bestand je Lagerort** als API-**Query** (serverseitige Summe über Artikelposten). Queries unterstützen keine Webhooks und kein `lastModifiedDateTime`-Delta im eigentlichen Sinn; die App fragt den Bestand periodisch bzw. bei Bedarf ab. `lastModifiedDateTime` ist das jüngste `SystemModifiedAt` der Posten.
- **Arbeitsbeschreibung:** Der Service Header hat (anders als der Verkaufskopf) im Standard kein Feld „Arbeitsbeschreibung“. `workDescription` liefert die Kommentarzeilen vom Typ „Allgemein“ auf Kopfebene. Gibt es im Mandanten ein eigenes Feld, wird es hier angebunden.
- **Fehlerbeschreibung** (`faultComment`): zusammengesetzt aus den Kommentarzeilen vom Typ „Fehler“ der Serviceartikelzeile.
- **Mobilnummer:** `mobilePhoneNumber` = „Telefon 2“ des Serviceauftrags (im Mandanten prüfen).
- **Betriebsstunden** (`operatingHours`): kein Standardfeld. Liefert vorerst 0 (= unbekannt), siehe OFFENE-PUNKTE OP-20. Im Mandanten vorhandenes Feld (Branchenlösung oder eigene Erweiterung) in `WSApiServiceItems.Page.al` anbinden.
- **Marke** (`manufacturerCode`): Herstellercode des verknüpften Artikels.
- **Leere Optionswerte:** BC serialisiert eine leere Option als `"_x0020_"` und leere Datumswerte als `"0001-01-01"`. Der Connector der App normalisiert das.
- **Webhooks:** `ChangeTrackingAllowed = true` an `serviceOrders`, `serviceOrderItems`, `serviceLines`, `serviceOrderAllocations`, `serviceCommentLines`, `employeeAbsences`.

## ID-Bereich

`50100–50199` ist ein **Platzhalter**. Der Bereich muss mit dem BC-Partner abgestimmt werden, damit er nicht mit vorhandenen PTEs kollidiert. Ebenso das Feld-ID 50100 in den Tabellenerweiterungen.

## Kompilieren und installieren

In dieser Entwicklungsumgebung gibt es keinen AL-Compiler. Die Extension muss **einmal in VS Code gegen die Symbole des Mandanten kompiliert** werden; dabei fallen eventuelle Abweichungen bei Feldnamen der installierten BC-Version oder von Branchenlösungen auf.

1. VS Code mit der Erweiterung „AL Language“ installieren.
2. `bc-extension/.vscode/launch.json` anlegen (Befehl „AL: Go!“ → Microsoft Cloud Sandbox) mit `environmentName` der Sandbox und `tenant`.
3. „AL: Download Symbols“ ausführen.
4. Build (`Ctrl+Shift+B`) – Warnungen prüfen, Fehler beheben.
5. In die **Sandbox** veröffentlichen: `F5` bzw. „AL: Publish without debugging“.
6. Berechtigungssatz `WS WERKSTATT API` der Entra-Anwendung zuweisen (siehe `docs/SETUP-BC.md`).
7. Mit `test/requests.http` testen (insbesondere: gleiche Servicezeile zweimal senden → nur eine Zeile).
8. Aufgabenwarteschlangenposten für Codeunit 50101 „WS Deleted Record Cleanup“ anlegen (täglich).
9. **Produktion:** Die kompilierte `.app` in BC über _Erweiterungsverwaltung → Verwalten → Erweiterung hochladen_ als Per-Tenant-Extension bereitstellen (Bereitstellen für: aktuelle Version). Im Business Central Admin Center ist die installierte Extension danach unter der Umgebung sichtbar. Alternativ später Bereitstellung per AL-Go for GitHub.
10. Versionswechsel: `version` in `app.json` erhöhen; Schemaänderungen nur additiv (Felder/Tabellen nicht löschen, sondern `ObsoleteState` setzen).
