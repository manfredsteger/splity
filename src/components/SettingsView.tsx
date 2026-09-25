import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Folder,
  HardDrive,
  Info,
  Save,
  Server,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react';
import { formatBytes } from '../utils/format.js';
import type { AppSettings, HealthInfo } from '../types.js';

interface SettingsViewProps {
  settings: AppSettings;
  health: HealthInfo | null;
  onSaveSettings: (settings: AppSettings) => Promise<boolean>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  health,
  onSaveSettings,
}) => {
  const [defaultParts, setDefaultParts] = useState(settings.defaultParts || 8);
  const [namePattern, setNamePattern] = useState(
    settings.namePattern || '{name} - Teil {nr} von {gesamt}'
  );
  const [verifyAfterSplit, setVerifyAfterSplit] = useState(
    settings.verifyAfterSplit ?? true
  );
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setDefaultParts(settings.defaultParts || 8);
    setNamePattern(settings.namePattern || '{name} - Teil {nr} von {gesamt}');
    setVerifyAfterSplit(settings.verifyAfterSplit ?? true);
  }, [settings]);

  const hasNrPlaceholder = namePattern.includes('{nr}');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasNrPlaceholder) {
      setValidationError('Das Namensmuster muss zwingend den Platzhalter {nr} enthalten.');
      return;
    }
    setValidationError(null);
    setIsSaving(true);
    const ok = await onSaveSettings({
      defaultParts: Math.max(2, Math.min(200, Number(defaultParts))),
      namePattern: namePattern.trim() || '{name} - Teil {nr} von {gesamt}',
      verifyAfterSplit,
    });
    setIsSaving(false);
    if (ok) {
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 2500);
    }
  };

  // Live pattern preview example
  const previewExample =
    namePattern
      .replace(/\{name\}/g, 'Urlaubsvideo')
      .replace(/\{nr\}/g, '01')
      .replace(/\{gesamt\}/g, String(defaultParts).padStart(2, '0'))
      .replace(/\{start\}/g, '00-00-00')
      .replace(/\{ende\}/g, '00-05-30') + '.mp4';

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
          Einstellungen
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Standardwerte für Schnitt, Benennung und automatische Bit-Prüfung
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* General Settings Card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-5">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-blue-600" />
            <span>Schnitt & Benennung</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                Standard-Teilezahl (beim Öffnen)
              </label>
              <input
                type="number"
                min={2}
                max={200}
                value={defaultParts}
                onChange={(e) => setDefaultParts(parseInt(e.target.value, 10) || 2)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-mono text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-zinc-400 mt-1">Erlaubt zwischen 2 und 200 Teilen.</p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-700 dark:text-zinc-300 uppercase tracking-wider mb-1.5">
                Namensmuster der Teile
              </label>
              <input
                type="text"
                value={namePattern}
                onChange={(e) => {
                  setNamePattern(e.target.value);
                  if (validationError) setValidationError(null);
                }}
                className={`w-full px-3.5 py-2.5 rounded-xl border font-mono text-sm focus:outline-hidden focus:ring-2 ${
                  !hasNrPlaceholder
                    ? 'border-red-400 dark:border-red-600 focus:ring-red-500'
                    : 'border-zinc-300 dark:border-zinc-700 focus:ring-blue-500'
                } bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`}
              />
              <p className="text-xs text-zinc-400 mt-1">
                Platzhalter: <code className="text-blue-500 font-mono">{'{name}'}</code>,{' '}
                <code className="text-blue-500 font-mono">{'{nr}'}</code> (Pflicht),{' '}
                <code className="text-blue-500 font-mono">{'{gesamt}'}</code>,{' '}
                <code className="text-blue-500 font-mono">{'{start}'}</code>,{' '}
                <code className="text-blue-500 font-mono">{'{ende}'}</code>
              </p>
              {!hasNrPlaceholder && (
                <p className="text-xs text-red-500 font-medium mt-1">
                  Muster muss zwingend {'{nr}'} enthalten!
                </p>
              )}
            </div>
          </div>

          {/* Live Preview Box */}
          <div className="p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/60 border border-zinc-200 dark:border-zinc-700/60 space-y-1">
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Live-Vorschau des Dateinamens:
            </div>
            <div className="font-mono text-sm text-blue-600 dark:text-blue-400 truncate">
              {previewExample}
            </div>
          </div>

          {/* Verification Option */}
          <div className="pt-2 border-t border-zinc-100 dark:border-zinc-800">
            <label className="flex items-start gap-3 cursor-pointer group">
              <input
                type="checkbox"
                checked={verifyAfterSplit}
                onChange={(e) => setVerifyAfterSplit(e.target.checked)}
                className="mt-1 w-4 h-4 rounded text-blue-600 focus:ring-blue-500 border-zinc-300 dark:border-zinc-700 cursor-pointer"
              />
              <div className="space-y-0.5">
                <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  <span>Nach dem Schnitt prüfen</span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400 max-w-2xl leading-relaxed">
                  Liest Original und Teile einmal komplett, ohne zu decodieren, und vergleicht alle Video- und Audio-Pakete auf Bit-Identität per framemd5 (bei 20 GB etwa eine Minute).
                </div>
              </div>
            </label>
          </div>

          {validationError && (
            <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 text-xs font-semibold">
              {validationError}
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2">
            {savedSuccess && (
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold flex items-center gap-1">
                <Check className="w-4 h-4" />
                <span>Einstellungen gespeichert!</span>
              </span>
            )}
            <button
              type="submit"
              disabled={isSaving || !hasNrPlaceholder}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 text-white font-semibold text-sm transition-colors cursor-pointer shadow-sm shadow-blue-600/20 disabled:cursor-not-allowed"
            >
              <Save className="w-4 h-4" />
              <span>{isSaving ? 'Wird gespeichert...' : 'Speichern'}</span>
            </button>
          </div>
        </div>

        {/* Section: Was verlustfrei heißt (Die 4 Grenzen) */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Info className="w-4 h-4 text-blue-600" />
            <span>Was verlustfrei heißt</span>
          </h3>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Beim verlustfreien Schnitt werden die komprimierten Datenpakete unverändert kopiert. Es gelten vier technische Grenzen:
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-[11px] flex items-center justify-center font-mono shrink-0">1</span>
                <span>Keyframe-Bindung</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed pl-6.5">
                Schnitte liegen immer auf Keyframes (Abweichung wird in der Vorschau angezeigt). Nur dort existiert ein vollständiges I-Frame ohne Referenz zu vorherigen Bildern.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-[11px] flex items-center justify-center font-mono shrink-0">2</span>
                <span>Audio-Versatz (20–40 ms)</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed pl-6.5">
                Ton beginnt bis zu ein Audio-Frame (20–40 ms) versetzt, weil Audio-Pakete nie exakt synchron auf Video-Keyframes liegen.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-[11px] flex items-center justify-center font-mono shrink-0">3</span>
                <span>Open-GOP-HEVC</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed pl-6.5">
                Bei Open-GOP-HEVC (x265-Standard, nicht iPhone) können erste Bilder eines Teils vom Player übersprungen werden; die Daten sind vollständig erhalten.
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 text-[11px] flex items-center justify-center font-mono shrink-0">4</span>
                <span>Datenspuren</span>
              </div>
              <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed pl-6.5">
                Datenspuren (Timecode, GPS) werden notfalls weggelassen, wenn der MP4-Muxer sonst scheitert – Bild und Ton werden niemals verändert.
              </p>
            </div>
          </div>
        </div>

        {/* Paths Card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Folder className="w-4 h-4 text-blue-600" />
            <span>Aktive Ordnerpfade</span>
          </h3>

          <div className="space-y-3">
            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Eingangsordner (Quellvideos)
              </div>
              <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100 select-all">
                {health ? `${health.paths.splityHostPath}/Eingang` : '...'}
              </div>
              <div className="font-mono text-[11px] text-zinc-400">
                Container: {health?.paths.eingang || '...'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Ausgabeordner (Fertige Schnitte)
              </div>
              <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100 select-all">
                {health ? `${health.paths.splityHostPath}/Fertig` : '...'}
              </div>
              <div className="font-mono text-[11px] text-zinc-400">
                Container: {health?.paths.fertig || '...'}
              </div>
            </div>

            <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
              <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                Daten & Cache
              </div>
              <div className="font-mono text-xs text-zinc-700 dark:text-zinc-300">
                {health?.paths.dataDir || '...'}
              </div>
            </div>

            {health?.paths.libraryHostPath ? (
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    Bibliotheksordner
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300">
                    nur lesend
                  </span>
                </div>
                <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100 select-all">
                  {health.paths.libraryHostPath}
                </div>
                <div className="font-mono text-[11px] text-zinc-400">
                  Container: {health.paths.libraryDir || '...'}
                </div>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800 space-y-1">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    Bibliotheksordner
                  </div>
                  <span className="text-[10px] text-zinc-400 font-medium">Nicht konfiguriert</span>
                </div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  In Docker über <code className="font-mono text-blue-500">SPLITY_LIBRARY_PATH</code> in <code className="font-mono text-blue-500">.env</code> lesend einbindbar.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* System & Tools Status */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-4">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
            <Server className="w-4 h-4 text-blue-600" />
            <span>System- und Tool-Status</span>
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {health?.ffmpeg ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">FFmpeg</div>
                <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                  {health?.ffmpeg ? `Version ${health.ffmpeg}` : 'Nicht verfügbar'}
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">Verlustfreies Muxen</div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                {health?.ffprobe ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">FFprobe</div>
                <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                  {health?.ffprobe ? `Version ${health.ffprobe}` : 'Nicht verfügbar'}
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">Keyframe-Analyse</div>
              </div>
            </div>

            <div className="p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 flex items-start gap-3">
              <div className="mt-0.5 shrink-0">
                <HardDrive className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Freier Speicher</div>
                <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100">
                  {health ? formatBytes(health.freeBytes) : '...'}
                </div>
                <div className="text-[11px] text-zinc-400 mt-0.5">Auf Arbeitsfestplatte</div>
              </div>
            </div>
          </div>
        </div>
      </form>
    </div>
  );
};
