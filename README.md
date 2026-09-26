# Splity ✂️

**Splity** ist eine selbst gehostete Web-App, die Videos **verlustfrei** in Teile schneidet – ohne Neukodierung, ohne Qualitätsverlust, in Sekunden.

Inspiriert von Desktop-Tools wie LosslessCut, aber radikal vereinfacht:
1. Video per Drag & Drop reinziehen (oder im Mac-Eingangsordner ablegen)
2. Gewünschte Teileanzahl wählen (z. B. 8 Teile)
3. Auf "Schneiden" klicken – fertig!

Die Teildateien landen sofort sortiert in einem Ordner auf deinem Mac.

---

## 🚀 Schnellstart

Mit einem einzigen Befehl einrichten und starten:

```bash
make setup
```

Der Befehl erledigt alles automatisch:
- Erstellt die `.env`-Datei aus `.env.example` und setzt deinen macOS-Benutzernamen ein.
- Erstellt die Ordner `Eingang` und `Fertig` unter `~/Movies/Splity/`.
- Baut das Docker-Image und startet den Container im Hintergrund.
- Öffnet die App unter **http://localhost:3006**.

---

## 🛠 Weitere Befehle

| Befehl | Funktion |
|---|---|
| `make setup` | Initiales Setup & Start von Docker |
| `make prod` | Startet den Docker-Container |
| `make dev` | Startet den lokalen Entwicklungsmodus (`http://localhost:3007`) |
| `make test` | Führt die Vitest-Unit-Tests für die Schnittplan-Logik aus |
| `make logs` | Zeigt Live-Logs des Containers |
| `make stop` | Stoppt den Docker-Container |
| `make restart` | Startet den Container neu |
| `make shell` | Öffnet eine Shell im Container |

---

## 📁 Ordnerstruktur auf deinem Rechner

Im Ordner `~/Movies/Splity` (konfigurierbar in `.env`):
- `Eingang/`: Hier kannst du Quellvideos auch manuell hineinwerfen. Splity erkennt sie automatisch.
- `Fertig/`: Hier werden die erstellten Segmente in Unterordnern gespeichert (z. B. `Urlaub/Urlaub - Teil 01 von 08.mp4`).

---

## ⚙️ Umgebungsvariablen

Konfigurierbar in `.env`:

```env
SPLITY_PATH=/Users/DEINNAME/Movies/Splity
```

---

## 🔒 Datenschutz & Lokalität

Splity läuft zu 100 % lokal. Es werden weder Cloud-Dienste noch KI-Modelle oder externe Server kontaktiert. Sämtliche Videodaten bleiben auf deiner eigenen Festplatte.

## Szenen

Modus „An Szenen“: Splity erkennt Szenenwechsel (optional auch Schwarzbilder), zeigt sie als Streifen mit Vorschaubildern und schneidet an den gewählten Grenzen – wie immer verlustfrei am nächsten Keyframe.

## Kapitel und Zusammenfügen

- Im Szenen-Modus „Als Kapitel speichern“: Kopie mit bildgenauen Sprungmarken (MP4/MOV/MKV), ohne Schnitt.
- Reiter „Zusammenfügen“: Teile aus `Fertig/` oder beliebige Videos mit gleichen Codec-Parametern verlustfrei aneinanderhängen – mit Vorprüfung und Bit-Prüfung.
- Vorschau-Player mit Sprung zu Teilen und Szenen.

## Weitere Modi

- **Max. Größe**: Teile mit maximaler Dateigröße (z. B. 2 GB für Upload-Grenzen), Schnitte an Keyframes.
- **Ausschnitt**: nur einen Bereich behalten (Anfang/Ende, auch aus der Player-Position), Rest wird verworfen.
- **Werkzeuge**: Container wechseln (z. B. MKV → MP4), Tonspur herausziehen, Schnittplan als LosslessCut-CSV.

## Linux mit Podman (Bazzite, Fedora Atomic)

Ohne Docker und Compose – Splity läuft als rootless Podman-Container über eine systemd-Quadlet-Unit:

```bash
git clone https://github.com/manfredsteger/splity.git ~/git/splity && cd ~/git/splity
mkdir -p data ~/Videos/Splity/Eingang ~/Videos/Splity/Fertig
podman build -t localhost/splity:latest .
mkdir -p ~/.config/containers/systemd && cp deploy/splity.container ~/.config/containers/systemd/
systemctl --user daemon-reload && systemctl --user start splity
loginctl enable-linger      # startet den Dienst auch ohne Anmeldung nach dem Booten
```

Danach läuft Splity unter http://localhost:3006 (Eingang/Fertig in `~/Videos/Splity`, Bibliothek `~/Videos` nur lesend).
Update: `cd ~/git/splity && git pull && podman build -t localhost/splity:latest . && systemctl --user restart splity`.
Firewall: Bei firewalld ggf. `sudo firewall-cmd --add-port=3006/tcp --permanent && sudo firewall-cmd --reload`, falls der Port aus dem LAN nicht erreichbar ist.
