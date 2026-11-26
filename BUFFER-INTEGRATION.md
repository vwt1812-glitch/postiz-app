# Buffer-Fork für das Stadtratsbüro

## Stand und Grenzen

Eigener Fork: https://github.com/vwt1812-glitch/postiz-app

Basis: offizieller Postiz-Commit `44df988cb1840dc5eb50755536b3e6e326d27fc3` vom 24.11.2026.
Die am 26.11.2026 ausschließlich lesend geprüfte bestehende Installation meldet `NEXT_PUBLIC_VERSION=v2.26.0` und verwendet `ghcr.io/gitroomhq/postiz-app:latest`, Image-ID `sha256:f751a73a7d7dedf6fce18faa74fd334177c28a29831121ee58ba53d92d9025a1`.
Ihre Datei `/app/version.txt` enthält weiterhin `v1.47.0` und identifiziert den Build nicht zuverlässig. Das Image hat keine Commit-Labels. Der genaue Quellcommit der Installation ist deshalb nicht belegt.

Die bestehende Installation, ihre Datenbanken, Volumes und der laufende Social-Bot wurden nicht umgestellt.
Die tatsächliche Buffer-Authentifizierung und Verfügbarkeit der drei Nutzerkanäle sind noch nicht geprüft: Der Nutzer hat den Key bisher ausschließlich kopiert und noch nicht lokal hinterlegt.
Es wurden keine echten Buffer-Beiträge erstellt. Erst nach gesonderter Zustimmung darf ein öffentlicher Testbeitrag veröffentlicht werden.

## Verhalten

- Separate Provider `x-buffer` und `tiktok-buffer`; beliebig viele autorisierte Kanal-IDs, vorgesehen sind zwei X- und ein TikTok-Kanal.
- Die Kanalauswahl lädt die freigegebenen Buffer-Kanäle automatisch vom Server. Jeder Kanal bleibt eine eigene Postiz-Integration und kann einem Kunden zugeordnet werden.
- Nur die konfigurierte Postiz-Organisation darf den serverseitigen Buffer-Zugang verwenden. Die Zulassung wird beim Verbinden, im Callback, bei der Kanalsuche und vor der Veröffentlichung geprüft.
- Der API-Key bleibt serverseitig. In Postiz wird nur ein Platzhalter gespeichert. Key-Rotation erfolgt über die Secret-Datei, ohne Tokens in Kanälen auszutauschen.
- Entwürfe, Planung, Verschieben und Löschen vor dem Versand bleiben bei Postiz. Erst beim Fälligkeitstermin wird `createPost` mit `mode: shareNow` und `schedulingType: automatic` aufgerufen. Buffer übernimmt keine zusätzliche Warteschlange.
- Eine erfolgreiche Annahme bleibt `pending`. Ausschließlich `status: sent` bei automatischer Veröffentlichung wird erfolgreich; Fehler, Entwürfe, Freigabeanforderungen und manuelle Erinnerungen werden nicht als veröffentlicht ausgewiesen.
- Das vorhandene Postiz-Workflow-Limit für Statusabfragen beträgt ungefähr 30 Minuten. Danach bleibt eine unbestätigte Sendung zur manuellen Prüfung; es gibt keine erneute Erstellung bei Buffer.
- Vor jeder Erstellung reserviert PostgreSQL einen eindeutigen Zustellschlüssel. Dieser Eintrag bleibt auch nach Löschen eines Posts erhalten. Bei gleichzeitigen Versuchen darf nur einer senden. Verlorene Antworten, HTTP 429/5xx und ein fehlgeschlagenes Speichern der Empfangsbestätigung werden vorsichtig blockiert. Auch eindeutig abgelehnte Mutationen werden nicht automatisch wiederholt.
- Bei unbestätigtem Ausgang zuerst Buffer prüfen. Einen neuen Post erst nach manueller Klärung erstellen. Datenbank-Rollbacks können Zustellnachweise verlieren; deshalb bei Wiederherstellungen alle seit der Sicherung versendeten Beiträge abgleichen und die Tabelle `BufferDelivery` erhalten.

## Unterstützter Inhalt

X: Text bis 280 gewichtete Zeichen, bis zu vier Bilder oder ein Video. TikTok: genau ein MP4-Video, Beschreibung bis 2200 Zeichen. AI-Kennzeichnung wird übertragen.
Threads, Antworten, Umfragen, Reposts, X-Premium-Längen, TikTok-Fotogalerien und zusätzliche direkte TikTok-Einstellungen sind noch nicht unterstützt. Solche Einstellungen werden abgelehnt, statt still ignoriert zu werden.
Die Buffer-API bietet in der geprüften TikTok-Metadatenstruktur nur Titel für Fotobeiträge und AI-Kennzeichnung; Sichtbarkeit, Kommentare, Duett und Stitch werden hier nicht als vermeintlich steuerbare Funktionen angeboten.

