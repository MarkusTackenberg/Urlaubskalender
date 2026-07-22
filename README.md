# Urlaubskalender

Persönlicher Urlaubskalender für Windows, iPhone und iPad. Das Programm läuft als statische Web-App auf GitHub Pages. Die Kalenderdaten werden zuerst lokal auf dem jeweiligen Gerät gespeichert und können zusätzlich über OneDrive zwischen den Geräten abgeglichen werden.

## Enthaltene Funktionen

- Jahresurlaub und Resturlaub je Kalenderjahr
- automatische Berechnung der verbleibenden Urlaubstage
- halbe Urlaubstage
- geplante, beantragte, genehmigte und genommene Urlaubstage
- gesetzliche Feiertage in Niedersachsen
- frei wählbare regelmäßige Arbeitstage
- Serientermine, zum Beispiel jeder oder jeder zweite Montag frei
- freie Tage der Partnerin
- Anzeige gemeinsamer freier Tage
- lokale Speicherung, JSON-Sicherung und OneDrive-Synchronisierung
- Schutz vor dem unbemerkten Überschreiben neuerer Daten auf einem anderen Gerät
- Druckansicht
- installierbar auf dem Home-Bildschirm von iPhone und iPad

## 1. Veröffentlichung mit GitHub Pages

1. Bei GitHub ein neues **öffentliches** Repository anlegen, zum Beispiel `urlaubskalender`.
2. Alle Dateien aus diesem Ordner einschließlich `.nojekyll` hochladen.
3. Im Repository `Settings` öffnen.
4. Links `Pages` wählen.
5. Unter `Build and deployment` als Quelle `Deploy from a branch` wählen.
6. Branch `main`, Ordner `/(root)` wählen und speichern.
7. Die angezeigte Adresse öffnen, zum Beispiel `https://DEINNAME.github.io/urlaubskalender/`.

GitHub stellt dabei nur das Programm bereit. Persönliche Urlaubsdaten gehören nicht in das Repository und werden von diesem Programm dort auch nicht gespeichert.

## 2. Microsoft-App für OneDrive anlegen

Die Microsoft-Einrichtung erfolgt erst, nachdem die endgültige GitHub-Pages-Adresse feststeht.

1. Das Microsoft Entra Admin Center öffnen.
2. `App registrations` beziehungsweise `App-Registrierungen` öffnen und `New registration` wählen.
3. Name: `Urlaubskalender`.
4. Als unterstützte Kontotypen persönliche Microsoft-Konten sowie Konten in beliebigen Organisationsverzeichnissen zulassen.
5. Die App registrieren.
6. Die `Application (client) ID` kopieren.
7. Unter `Authentication` eine Plattform `Single-page application` hinzufügen.
8. Als Redirect URI genau die GitHub-Pages-Adresse eintragen, einschließlich des abschließenden `/`.
9. Unter `API permissions` → `Add a permission` → `Microsoft Graph` → `Delegated permissions` die benötigte Berechtigung hinzufügen:
   - privates OneDrive: `Files.ReadWrite.AppFolder`
   - OneDrive for Business: `Files.ReadWrite`
10. Den Urlaubskalender öffnen, Menü → `OneDrive-Einrichtung`, Kontotyp auswählen, Client-ID eintragen und speichern.
11. `OneDrive verbinden` anklicken und der angezeigten Berechtigung zustimmen.

Für die App-Registrierung ist ein Microsoft-Entra-Verzeichnis erforderlich. Ist noch keines vorhanden, kann Microsoft dafür die Einrichtung eines kostenlosen Azure-Kontos beziehungsweise eines kostenlosen Verzeichnisses verlangen. Für den Urlaubskalender werden keine kostenpflichtigen Azure-Dienste angelegt.

### Wichtig bei mehreren Geräten

Die Client-ID wird aus Sicherheits- und Einfachheitsgründen nicht im öffentlichen Programmcode hinterlegt. Sie muss deshalb auf jedem Gerät einmal eingetragen werden. Danach lädt der Kalender auf PC, iPhone und iPad dieselbe Datei aus OneDrive.

Bei einem privaten Microsoft-Konto erhält die Anwendung nur Zugriff auf ihren eigenen OneDrive-App-Ordner. Bei einem Geschäftskonto verlangt Microsoft derzeit die breitere delegierte Berechtigung `Files.ReadWrite`; der Programmcode verwendet trotzdem ausschließlich den App-Ordner.

## 3. iPhone und iPad

1. Die GitHub-Pages-Adresse in Safari öffnen.
2. Das Teilen-Symbol antippen.
3. `Zum Home-Bildschirm` wählen.
4. Den Kalender künftig über das neue Symbol starten.
5. Im installierten Kalender einmal die Client-ID eintragen und OneDrive verbinden.

## 4. Datensicherheit und Sicherungen

Die Daten werden in zwei Ebenen gehalten:

1. lokal im Browser beziehungsweise in der installierten Web-App
2. nach der Anmeldung als `urlaubskalender.json` im OneDrive-App-Ordner

Vor dem Speichern prüft der Kalender, ob die OneDrive-Datei zwischenzeitlich auf einem anderen Gerät geändert wurde. Bei einem Konflikt wird die automatische Speicherung angehalten und du entscheidest, welcher Stand übernommen wird.

Über das Menü kann jederzeit eine zusätzliche JSON-Sicherung heruntergeladen und später wieder eingelesen werden. Diese Sicherung sollte gelegentlich ebenfalls in OneDrive abgelegt werden.

## 5. Bedienung in Kürze

- Über `Einstellungen` Jahresurlaub, Resturlaub, Namen und normale Arbeitstage festlegen.
- Einen einzelnen Urlaub oder freien Zeitraum über `Eintrag` anlegen.
- Wiederkehrende freie Montage oder Frederikes regelmäßige freie Tage über `Serie` anlegen.
- Urlaubstage werden nur für reguläre Arbeitstage gezählt. Wochenenden, niedersächsische Feiertage und eigene freie Tage werden automatisch abgezogen.
- Durch Anklicken eines Kalendertages wird ein neuer Eintrag bereits mit diesem Datum geöffnet.

## 6. Wechsel des Hosting-Anbieters

Die persönlichen Daten liegen nicht bei GitHub. Wird die Web-App später zu einem anderen Anbieter verschoben, bleibt die OneDrive-Datei erhalten. In der Microsoft-App-Registrierung muss dann nur die neue Webadresse als zusätzliche Redirect URI eingetragen werden. Vor einem Umzug sollte trotzdem immer eine JSON-Sicherung heruntergeladen werden.
