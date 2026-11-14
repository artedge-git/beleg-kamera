# Beleg-Kamera – Feature-Liste

Was die App kann, mit Version und Teststand. Nach jeder Änderung wird diese Liste geprüft.
„Browser“ = automatisch getestet in Chromium (Playwright, Dropbox nachgebaut). „iPhone“ = von Chris im Alltag bestätigt.

| Feature | seit | Teststand |
|---|---|---|
| Live-Sucher mit Rahmenerkennung (detect.js, Stand 1.0–1.4 + Plausibilitätsprüfung 1.12–1.14) | 1.0 | iPhone |
| Auto-Auslösung, wenn der Zettel ruhig im Bild liegt (Ring füllt sich, Gelb wird kräftiger) | 1.0 / 1.11 | iPhone (1.15); 1.16 Browser |
| Auto aus: keine Erkennung, ganzes Foto ohne Zuschnitt | 1.15 | Browser + iPhone |
| Nach einem Foto erst wieder auslösen, wenn die Kamera bewegt wurde | vor 1.14 | Browser (1.16) |
| Eckpunkte im Prüfbildschirm verschieben, Zettel wird gerade gezogen | 1.0 | iPhone |
| Etwas Rand um den erkannten Zettel (3,5 % je Seite) | 1.10 | iPhone |
| Lange Zettel in mehreren Stücken („+ Nächstes Stück“, Überlappung wird entfernt) | 1.0 | iPhone |
| Fotos aus der Mediathek | 1.0 | Browser |
| Licht (Taschenlampe), wo das Gerät es kann | vor 1.14 | nicht geprüft |
| Info für die Buchhaltung → `Beleg_….txt` neben dem Foto | 1.15 | Browser + iPhone |
| Direkter Upload in Dropbox `/_artedge eU/bookdesk/_Eingang` (OAuth PKCE) | 1.0 | iPhone |
| Offline-Warteschlange, Upload später (Foto und Info getrennt wiederholt) | 1.0 / 1.15 | Browser |
| Verlauf der letzten 25 Belege mit Status | 1.0 | iPhone |
| Debug-Anzeige (3× auf den Titel tippen) | vor 1.14 | nicht geprüft |
| Offline-Start (Service Worker) | 1.2 | nicht geprüft |

## Auto-Auslösung 1.16
- Haltezeit 1000 → 1500 ms (`HOLD_MS` in app.js).
- Die Haltezeit zählt erst, wenn die App „scharf“ ist. Bis 1.15 lief sie schon, während die App nach einem Foto noch auf eine Kamerabewegung gewartet hat. Dadurch konnte die App sofort nach der Bewegung auslösen.
- Rutscht der erkannte Rahmen noch um mehr als 6 % (`SHIFT`), beginnt die Haltezeit neu.
- Wackel-Erkennung (Schwelle „ruhig“) und Umrandung sind unverändert.
