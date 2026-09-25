# Splity – Architektur & Richtlinien

Splity ist eine selbst gehostete Web-Anwendung, die Videos **verlustfrei** (ohne Neukodierung, ohne Qualitätsverlust) in Sekundenschnelle in Teile schneidet. Sie läuft vollständig lokal in einem Docker-Container oder als Node.js-Prozess ohne jegliche Cloud-Dienste oder externe Aufrufe.

---

## 1. Tech-Stack

- **Frontend**: Vite + React 19 + TypeScript + Tailwind CSS v4 (`@tailwindcss/vite`) + `lucide-react` Icons.
- **Backend**: Node.js 22 + Express + TypeScript im selben Prozess. Express liefert in Produktion das kompilierte Frontend aus `dist/` aus und bedient `/api/*`. In der Entwicklung wird Vite als Middleware per dynamischem Import (`import('vite')`) eingebunden.
- **Videoverarbeitung**: System-Tools `ffmpeg` und `ffprobe`, ausschließlich aufgerufen per `child_process.spawn` mit strengen Argument-Arrays (kein Shell-String, kein `exec`, Schutz vor Injection und Sonderzeichen/Umlauten in Dateinamen).
- **Streaming-Uploads**: `busboy` direkt als Dateistream auf die Festplatte (Quellvideos sind oft mehrere GB groß; kein In-Memory-Puffern, kein `multer` MemoryStorage).
- **Persistenz**: Dateisystem (Eingang/ und Fertig/) + JSON-Dateien in `data/` (`jobs.json`, `settings.json`, Cache).
- **Sprache**: Benutzeroberfläche und Meldungen ausschließlich auf Deutsch.

---

## 2. Ordnerstruktur

```text
/
├── .dockerignore              Ausschlüsse für den Docker-Build
├── .env.example               Beispiel-Umgebungsvariable (SPLITY_PATH)
├── Dockerfile                 Multi-Stage Build (node:22-trixie-slim + ffmpeg 7.1)
├── docker-compose.yml         Docker-Service Definition (Port 3006:3000)
├── Makefile                   Setup-, Start- und Steuerungsbefehle
├── package.json               Abhängigkeiten und Scripts
├── tsconfig.json              Frontend TypeScript-Konfiguration
├── tsconfig.server.json       Backend TypeScript-Konfiguration
├── vite.config.ts             Vite & Tailwind Plugin Konfiguration
├── data/                      Cache (Probe-Ergebnisse, Thumbs) & Einstellungen
│   ├── cache/
│   │   └── thumbs/
│   ├── jobs.json              Persistierte Job-Warteschlange (letzte 50)
│   └── settings.json          Anwendungseinstellungen
├── splity/                    Sichtbarer Arbeitsordner (auf Host gemountet)
│   ├── Eingang/               Quellvideos (Uploads & manuell abgelegte Dateien)
│   └── Fertig/                Ausgabeordner (je Video ein eigener Unterordner)
├── server/                    Backend Quellcode
│   ├── config.ts              Pfade, Port, Statfs, Tool-Versionen
│   ├── index.ts               Express-Einstieg & Vite-Middleware
│   ├── jobs.ts                Job-Queue (immer 1 ffmpeg-Prozess gleichzeitig)
│   ├── types.ts               Gemeinsame Typdefinitionen
│   ├── media/
│   │   ├── plan.ts            Schnittplan-Berechnung (reine Funktion)
│   │   ├── plan.test.ts       Vitest Unit-Tests für planSplit
│   │   ├── probe.ts           ffprobe Metadaten & Keyframe-Erfassung (pts_time)
│   │   └── split.ts           ffmpeg Segment-Muxer Ausführung
│   └── routes/
│       ├── health.ts          /api/health
│       ├── jobs.ts            /api/jobs & SSE Eventstream
│       ├── settings.ts        /api/settings (GET / PUT)
│       └── videos.ts          /api/videos (Upload, Probe, Thumb, Plan, Split)
└── src/                       Frontend Quellcode (React)
    ├── App.tsx                Hauptkomponente mit Tabs & Drag-Drop-Steuerung
    ├── main.tsx               React Einstiegspunkt
    ├── types.ts               Frontend-Typdefinitionen
    ├── components/
    │   ├── CuttingProgress.tsx Fortschritt während des Schneidens (SSE)
    │   ├── DragOverlay.tsx     Vollflächiges Overlay bei Drag & Drop
    │   ├── Dropzone.tsx        Große Dropzone & Liste vorhandener Eingangsvideos
    │   ├── HistoryView.tsx     Tabelle bisheriger Jobs
    │   ├── ResultCard.tsx      Erfolgskarte mit erzeugten Teildateien & Pfadkopie
    │   ├── SettingsView.tsx    Einstellungen mit Live-Muster-Vorschau
    │   ├── Sidebar.tsx         Linke Navigation & Speicherplatz-Anzeige
    │   ├── Timeline.tsx        Zeitleiste mit Teilstücken & Keyframe-Strichen
    │   ├── Toast.tsx           Benachrichtigungstoasts unten rechts
    │   ├── UploadProgress.tsx  Streaming-Upload Fortschritt mit MB/s & Restzeit
    │   └── VideoDetail.tsx     Schnitt-Konfiguration & Vorschau-Thumbnails
    └── utils/
        └── format.ts          Formatierung von Bytes, Sekunden & Datumsangaben
```