Medien benötigen dauerhafte öffentliche HTTPS-Dateiadressen auf explizit freigegebenen Ursprüngen. URLs mit Zugangsdaten, Query-Parametern oder Fragmenten werden abgelehnt. Vor dem Versand erfolgt eine authentifizierungsfreie HEAD-Prüfung mit SSRF-Schutz, ohne Weiterleitungen. Signierte Ablauf-URLs und reine lokale Test-Uploads funktionieren damit nicht. Ein erlaubter Medienhost muss HEAD und den passenden Content-Type liefern. Die Erreichbarkeit von Buffer selbst lässt sich erst mit autorisierten echten Tests nachweisen.

## Key lokal hinterlegen und nur lesend prüfen

Unter Windows `scripts/save-buffer-key.ps1` ausführen und den Key ausschließlich in dessen verdeckte lokale Eingabe einfügen. Die Datei `.secrets/buffer-api-key` wird für das aktuelle Windows-Konto geschützt und von Git und Docker-Builds ausgeschlossen.

Danach in PowerShell:

```powershell
$env:BUFFER_API_KEY_FILE = (Resolve-Path .secrets/buffer-api-key).Path
node scripts/buffer-preflight.mjs
```

Dieses Skript führt ausschließlich Organisations- und Kanalabfragen durch. Es zeigt Kanal-IDs und Verfügbarkeitsmerkmale, aber keinen Schlüssel. Die gelisteten zwei X- und ein TikTok-Kanal müssen anschließend über `BUFFER_ORGANIZATION_ID` und `BUFFER_CHANNEL_IDS` freigegeben werden.

## Isolierte Installation

`.env.buffer.example` nach `.env.buffer` kopieren. Ein neues Test-JWT-Geheimnis setzen und einen tatsächlich erfolgreich gebauten Commit-Tag als `BUFFER_TEST_IMAGE` verwenden.
`docker compose --env-file .env.buffer -f compose.buffer-test.yaml up -d` erzeugt ausschließlich neue Ressourcen im Projekt `postiz-buffer-isolated`. Keine Dienste außer der Weboberfläche auf `127.0.0.1:5100` werden am Host veröffentlicht. Die Datei darf nicht mit produktiven Compose-Dateien kombiniert werden.
Vor der ersten Anmeldung Registrierung in dieser Testkonfiguration vorübergehend aktivieren und danach wieder deaktivieren. Die erzeugte Test-Organisations-ID als `BUFFER_POSTIZ_ORGANIZATION_ID` setzen und den Testcontainer neu erstellen. Die neue Tabelle wird ausschließlich in der neuen Testdatenbank angelegt.

Die Browser-Oberfläche kann lokal geprüft werden; der End-to-End-Medienversand erfordert zusätzlich einen öffentlichen Test-Medienhost. Für Tests niemals Produktionsdatenbanken importieren oder bestehende Container ersetzen.

## Social-Bot

Die getrennte Arbeitskopie `stadtrat-social-bot-buffer`, Branch `buffer-providers`, ergänzt Providerkennungen, Medienfilter, gewichtete X-Zeichen, TikTok-Hochformat und passende Einstellungen. Der Bot spricht weiter dieselbe Postiz-Public-API an. Die produktive Bot-Konfiguration bleibt unverändert.
Kanalzuordnungen müssen die neuen Postiz-Kanal-IDs verwenden; eine automatische Migration bestehender direkter X-/TikTok-Kanäle ist nicht eingerichtet. `MIGRATE_PROVIDERS` nicht ungeprüft setzen.

## Prüfen, bauen und Updates

`pnpm test:buffer` prüft mit simulierten API-Antworten Kanaltrennung, Status, Medien, Zugriffsgrenzen und unklare Zustellversuche. Der PostgreSQL-Konkurrenztest läuft mit `BUFFER_TEST_DATABASE=true` ausschließlich gegen eine leere Testdatenbank. GitHub Actions stellt diese selbst bereit.
Der Workflow `buffer-ci.yml` führt Tests, eine Typprüfung und vollständige Docker-Builds auf nativen AMD64- und ARM64-Runnern durch. Nur erfolgreiche Push-/manuell gestartete Builds veröffentlichen Commit-Tags in der eigenen GHCR-Ablage; Pull Requests veröffentlichen kein Image. Es gibt keinen Deployment-Schritt und kein Überschreiben eines produktiven `latest`-Tags.

`buffer-upstream-sync.yml` prüft täglich Upstream und erstellt einen Review-PR. Konflikte stoppen den Workflow. Tests und beide Docker-Builds werden explizit gestartet, weil durch `GITHUB_TOKEN` eröffnete PRs keine weiteren Workflows auslösen. GitHub muss dem Actions-Token das Erstellen von Pull Requests erlauben. Es gibt kein Auto-Merge und keine automatische Installation.

## Offizielle API-Quellen

- https://developers.buffer.com/guides/authentication.html
- https://developers.buffer.com/guides/posts-and-scheduling.md
- https://developers.buffer.com/guides/hosting-media.md
- https://developers.buffer.com/types/Channel.md
- https://developers.buffer.com/types/CreatePostInput.md
- https://developers.buffer.com/types/Post.md
- https://developers.buffer.com/types/TikTokPostMetadataInput.md
