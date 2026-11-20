# Fragen an AGCO zum Teilekatalog

Zur Weitergabe durch den Teiledienst an den AGCO-Ansprechpartner. Hintergrund: Die Monteure der Schröder-Gruppe
suchen Ersatzteile im AGCO-Teilekatalog (`parts.agcocorp.com`) und übernehmen die Teilenummern in die Werkstatt-App
(Entnahme bzw. Bestellung über Business Central). Die App liest den Katalog **nicht** aus – kein Crawling, kein
automatisierter Abruf. Wir möchten die Übernahme für die Monteure vereinfachen und fragen deshalb:

1. **Warenkorb-Rückgabe (Punch-out):** Bietet der AGCO-Katalog für Händler eine Übergabe ausgewählter Teile an ein
   Händlersystem an – z. B. nach dem OCI-Standard (SAP Open Catalog Interface) oder cXML Punch-out? Ablauf bei uns:
   die App öffnet den Katalog mit einer Rücksprungadresse, der Monteur wählt Teile und Mengen, der Katalog sendet
   die Auswahl an die App zurück.
2. **Suchadresse:** Gibt es ein unterstütztes Adressformat, mit dem wir den Katalog direkt mit einer Teilenummer
   bzw. Maschinen-Seriennummer öffnen dürfen (Beispiel: `…/search?q=<Nummer>`)?
3. **Export:** Können Händler eine Merkliste / einen Warenkorb aus dem Katalog als Datei (CSV/Excel) oder über
   eine Schnittstelle an ihr Warenwirtschaftssystem übergeben (z. B. an Business Central)?
4. **Stammdaten (MDI):** Welche Produkt- und Preisdaten stellt AGCO über die MDI-Anbindung bereit, und in welchem
   Turnus? (Wir würden sie in den BC-Artikelstamm übernehmen, damit die App sie offline findet.)
5. **Einverständnis:** Ist der Absprung aus der Werkstatt-App in den Katalog (neues Fenster, normale Anmeldung des
   Monteurs) aus Sicht von AGCO in Ordnung?

Ansprechpartner Schröder: Teiledienst. Technische Rückfragen: IT / Projektteam Werkstatt-App.