---

## 3. Umgebungsvariablen

| Variable | Standardwert | Beschreibung |
|---|---|---|
| `PORT` | `3000` | Port des Express-Servers (in Docker auf `3006:3000` gemappt) |
| `DATA_DIR` | `./data` | Interner Cache, Jobs und Einstellungen |
| `SPLITY_DIR` | `./splity` | Basisordner mit `Eingang/` und `Fertig/` |
| `SPLITY_HOST_PATH` | Wert von `SPLITY_PATH` | Pfad auf dem Mac/Host-System zur Anzeige in der UI |
| `SPLITY_PATH` | (aus `.env`) | Host-Verzeichnis (z. B. `/Users/<user>/Movies/Splity`) |
| `LIBRARY_DIR` | `/app/library` | Container-Pfad der lesend eingebundenen Film-Bibliothek |
| `SPLITY_LIBRARY_HOST_PATH` | Wert von `SPLITY_LIBRARY_PATH` | Bibliotheks-Pfad auf dem Mac/Host zur Anzeige in der UI |
| `SPLITY_LIBRARY_PATH` | (aus `.env`) | Host-Verzeichnis der Bibliothek (z. B. `/Users/<user>/Movies`) |

---

## 4. Video-Quellen ("inbox" und "lib")

Splity unterstützt zwei Quellen für Videodateien über einheitliche Video-IDs (`<source>:<base64url>`):

1. **`inbox` (Eingangsordner)**:
   - Speicherort: `Eingang/` im Splity-Ordner.
   - Uploads per Browser werden hier abgelegt; Dateien können gelöscht werden (`deletable: true`).
2. **`lib` (Lokale Bibliothek)**:
   - Speicherort: `LIBRARY_DIR` (`/app/library:ro`), beliebig tief geschachtelt.
   - Read-only (`deletable: false`).
   - Sicherheit: Pfad wird zusätzlich per `fs.realpath` gegen das aufgelöste Bibliotheksverzeichnis geprüft, um Symlink-Ausbrüche zu verhindern. Versteckte Dateien und Ordner (beginnend mit `.`) werden strikt ignoriert. Der eigene Splity-Ordner darf in der Bibliothek liegen, um Schnitte erneut zu teilen.
   - Videos werden direkt und ohne Kopieren analysiert und verarbeitet; die fertigen Schnitte landen unverändert in `Fertig/<name>/`.

---

## 4. Das Schnitt-Prinzip: Warum verlustfrei?

### Warum Keyframes?
Beim verlustfreien Schneiden (`-c copy`) werden Video- und Audiodatenpakete bitgenau aus dem Eingangscontainer in neue Segment-Container kopiert, ohne decodiert oder neu berechnet zu werden.
Da komprimierte Videostreams (H.264, HEVC, VP9 usw.) aus I-Frames (Keyframes mit vollem Bild) sowie P-/B-Frames (nur Differenzen zum vorherigen Bild) bestehen, kann ein Video **ausschließlich an einem Keyframe begonnen werden**. Jeder Schnittpunkt wird daher mathematisch auf den zeitlich nächstgelegenen Keyframe gelegt.

### Warum ffprobe ohne Decodieren?
`ffprobe -v error -select_streams v:0 -show_entries packet=pts_time,flags -of csv=p=0 <datei>`
liest lediglich die Paket-Header der ersten Videospur aus. Dies dauert selbst bei mehrstündigen 4K-Filmen nur wenige Sekunden und beansprucht kaum CPU.

