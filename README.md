# Urlaubskalender

Persönlicher Urlaubskalender für Windows, iPhone und iPad. Die Programmdateien laufen über GitHub Pages. Kalenderdaten werden nach der Anmeldung automatisch über Firebase Authentication und Cloud Firestore synchronisiert.

## Enthaltene Funktionen

- Jahresurlaub und Resturlaub
- automatische Berechnung der verbrauchten und verbleibenden Urlaubstage
- ganze und halbe Urlaubstage
- Status geplant, beantragt, genehmigt und genommen
- Feiertage in Niedersachsen
- individuelle Arbeitstage
- wiederkehrende freie Tage und Serientermine
- freie Tage der Partnerin
- Krank, Samstagsarbeit und Ausgleichsfrei
- Jahres-, Monats- und Wochenansicht
- einzelne Termine einer Serie verschieben, ausnehmen oder zurücksetzen
- automatische Synchronisierung zwischen PC, iPhone und iPad
- Offline-Zwischenspeicherung im Browser
- zusätzliche Sicherung und Wiederherstellung als JSON-Datei
- Installation als Web-App auf iPhone und iPad

## Erste Anmeldung und Datenübernahme

1. Die aktualisierten Dateien in das bestehende GitHub-Repository hochladen.
2. Den Kalender zuerst auf dem Windows-PC öffnen, auf dem die aktuellen Daten gespeichert sind.
3. Auf `Anmelden` klicken und den in Firebase Authentication angelegten Benutzer verwenden.
4. Wenn Firebase noch leer ist, die Frage zum Hochladen der lokalen Daten mit `OK` bestätigen.
5. Warten, bis `Automatisch synchronisiert` angezeigt wird.
6. Danach den Kalender auf iPhone und iPad aktualisieren und dort mit demselben Konto anmelden.

## Datenspeicherung

Die Daten werden getrennt gespeichert:

- `users/{uid}/settings/main`
- `users/{uid}/entries/{entryId}`
- `users/{uid}/series/{seriesId}`

Dadurch überschreiben Änderungen an verschiedenen Einträgen oder Serien einander nicht. Wird exakt derselbe Eintrag gleichzeitig auf zwei Geräten verändert, gilt die zuletzt gespeicherte Fassung.

## GitHub Pages aktualisieren

Alle Dateien und den Ordner `icons` in das bestehende Repository hochladen und vorhandene Dateien ersetzen. GitHub Pages veröffentlicht das Update anschließend automatisch.

## Notfallsicherung

Die JSON-Sicherung bleibt erhalten. Über `Sicherung speichern` kann jederzeit eine vollständige Kopie erstellt werden. Beim Einlesen einer Sicherung wird der Datenstand nach Bestätigung auch mit Firebase abgeglichen.
