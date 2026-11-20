# App auf dem iPad einrichten

Die Monteur-App ist eine Web-App (PWA). Sie wird nicht über den App Store installiert, sondern als Symbol auf den
Home-Bildschirm gelegt. **Das ist auf dem iPad Pflicht**, nicht nur Komfort – siehe Abschnitt 2.

## 1. Voraussetzungen

| Punkt                 | Anforderung                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| iPadOS                | **16.4 oder neuer** (Push-Benachrichtigungen für Web-Apps gibt es erst ab 16.4), empfohlen aktuell     |
| Geräteverwaltung      | Verwaltet per MDM (z. B. Intune), Code-Sperre und Geräteverschlüsselung aktiv (`DATENSCHUTZ.md`)       |
| Anmeldung             | Microsoft Authenticator mit „Enterprise SSO“-Erweiterung empfohlen – dann ohne erneute Passworteingabe |
| Kamera / Mitteilungen | Werden beim ersten Scan bzw. beim Aktivieren der Hinweise in der App abgefragt                         |

## 2. Warum der Home-Bildschirm Pflicht ist

- **Offline-Daten:** Safari löscht gespeicherte Website-Daten, wenn eine Website **7 Tage nicht genutzt** wurde
  (z. B. nach dem Urlaub). Noch nicht übertragene Stempelungen, Berichte oder Fotos wären dann verloren. Für Apps
  auf dem Home-Bildschirm gilt diese Regel nicht.
- **Push-Benachrichtigungen** (Chat, Freigaben, Abwesenheiten) erlaubt iPadOS nur Apps auf dem Home-Bildschirm.
- **Vollbild:** ohne Adressleiste, mehr Platz für Plantafel und Aufträge.

Die App zeigt im normalen Safari-Tab einen Hinweis, sie zum Home-Bildschirm hinzuzufügen.

## 3. Verteilung durch die IT (empfohlen)

Im MDM ein **Web-Clip** anlegen und den Geräten bzw. der Gruppe „Werkstatt“ zuweisen:

| Einstellung      | Wert                                             |
| ---------------- | ------------------------------------------------ |
| Bezeichnung      | Werkstatt                                        |
| URL              | Adresse der App (Produktion, siehe `BETRIEB.md`) |
| Symbol           | `app/public/icons/icon-512.png`                  |
| Als Vollbild-App | **ja** (in Intune: „Vollbild“ / „Full screen“)   |
| Entfernbar       | nein                                             |

Zusätzlich empfohlen: Safari-Einstellung „Website-Tracking verhindern“ unverändert lassen; „Alle Cookies blockieren“
darf **nicht** aktiv sein (sonst scheitert die Microsoft-Anmeldung).

## 4. Manuelle Einrichtung (ein Gerät, z. B. Pilot)

1. Safari öffnen und die Adresse der App aufrufen.
2. Oben rechts auf **Teilen** (Quadrat mit Pfeil) tippen.
3. **Zum Home-Bildschirm** wählen, Name „Werkstatt“ lassen, **Hinzufügen**.
4. Die App **über das neue Symbol** öffnen (nicht wieder über Safari) und mit dem Firmenkonto anmelden.
5. Oben rechts auf die **Glocke** tippen, „Push-Benachrichtigungen aktivieren“ wählen und das Mitteilungs-Fenster bestätigen.

## 5. Bedienung auf dem iPad

- **Querformat:** links die Seitenleiste mit allen Bereichen, unten darin die Stempelknöpfe (Kommen, Pause, Gehen).
- **Hochformat:** schmale Symbolleiste links, Stempelknöpfe unten am Bildschirmrand.
- **AGCO-Katalog neben der App:** In „Teile“ den Knopf „AGCO-Katalog öffnen“ gedrückt halten und an den rechten
  Bildschirmrand ziehen – der Katalog öffnet sich daneben (Split View). Teilenummer im Katalog markieren und in den
  Bereich „Herstellerkatalog“ der App ziehen; mehrere markierte Zeilen ergeben eine Liste zum Auswählen. Ohne Split
  View: kopieren und „Teilenummer aus Zwischenablage“ tippen. Eine Web-App kann Split View nicht selbst öffnen –
  das erlaubt iPadOS nur über diese Geste.
- **Plantafel:** Auftrag kurz **gedrückt halten**, dann auf Monteur und Uhrzeit ziehen. Alternativ „Einplanen ohne
  Ziehen …“.
- **Abgleich:** Das iPad überträgt nur, solange die App geöffnet ist (iPadOS erlaubt Web-Apps keinen Abgleich im
  Hintergrund). Offline Erfasstes geht beim nächsten Öffnen mit Netz automatisch raus; der Zustand steht oben
  rechts („Online“, „Offline“, „Synchronisiere · n ausstehend“).
- **Diktat:** Die Spracheingabe von Safari ist auf dem iPad nicht immer verfügbar. Zuverlässig ist der Azure-
  Sprachdienst (Einstellung „Diktat“ im Admin-Bereich, `BETRIEB.md`).

## 6. Getestet

Automatisch in jeder Änderung (CI): iPad Pro 11 quer und hoch mit WebKit, der Technik von Safari (`e2e`,
Entscheidung E-65). Ausnahme sind die Flugmodus-Szenarien: Playwright kann den Offline-Zustand in WebKit
nicht nachbilden, ohne auch den Service Worker abzuschneiden. Sie laufen deshalb nur auf dem Smartphone-Profil
(Chromium). Das ersetzt nicht den Pilotbetrieb auf echten Geräten – bitte dort besonders prüfen: Arbeiten im
Flugmodus, Kamera-Scan, Ziehen auf der Plantafel, Anmeldung über die Microsoft-SSO-Erweiterung, Push nach Neustart.