### Warum `format.start_time` abziehen?
Manche Container (insbesondere MPEG-TS `.ts` und manche `.mov`-Dateien von Smartphones) starten ihre Presentation Timestamps (PTS) nicht bei `0.000`, sondern bei einem beliebigen Offset (z. B. `1.400`).
Der ffmpeg-Segment-Muxer rechnet bei `-segment_times` jedoch stets relativ ab Dateianfang (`0.000`).
Indem `format.start_time` von jedem Keyframe-Zeitpunkt abgezogen wird, erhält man eine normalisierte Liste relativer Sekunden, die exakt zu den Schnittpunkten passt.

### Warum der Segment-Muxer in EINEM Aufruf?
Ein häufiger Fehler bei Schnitt-Skripten ist eine Schleife über alle Teile mit `-ss <start> -to <end> -i <quelle> -c copy`.
Dabei springt `-ss` vor `-i` zum *vorherigen* Keyframe, wodurch aufeinanderfolgende Teilstücke um mehrere Sekunden überlappen und Audio desynchronisiert wird.
Splity nutzt stattdessen den Segment-Muxer in einem einzigen Aufruf:
```bash
ffmpeg -hide_banner -nostdin -y -i <quelle> \
       -map 0 -ignore_unknown -c copy \
       -f segment -segment_times <t1,t2,...> -reset_timestamps 1 \
       -avoid_negative_ts make_zero \
       -progress pipe:1 -nostats \
       <ausgabeordner>/<muster_%02d>.<ext>
```
- Die `segment_times` sind die exakten Keyframe-Zeiten **minus 0.001 s**, um Fließkomma-Rundungsfehler zu eliminieren.
- `-segment_format_options movflags=+faststart` wird bei MP4/MOV gesetzt, damit die Teilstücke sofort abspielbar sind.
- `-tag:v hvc1` sorgt bei HEVC dafür, dass Apple QuickTime und iOS die Segmente nativ abspielen.
- Wenn komplexe Datenstreams (z. B. iPhone GPS / Timecode `tmcd`) den Standard-Muxer abbrechen lassen, führt Splity automatisch einen zweiten Versuch mit `-map 0:v -map 0:a? -map 0:s? -dn` durch.

---

## 5. Nicht verändern (Goldene Regeln)

1. **Dockerfile**: `COPY package.json ./`, **nicht** `package*.json`! Die Datei `.dockerignore` muss zwingend erhalten bleiben.
2. **PORT**: Niemals hartkodieren, immer `process.env.PORT` bzw. CLI-Argumente beachten.
3. **Kein Top-Level-Import von Vite im Server**: Vite darf im Server ausschließlich per dynamischem `import('vite')` in der Entwicklungs-Bedingung geladen werden.
4. **Keine Daten committen**: `data/`, `splity/` und `.env` dürfen niemals ins Git-Repository aufgenommen werden.
5. **Vollständige Imports**: Jede verwendete React-Komponente, jedes Icon und jede Hilfsfunktion muss explizit oben importiert sein. Vor Abschluss jeder Änderung `npm run lint` und `npm run build` prüfen.
6. **Alles lokal**: Keine externen Cloud-Dienste, keine Cloud-KI, keine CDN-Abhängigkeiten.
7. **Dateisystem zuerst, dann Zustand**: Niemals Fehler beim Schreiben oder Verschieben von Dateien verschlucken. Niemals eine Quelldatei überschreiben oder verändern.
8. **Keine Shell-Befehle für Medien**: `ffmpeg` und `ffprobe` dürfen ausschließlich über `child_process.spawn` mit einem Argumenten-Array aufgerufen werden.
9. **Schneiden immer in EINEM Aufruf**: Der verlustfreie Schnitt muss immer über den Segment-Muxer in einem Aufruf erfolgen, nie über `-ss`-Schleifen.
10. **React Hook-Disziplin**: Alle React-Hooks (`useState`, `useEffect`, `useCallback`) stehen ausnahmslos vor jedem bedingten Return.
11. **Immer `-c copy` und `-map_metadata 0`**: Nie ein Encoder-Flag (`-c:v libx264` o. Ä.) in einem Schnitt- oder Merge-Aufruf. Ohne `-map_metadata 0` verliert der Segment-Muxer das Aufnahmedatum (`creation_time`).
12. **Basis-Image `node:22-trixie-slim`** (ffmpeg 7.1), nicht bookworm: ffmpeg 5.1 trägt bei MOV-Dateien mit Timecode-Spur (iPhone) dem ersten Teil die Gesamtdauer des Originals ein.
13. **Die Bibliothek ist read-only. Splity schreibt, löscht oder benennt dort nie etwas.**
14. **Video-IDs nur über eine zentrale Auflösung** (`sources.ts`, Prüfung gegen den Quellordner und `fs.realpath`). Nie Pfade aus der URL direkt öffnen.

