# Urlaubskalender

Persönlicher Urlaubskalender für Windows, iPhone und iPad. Die Web-App läuft kostenlos auf GitHub Pages. Die Daten werden auf jedem Gerät lokal gespeichert und können über eine JSON-Sicherungsdatei in OneDrive zwischen den Geräten übertragen werden. Eine Microsoft-App-Registrierung, Entra, Supabase oder Cloudflare ist nicht nötig.

## Enthaltene Funktionen

- Jahresurlaub und Resturlaub
- automatische Berechnung der verbrauchten und verbleibenden Urlaubstage
- ganze und halbe Urlaubstage
- geplant, beantragt, genehmigt und genommen
- Feiertage in Niedersachsen
- individuelle Arbeitstage
- wiederkehrende freie Tage und Serientermine
- freie Tage der Partnerin
- zusätzliche Eintragsarten: Krank, Samstagsarbeit und Ausgleichsfrei
- Anzeige gemeinsamer freier Zeiträume
- umschaltbare Jahres-, Monats- und Wochenansicht
- einzelne Termine einer Serie verschieben, ausnehmen oder zurücksetzen
- Jahresübersicht und Druckansicht
- lokale Speicherung im Browser
- Sicherung und Wiederherstellung über eine JSON-Datei
- als Web-App auf iPhone und iPad installierbar

## Daten auf mehreren Geräten verwenden

Der Kalender synchronisiert nicht automatisch. Dadurch entstehen keine Kosten und es ist keine Microsoft-App-Registrierung nötig.

1. Änderungen auf einem Gerät vornehmen.
2. `Sicherung speichern` wählen.
3. Die Datei `Urlaubskalender-Daten.json` in OneDrive speichern und eine ältere Datei ersetzen.
4. Auf dem anderen Gerät zuerst `Daten laden` wählen.
5. Die Datei aus OneDrive auswählen.
6. Erst danach auf diesem Gerät Änderungen vornehmen.

Wichtig: Nicht gleichzeitig auf mehreren Geräten verschiedene Änderungen vornehmen. Es gibt nur eine vollständige Sicherungsdatei; beim Einlesen ersetzt sie den lokalen Stand.

### Windows

Beim Speichern öffnet sich in aktuellen Chromium-Browsern normalerweise ein Speichern-Dialog. Als Ziel kann ein synchronisierter OneDrive-Ordner gewählt werden.

### iPhone und iPad

Beim Speichern öffnet sich das Teilen-Menü. `In Dateien sichern` wählen, OneDrive öffnen und die vorhandene Datei ersetzen. Zum Laden kann die Datei über die Dateien-App direkt aus OneDrive ausgewählt werden.

## GitHub Pages aktualisieren

Die Dateien `index.html`, `app.js`, `styles.css`, `service-worker.js`, `manifest.webmanifest` und `README.md` in das bestehende Repository hochladen und die vorhandenen Dateien ersetzen. GitHub Pages veröffentlicht die Änderung anschließend automatisch.

## Datenschutz

GitHub enthält nur den Programmcode. Persönliche Urlaubsdaten werden nicht in das öffentliche Repository übertragen. Sie liegen lokal im Browser und in der Sicherungsdatei, die der Nutzer selbst in OneDrive ablegt.


## Kalenderansichten

Oben kann zwischen `Jahr`, `Monat` und `Woche` umgeschaltet werden. In der Monats- und Wochenansicht werden die Bezeichnungen der Einträge direkt im Kalender angezeigt. Mit den Pfeiltasten wird je nach Ansicht ein Jahr, ein Monat oder eine Woche vor- beziehungsweise zurückgeschaltet.

## Einzelnen Termin einer Serie verschieben

Den betreffenden Tag im Kalender öffnen, beim Serientermin `Ausnahme bearbeiten` wählen und den neuen Tag eintragen. Nur dieser eine Termin wird verschoben. Am ursprünglichen Tag bleibt ein Hinweis stehen, damit die Änderung nachvollziehbar ist. Die Ausnahme kann später zurückgesetzt werden.

## Neue Eintragsarten

- `Krank`: wird im Kalender angezeigt und nicht vom Urlaubskonto abgezogen.
- `Samstagsarbeit`: wird im Kalender angezeigt und nicht vom Urlaubskonto abgezogen. An diesem Tag gilt der Nutzer in der Anzeige gemeinsamer freier Tage nicht als frei.
- `Ausgleichsfrei`: wird nicht vom Urlaubskonto abgezogen und wie ein eigener freier Tag behandelt. Liegt dieser Tag in einem längeren Urlaubszeitraum, wird dafür kein zusätzlicher Urlaubstag gezählt.
