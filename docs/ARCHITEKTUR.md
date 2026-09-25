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
├── Dockerfile                 Multi-Stage Build (node:22-bookworm-slim + ffmpeg)
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

## 5. Nicht verändern (Zehn goldene Regeln)

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