### Erkenntnisse aus dem Review (2026-09-25)
- Der Segment-Muxer bekommt Muxer-Optionen nur über `-segment_format_options` (z. B. `movflags=+faststart:strict=experimental`); ein globales `-strict` wirkt dort nicht. `strict=experimental` ist nötig für FLAC-Ton in MP4.
- Bit-Prüfung (`-f framemd5` mit `-c copy`): Pakete **je Stream** vergleichen, nicht in der verschachtelten Ausgabereihenfolge – Video und Audio werden in den Teilen anders verzahnt als im Original, die Folge je Stream ist aber identisch.
- Der Datenspur-Fallback (`-dn`) läuft nur, wenn die Analyse Datenstreams gemeldet hat; sonst würde die Warnung „Datenspuren weggelassen“ auch bei ganz anderen Fehlern erscheinen.

---

## 6. Prüfung (Bit-Identitäts-Beweis)

Splity beweist nach jedem Schnitt (abschaltbar in den Einstellungen via `verifyAfterSplit`), dass die erzeugten Teildateien bit-identisch mit dem Original sind:

1. **Paket-Hashes ohne Decodieren**:
   ```bash
   ffmpeg -v error -i <datei> -map 0:v -map 0:a? -c copy -f framemd5 -
   ```
   liefert für jedes einzelne Video- und Audio-Paket Prüfsummen (`md5`) und Paketgrößen (`size`), ohne die CPU mit dem Decodieren von Bildern zu belasten.
2. **Stromweiser Vergleich (`verifySequence`)**:
   Das Original wird einmal gelesen und die Folge von `(size, md5)` je Stream gesammelt. Danach werden alle Teildateien in Schnitt-Reihenfolge eingelesen.
   Die aneinandergehängte Folge der Pakete der Teile **muss je Stream exakt der Folge des Originals entsprechen** (gleiche Paketanzahl, identische Hashes, identische Reihenfolge).
3. **Ergebnis und Transparenz**:
   - Stimmen alle Pakete überein, zeigt die UI: `✓ Verifiziert: X Video- und Y Audio-Pakete bit-identisch mit dem Original`.
   - Weicht auch nur ein einzelnes Paket ab, bleibt der Job-Status auf `done`, aber die UI zeigt eine rote Fehlerkarte: `Prüfung fehlgeschlagen: Videospur 0 weicht ab Paket 1234 ab`. Kein stiller falscher Erfolg.

---

## 7. Bekannte Grenzen ("Was verlustfrei heißt")

Beim verlustfreien Schneiden werden komprimierte Bitströme ohne Transcoding kopiert. Dabei gelten vier naturgegebene Grenzen:

1. **Keyframe-Bindung**: Schnitte liegen ausnahmslos auf Video-Keyframes (I-Frames). Die maximale Abweichung vom idealen Schnittzeitpunkt wird vor dem Schnitt in der UI angezeigt.
2. **Audio-Versatz (20–40 ms)**: Da Audio-Frames (z. B. AAC mit 1024 Samples ≈ 21,3 ms oder 23,2 ms) nie exakt synchron auf den Video-Keyframe-Grenzen liegen, beginnt der Ton in den Teilen bis zu ein Audio-Frame versetzt.
3. **Open-GOP-HEVC**: Bei Videos mit Open-GOP (Standard bei `x265`, jedoch nicht bei iPhone-Aufnahmen) referenzieren die ersten B-Frames eines GOPs Bilder vor dem Keyframe. Player überspringen diese ersten Bilder bei der Wiedergabe; alle Daten sind in den Teilen jedoch vollständig und intakt vorhanden.
4. **Datenspuren**: Spezielle Metadatenspuren (wie Apple Timecode `tmcd`, GPS- oder Kameradaten) können beim MP4-Muxen fehlschlagen und werden im automatischen zweiten Versuch weggelassen. Bild- und Tonspuren werden jedoch niemals weggelassen oder verändert.
