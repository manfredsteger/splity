import React, { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Clock,
  Film,
  FolderOpen,
  HardDrive,
  BookmarkPlus,
  Download,
  Eye,
  FileAudio,
  Package,
  EyeOff,
  Loader2,
  Minus,
  Plus,
  Scissors,
  Sparkles,
  Volume2,
  Wand2,
} from 'lucide-react';
import { SceneStrip } from './SceneStrip.js';
import { VideoPlayer, type VideoPlayerHandle } from './VideoPlayer.js';
import { Timeline, type TimelineMarker } from './Timeline.js';
import { formatBytes, formatTime } from '../utils/format.js';
import type { Job, ProbeResult, SceneDetectionResult, SceneSensitivity, SplitMode, SplitPlan } from '../types.js';

type ModeType = 'count' | 'every' | 'size' | 'trim' | 'scenes';

const MB = 1024 * 1024;

/** "hh:mm:ss", "mm:ss" oder Sekunden -> Sekunden (NaN bei Unsinn) */
export function parseTimeInput(text: string): number {
  const t = text.trim().replace(',', '.');
  if (!t) return NaN;
  if (/^\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  const parts = t.split(':').map((x) => parseFloat(x));
  if (parts.some((x) => Number.isNaN(x))) return NaN;
  return parts.reduce((acc, x) => acc * 60 + x, 0);
}

const SENSITIVITY_LABELS: Record<SceneSensitivity, { label: string; hint: string }> = {
  low: { label: 'Niedrig', hint: 'nur harte Schnitte' },
  mid: { label: 'Mittel', hint: 'Standard' },
  high: { label: 'Hoch', hint: 'auch weiche Übergänge' },
};

interface VideoDetailProps {
  videoId: string;
  probe: ProbeResult;
  onBack: () => void;
  onStartSplit: (mode: SplitMode) => void;
  /** Kopie mit Kapiteln an den gewählten Szenengrenzen (ohne Schnitt) */
  onStartChapters?: (times: number[]) => void;
  /** Container wechseln (mp4 | mov | mkv) bzw. Tonspur herausziehen (0-basiert) */
  onStartRemux?: (target: string) => void;
  onStartAudio?: (track: number) => void;
  isStartingSplit: boolean;
  defaultParts: number;
  source?: string;
  relPath?: string;
  libraryHostPath?: string | null;
  eingangHostPath?: string | null;
}

export const VideoDetail: React.FC<VideoDetailProps> = ({
  videoId,
  probe,
  onBack,
  onStartSplit,
  onStartChapters,
  onStartRemux,
  onStartAudio,
  isStartingSplit,
  defaultParts,
  source,
  relPath,
  libraryHostPath,
  eingangHostPath,
}) => {
  const [modeType, setModeType] = useState<ModeType>('count');
  const [partCount, setPartCount] = useState<number>(defaultParts || 8);
  const [everyMinutes, setEveryMinutes] = useState<number>(10);
  const [maxSizeMb, setMaxSizeMb] = useState<number>(2000);
  const [trimStartText, setTrimStartText] = useState<string>('00:00:00');
  const [trimEndText, setTrimEndText] = useState<string>('');
  const [playerTime, setPlayerTime] = useState<number>(0);
  const [plan, setPlan] = useState<SplitPlan | null>(null);
  const [hoveredPartIndex, setHoveredPartIndex] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  // Szenen-Modus
  const [sensitivity, setSensitivity] = useState<SceneSensitivity>('mid');
  const [useBlack, setUseBlack] = useState(false);
  const [scenes, setScenes] = useState<SceneDetectionResult | null>(null);
  const [sceneProgress, setSceneProgress] = useState<number | null>(null); // null = läuft nicht
  const [sceneError, setSceneError] = useState<string | null>(null);
  const [activeBoundaries, setActiveBoundaries] = useState<Set<number>>(new Set());
  const [minPartSeconds, setMinPartSeconds] = useState<number>(5);
  const [minSceneSeconds, setMinSceneSeconds] = useState<number>(10);
  const sceneEsRef = useRef<EventSource | null>(null);

  // Vorschau-Player
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const [showPlayer, setShowPlayer] = useState(true);
  const seek = useCallback((seconds: number) => playerRef.current?.seek(seconds, true), []);
  const chaptersPossible = ['MP4', 'MOV', 'MKV', 'M4V'].includes((probe.container || '').toUpperCase());

  // Werkzeuge: Container wechseln, Tonspur herausziehen, LosslessCut-CSV
  const currentContainer = (probe.container || '').toUpperCase();
  const remuxTargets = (['mp4', 'mov', 'mkv'] as const).filter((t) => t.toUpperCase() !== currentContainer && !(currentContainer === 'M4V' && t === 'mp4'));
  const [remuxTarget, setRemuxTarget] = useState<string>(remuxTargets[0] || 'mp4');
  const [remuxInfo, setRemuxInfo] = useState<{ ok: boolean; problems: string[]; dropSubtitles: boolean; annexB: boolean } | null>(null);
  const [audioTrack, setAudioTrack] = useState<number>(0);
  useEffect(() => {
    setRemuxTarget(remuxTargets[0] || 'mp4');
    setAudioTrack(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);
  useEffect(() => {
    let cancelled = false;
    setRemuxInfo(null);
    if (!remuxTargets.includes(remuxTarget as 'mp4' | 'mov' | 'mkv')) return;
    fetch(`/api/videos/${encodeURIComponent(videoId)}/remux-check?target=${remuxTarget}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d) setRemuxInfo(d);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, remuxTarget]);

  const downloadLosslessCutCsv = useCallback(() => {
    if (!plan) return;
    const base = probe.filename.replace(/\.[^.]+$/, '');
    const rows = plan.parts
      .filter((p) => p.keep !== false)
      .map((p, i) => `${p.start.toFixed(3)},${p.end.toFixed(3)},${JSON.stringify(`${base} - Teil ${i + 1}`)}`);
    const blob = new Blob([rows.join('\n') + '\n'], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${base}-llc.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [plan, probe.filename]);

  // Sortierte aktive Grenzen als stabiler Schlüssel für Effekte
  const boundaryTimes = useMemo(() => Array.from(activeBoundaries).sort((a, b) => a - b), [activeBoundaries]);
  const boundaryKey = boundaryTimes.join(',');

  // Bei neuem Video oder geänderten Erkennungs-Einstellungen: Ergebnis verwerfen
  useEffect(() => {
    setScenes(null);
    setActiveBoundaries(new Set());
    setSceneError(null);
    setSceneProgress(null);
    if (sceneEsRef.current) {
      sceneEsRef.current.close();
      sceneEsRef.current = null;
    }
  }, [videoId, sensitivity, useBlack]);

  useEffect(() => {
    return () => {
      if (sceneEsRef.current) sceneEsRef.current.close();
    };
  }, []);

  const applyScenes = useCallback((result: SceneDetectionResult) => {
    setScenes(result);
    // Alle Grenzen aktiv (erste Szene beginnt bei 0 und ist keine Grenze)
    setActiveBoundaries(new Set(result.scenes.filter((sc) => sc.index > 1).map((sc) => sc.start)));
    setSceneProgress(null);
  }, []);

  const startSceneDetection = useCallback(async () => {
    setSceneError(null);
    setSceneProgress(0);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/scenes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ threshold: sensitivity, black: useBlack }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Szenenerkennung konnte nicht gestartet werden.');
      }
      const data = await res.json();
      if (data.cached && data.scenes) {
        applyScenes(data.scenes as SceneDetectionResult);
        return;
      }
      const jobId: string = data.jobId;
      const es = new EventSource(`/api/jobs/${encodeURIComponent(jobId)}/events`);
      sceneEsRef.current = es;
      es.onmessage = (event) => {
        try {
          const job = JSON.parse(event.data) as Job;
          if (job.status === 'running' || job.status === 'queued') {
            setSceneProgress(job.progress || 0);
          } else if (job.status === 'done' && job.scenes) {
            es.close();
            sceneEsRef.current = null;
            applyScenes(job.scenes);
          } else if (job.status === 'error' || job.status === 'cancelled') {
            es.close();
            sceneEsRef.current = null;
            setSceneProgress(null);
            setSceneError(job.error || 'Szenenerkennung fehlgeschlagen.');
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        // EventSource verbindet sich selbst neu
      };
    } catch (err: any) {
      setSceneProgress(null);
      setSceneError(err.message || 'Szenenerkennung fehlgeschlagen.');
    }
  }, [videoId, sensitivity, useBlack, applyScenes]);

  const toggleBoundary = useCallback((start: number) => {
    setActiveBoundaries((prev) => {
      const next = new Set(prev);
      if (next.has(start)) next.delete(start);
      else next.add(start);
      return next;
    });
  }, []);

  const selectAllBoundaries = useCallback(() => {
    if (!scenes) return;
    setActiveBoundaries(new Set(scenes.scenes.filter((sc) => sc.index > 1).map((sc) => sc.start)));
  }, [scenes]);

  const selectNoBoundaries = useCallback(() => setActiveBoundaries(new Set()), []);

  // "Nur Szenen länger als X s": Grenzen kurzer Szenen weglassen, sie verschmelzen mit der vorherigen
  const selectLongScenes = useCallback(() => {
    if (!scenes) return;
    const next = new Set<number>();
    let runningStart = 0;
    for (const sc of scenes.scenes) {
      if (sc.index === 1) continue;
      // Grenze setzen, wenn der Teil davor lang genug ist
      if (sc.start - runningStart >= minSceneSeconds) {
        next.add(sc.start);
        runningStart = sc.start;
      }
    }
    setActiveBoundaries(next);
  }, [scenes, minSceneSeconds]);

  const sceneMarkers: TimelineMarker[] = useMemo(
    () =>
      scenes
        ? scenes.scenes
            .filter((sc) => sc.index > 1)
            .map((sc) => ({ time: sc.start, active: activeBoundaries.has(sc.start), label: `Szene ${sc.index} bei ${formatTime(sc.start)}` }))
        : [],
    [scenes, activeBoundaries]
  );

  const isLib = source === 'lib' || videoId.startsWith('lib:');
  const fullHostPath = isLib
    ? libraryHostPath
      ? `${libraryHostPath.replace(/\/+$/, '')}/${relPath || probe.filename}`
      : relPath || probe.filename
    : eingangHostPath
    ? `${eingangHostPath.replace(/\/+$/, '')}/${probe.filename}`
    : probe.filename;

  const trimStart = parseTimeInput(trimStartText);
  const trimEndRaw = parseTimeInput(trimEndText);
  const trimEnd = Number.isNaN(trimEndRaw) && trimEndText.trim() === '' ? probe.duration : trimEndRaw;
  const trimValid = !Number.isNaN(trimStart) && !Number.isNaN(trimEnd) && trimStart >= 0 && trimEnd > trimStart && trimEnd <= probe.duration + 0.5;

  const currentMode: SplitMode =
    modeType === 'count'
      ? { type: 'count', n: partCount }
      : modeType === 'every'
      ? { type: 'every', seconds: everyMinutes * 60 }
      : modeType === 'size'
      ? { type: 'size', maxBytes: Math.max(1, Math.round(maxSizeMb)) * MB }
      : modeType === 'trim'
      ? { type: 'trim', start: trimValid ? trimStart : 0, end: trimValid ? Math.min(trimEnd, probe.duration) : probe.duration }
      : { type: 'points', times: boundaryTimes, minPartSeconds, origin: 'scenes' };

  // Fetch plan with debounce 150ms
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`/api/videos/${encodeURIComponent(videoId)}/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: currentMode }),
      })
        .then((res) => {
          if (!res.ok) throw new Error('Plan-Berechnung fehlgeschlagen');
          return res.json();
        })
        .then((data: SplitPlan) => {
          startTransition(() => {
            setPlan(data);
          });
        })
        .catch((err) => {
          console.error(err);
        });
    }, 150);

    return () => clearTimeout(timer);
  }, [videoId, modeType, partCount, everyMinutes, boundaryKey, minPartSeconds, maxSizeMb, trimStartText, trimEndText]);

  // Keyboard navigation: Enter = cut, ArrowUp/ArrowDown = parts +1 / -1
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'ArrowUp') {
        if (modeType !== 'count' && modeType !== 'every') return;
        e.preventDefault();
        if (modeType === 'count') {
          setPartCount((prev) => Math.min(200, prev + 1));
        } else {
          setEveryMinutes((prev) => prev + 1);
        }
      } else if (e.key === 'ArrowDown') {
        if (modeType !== 'count' && modeType !== 'every') return;
        e.preventDefault();
        if (modeType === 'count') {
          setPartCount((prev) => Math.max(2, prev - 1));
        } else {
          setEveryMinutes((prev) => Math.max(1, prev - 1));
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!isStartingSplit && plan && plan.parts.length > 1) {
          onStartSplit(currentMode);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modeType, partCount, everyMinutes, isStartingSplit, currentMode, onStartSplit, plan]);

  const quickChipsCount = [2, 3, 4, 5, 8, 10];
  const quickChipsMinutes = [1, 2, 5, 10, 15, 30];
  const quickChipsSize: Array<{ label: string; mb: number }> = [
    { label: '100 MB', mb: 100 },
    { label: '500 MB', mb: 500 },
    { label: '1 GB', mb: 1024 },
    { label: '2 GB', mb: 2048 },
    { label: '4 GB', mb: 4096 },
  ];
  const keptParts = plan ? plan.parts.filter((p) => p.keep !== false) : [];
  const hasSizes = !!plan && plan.parts.some((p) => typeof p.bytes === 'number');
  const largestPart = hasSizes ? Math.max(...keptParts.map((p) => p.bytes || 0)) : 0;

  const totalCalculatedParts = plan?.parts.length || (modeType === 'count' ? partCount : 1);

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Back button */}
      <div>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Anderes Video wählen</span>
        </button>
      </div>

      {/* Video Metadata Card */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              isLib
                ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400'
                : 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
            }`}>
              <Film className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap mb-0.5">
                <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate" title={probe.filename}>
                  {probe.filename}
                </h2>
                {isLib ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0">
                    <FolderOpen className="w-3 h-3" />
                    <span>Bibliothek</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                    <HardDrive className="w-3 h-3" />
                    <span>Eingang</span>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">
                  {formatTime(probe.duration)}
                </span>
                <span>•</span>
                <span>{formatBytes(probe.filesize)}</span>
                <span>•</span>
                <span className="uppercase font-mono">{probe.container}</span>
                {probe.video && (
                  <>
                    <span>•</span>
                    <span className="uppercase">{probe.video.codec}</span>
                    <span>•</span>
                    <span>
                      {probe.video.width}×{probe.video.height}
                    </span>
                    <span>•</span>
                    <span>{probe.video.fps} fps</span>
                  </>
                )}
                <span>•</span>
                <span className="flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5 inline" />
                  <span>{probe.audioTrackCount} Spur{probe.audioTrackCount !== 1 ? 'en' : ''}</span>
                </span>
              </div>

              {fullHostPath && (
                <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-500 dark:text-zinc-400 mt-1.5 truncate">
                  <HardDrive className="w-3 h-3 text-zinc-400 shrink-0" />
                  <span className="truncate select-all">{fullHostPath}</span>
                  {isLib && (
                    <span className="text-[10px] text-zinc-400 font-sans shrink-0">(nur lesend)</span>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="shrink-0 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 rounded-xl px-3.5 py-2 text-xs text-blue-700 dark:text-blue-300">
            <div className="font-semibold">Keyframe-Abstand</div>
            <div>
              etwa alle {probe.keyframeIntervalAvg.toFixed(1)} s
              {typeof probe.keyframeIntervalMax === 'number' && `, maximal ${probe.keyframeIntervalMax.toFixed(1)} s`}
            </div>
          </div>
        </div>
      </div>

      {/* Vorschau-Player */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Vorschau</div>
          <button
            type="button"
            onClick={() => setShowPlayer((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer"
          >
            {showPlayer ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            {showPlayer ? 'Ausblenden' : 'Einblenden'}
          </button>
        </div>
        {showPlayer && (
          <VideoPlayer ref={playerRef} videoId={videoId} container={probe.container} codec={probe.video?.codec} onTimeUpdate={setPlayerTime} />
        )}
      </div>

      {/* Werkzeuge: Container wechseln, Tonspur */}
      {(onStartRemux || onStartAudio) && (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 shadow-xs">
          <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-3">Werkzeuge (ohne Schnitt, ohne Neucodierung)</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {onStartRemux && (
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  <Package className="w-4 h-4 text-blue-600" />
                  Container wechseln
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">{currentContainer} →</span>
                  <select
                    value={remuxTarget}
                    onChange={(e) => setRemuxTarget(e.target.value)}
                    className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                  >
                    {remuxTargets.map((t) => (
                      <option key={t} value={t}>
                        {t.toUpperCase()}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => onStartRemux(remuxTarget)}
                    disabled={isStartingSplit || remuxTargets.length === 0 || (remuxInfo ? !remuxInfo.ok : false)}
                    className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    Neu verpacken
                  </button>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  {remuxInfo && !remuxInfo.ok
                    ? remuxInfo.problems.join(' ')
                    : remuxInfo?.dropSubtitles
                    ? `Untertitel passen nicht in ${remuxTarget.toUpperCase()} und werden weggelassen.`
                    : remuxInfo?.annexB
                    ? 'TS-Quelle: Paket-Hülle wird umgewandelt (kein Neucodieren), die Bit-Prüfung entfällt.'
                    : 'Z. B. MKV → MP4, damit es überall abspielt. Bild und Ton bleiben unverändert.'}
                </div>
              </div>
            )}
            {onStartAudio && (
              <div className="flex flex-col gap-2 p-3 rounded-xl bg-zinc-50 dark:bg-zinc-800/40 border border-zinc-200 dark:border-zinc-800">
                <div className="flex items-center gap-2 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
                  <FileAudio className="w-4 h-4 text-blue-600" />
                  Tonspur herausziehen
                </div>
                <div className="flex items-center gap-2">
                  {(probe.audio || []).length > 1 ? (
                    <select
                      value={audioTrack}
                      onChange={(e) => setAudioTrack(Number(e.target.value))}
                      className="px-2.5 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-bold text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                    >
                      {(probe.audio || []).map((a) => (
                        <option key={a.index} value={a.index}>
                          Spur {a.index + 1}: {a.codec.toUpperCase()} {a.channels}ch{a.language ? ` (${a.language})` : ''}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {(probe.audio || []).length === 1
                        ? `${probe.audio![0].codec.toUpperCase()} ${probe.audio![0].channels}ch`
                        : 'Keine Tonspur'}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => onStartAudio(audioTrack)}
                    disabled={isStartingSplit || (probe.audio || []).length === 0}
                    className="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold bg-zinc-900 dark:bg-white text-white dark:text-zinc-900 hover:opacity-90 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                  >
                    Herausziehen
                  </button>
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">Unverändert kopiert, Endung nach Codec (AAC → .m4a, FLAC → .flac, MP3 → .mp3 …).</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Split Control & Mode Switcher */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-6">
        {/* Mode Selector Tabs */}
        <div className="flex flex-col gap-3 border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl self-start">
            <button
              onClick={() => setModeType('count')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
                modeType === 'count'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              In gleiche Teile
            </button>
            <button
              onClick={() => setModeType('every')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
                modeType === 'every'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Alle X Minuten
            </button>
            <button
              onClick={() => setModeType('size')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
                modeType === 'size'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Max. Größe
            </button>
            <button
              onClick={() => setModeType('trim')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
                modeType === 'trim'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Ausschnitt
            </button>
            <button
              onClick={() => setModeType('scenes')}
              className={`px-3 py-2 rounded-lg text-sm font-semibold whitespace-nowrap transition-all cursor-pointer ${
                modeType === 'scenes'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              An Szenen
            </button>
          </div>

          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Tipp: Pfeiltasten <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-zinc-700 dark:text-zinc-300">↑</kbd> <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-zinc-700 dark:text-zinc-300">↓</kbd> zum Anpassen, <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-zinc-700 dark:text-zinc-300">Enter</kbd> zum Schneiden
          </div>
        </div>

        {/* Szenen-Modus: Erkennung + Auswahl */}
        {modeType === 'scenes' && (
          <div className="space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">Empfindlichkeit:</span>
                <div className="flex items-center gap-1 p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl">
                  {(Object.keys(SENSITIVITY_LABELS) as SceneSensitivity[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSensitivity(key)}
                      disabled={sceneProgress !== null}
                      title={SENSITIVITY_LABELS[key].hint}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer disabled:cursor-not-allowed ${
                        sensitivity === key
                          ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                          : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      {SENSITIVITY_LABELS[key].label}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-xs font-medium text-zinc-700 dark:text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={useBlack}
                    disabled={sceneProgress !== null}
                    onChange={(e) => setUseBlack(e.target.checked)}
                    className="w-4 h-4 rounded border-zinc-300 dark:border-zinc-600 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Schwarzbilder als Grenze</span>
                </label>
              </div>

              <button
                type="button"
                onClick={startSceneDetection}
                disabled={sceneProgress !== null}
                className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 text-white text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed shadow-xs"
              >
                {sceneProgress !== null ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                <span>{sceneProgress !== null ? `Erkenne Szenen … ${sceneProgress}%` : scenes ? 'Erneut erkennen' : 'Szenen erkennen'}</span>
              </button>
            </div>

            {sceneProgress !== null && (
              <div className="space-y-1.5">
                <div className="w-full h-2 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full transition-all duration-200" style={{ width: `${Math.max(3, sceneProgress)}%` }} />
                </div>
                <div className="text-[11px] text-zinc-500 dark:text-zinc-400">
                  Das Video wird dafür einmal verkleinert decodiert – die Quelle bleibt unverändert. Bei langen Filmen dauert das einige Minuten.
                </div>
              </div>
            )}

            {sceneError && (
              <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 text-sm flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{sceneError}</span>
              </div>
            )}

            {!scenes && sceneProgress === null && !sceneError && (
              <div className="text-sm text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700/60">
                Splity findet Szenenwechsel im Bild und legt an jedem einen Schnitt vor. Danach kannst du einzelne Grenzen an- oder abwählen; Schnitte landen wie immer auf dem nächsten Keyframe.
              </div>
            )}

            {scenes && (
              <div className="space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                    {scenes.scenes.length} Szenen erkannt · {activeBoundaries.size} Grenze{activeBoundaries.size === 1 ? '' : 'n'} aktiv · in {(scenes.durationMs / 1000).toFixed(1)} s
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={selectAllBoundaries} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer">
                      Alle
                    </button>
                    <button type="button" onClick={selectNoBoundaries} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer">
                      Keine
                    </button>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-600 dark:text-zinc-400">
                      <button type="button" onClick={selectLongScenes} className="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 cursor-pointer">
                        Nur Szenen länger als
                      </button>
                      <input
                        type="number"
                        min={1}
                        max={3600}
                        value={minSceneSeconds}
                        onChange={(e) => setMinSceneSeconds(Math.max(1, Number(e.target.value) || 1))}
                        className="w-16 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                      />
                      <span>s</span>
                    </div>
                  </div>
                </div>

                <SceneStrip
                  videoId={videoId}
                  scenes={scenes.scenes}
                  keyframes={probe.keyframes}
                  activeBoundaries={activeBoundaries}
                  onToggle={toggleBoundary}
                  onSeek={showPlayer ? seek : undefined}
                />

                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
                  <label className="flex items-center gap-2">
                    <span className="font-medium">Mindestlänge je Teil</span>
                    <input
                      type="number"
                      min={0}
                      max={3600}
                      value={minPartSeconds}
                      onChange={(e) => setMinPartSeconds(Math.max(0, Number(e.target.value) || 0))}
                      className="w-16 px-2 py-1.5 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-xs font-mono text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                    />
                    <span>s (kürzere Teile werden mit dem vorherigen zusammengelegt)</span>
                  </label>
                  <span className="flex items-center gap-1.5 ml-auto">
                    <span className="w-2.5 h-2.5 rounded-sm bg-orange-400 inline-block" />
                    <span>orange = Grenze liegt mehr als 1 s neben dem nächsten Keyframe</span>
                  </span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Größen-Modus */}
        {modeType === 'size' && (
          <div className="space-y-4">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
              <label className="flex items-center gap-3">
                <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Max. Größe je Teil</span>
                <input
                  type="number"
                  min={1}
                  max={1048576}
                  step={50}
                  value={maxSizeMb}
                  onChange={(e) => setMaxSizeMb(Math.max(1, Number(e.target.value) || 1))}
                  className="w-28 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-lg font-mono font-bold text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                />
                <span className="text-sm font-semibold text-blue-600 dark:text-blue-400">MB</span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-zinc-400 mr-1">Schnellwahl:</span>
                {quickChipsSize.map((c) => (
                  <button
                    key={c.mb}
                    type="button"
                    onClick={() => setMaxSizeMb(c.mb)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      maxSizeMb === c.mb
                        ? 'bg-blue-600 text-white shadow-xs'
                        : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              Splity summiert die Paketgrößen je Keyframe-Abschnitt und schneidet, bevor ein Teil das Limit überschreitet (1,5 % Reserve für den Container). Praktisch für Upload-Grenzen.
              {hasSizes && largestPart > 0 && (
                <span className="ml-1 font-medium text-zinc-700 dark:text-zinc-300">Größter Teil: ca. {formatBytes(largestPart)}.</span>
              )}
            </div>
          </div>
        )}

        {/* Ausschnitt (Trimmen) */}
        {modeType === 'trim' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {(['start', 'end'] as const).map((which) => {
                const value = which === 'start' ? trimStartText : trimEndText;
                const setValue = which === 'start' ? setTrimStartText : setTrimEndText;
                return (
                  <div key={which} className="space-y-1.5">
                    <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">{which === 'start' ? 'Anfang' : 'Ende'}</div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={value}
                        placeholder={which === 'start' ? '00:00:00' : formatTime(probe.duration)}
                        onChange={(e) => setValue(e.target.value)}
                        className="flex-1 min-w-0 px-3 py-2 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 font-mono text-base font-bold text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                      />
                      <button
                        type="button"
                        onClick={() => setValue(formatTime(Math.floor(playerTime)))}
                        disabled={!showPlayer}
                        title="Aktuelle Position im Player übernehmen"
                        className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
                      >
                        = Player ({formatTime(playerTime)})
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="text-xs text-zinc-500 dark:text-zinc-400">
              {trimValid
                ? `Behalten wird ${formatTime(trimStart)} – ${formatTime(trimEnd)}; beide Grenzen landen auf dem nächsten Keyframe, der Rest wird verworfen. Format hh:mm:ss, mm:ss oder Sekunden.`
                : 'Bitte Anfang und Ende als hh:mm:ss angeben – das Ende muss nach dem Anfang liegen.'}
            </div>
          </div>
        )}

        {/* Counter & Chips */}
        {(modeType === 'count' || modeType === 'every') && (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <button
              onClick={() => {
                if (modeType === 'count') {
                  setPartCount((prev) => Math.max(2, prev - 1));
                } else {
                  setEveryMinutes((prev) => Math.max(1, prev - 1));
                }
              }}
              className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 flex items-center justify-center transition-colors cursor-pointer shadow-xs active:scale-95"
              aria-label="Verringern"
            >
              <Minus className="w-5 h-5" />
            </button>

            <div className="flex flex-col items-center min-w-[120px]">
              <div className="text-4xl font-extrabold text-zinc-900 dark:text-zinc-100 font-mono tracking-tight">
                {modeType === 'count' ? partCount : everyMinutes}
              </div>
              <div className="text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider mt-0.5">
                {modeType === 'count' ? 'Teile' : 'Minuten'}
              </div>
            </div>

            <button
              onClick={() => {
                if (modeType === 'count') {
                  setPartCount((prev) => Math.min(200, prev + 1));
                } else {
                  setEveryMinutes((prev) => prev + 1);
                }
              }}
              className="w-12 h-12 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 flex items-center justify-center transition-colors cursor-pointer shadow-xs active:scale-95"
              aria-label="Erhöhen"
            >
              <Plus className="w-5 h-5" />
            </button>
          </div>

          {/* Quick Select Chips */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-zinc-400 mr-1">Schnellwahl:</span>
            {(modeType === 'count' ? quickChipsCount : quickChipsMinutes).map((val) => {
              const isActive = modeType === 'count' ? partCount === val : everyMinutes === val;
              return (
                <button
                  key={val}
                  onClick={() => {
                    if (modeType === 'count') {
                      setPartCount(val);
                    } else {
                      setEveryMinutes(val);
                    }
                  }}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-xs'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                  }`}
                >
                  {val} {modeType === 'every' ? 'min' : ''}
                </button>
              );
            })}
          </div>
        </div>

        )}

        {/* Timeline Visualization */}
        {plan && (
          <div className="pt-2">
            <Timeline
              duration={probe.duration}
              parts={plan.parts}
              cuts={plan.cuts}
              keyframes={probe.keyframes}
              markers={modeType === 'scenes' ? sceneMarkers : undefined}
              onSeek={showPlayer ? seek : undefined}
              activePartIndex={hoveredPartIndex ?? undefined}
              onHoverPart={setHoveredPartIndex}
            />
          </div>
        )}

        {/* Plan Warnings */}
        {plan && plan.warnings.length > 0 && (
          <div className="p-4 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/60 text-amber-800 dark:text-amber-300 text-sm flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              {plan.warnings.map((w, i) => (
                <div key={i}>{w}</div>
              ))}
            </div>
          </div>
        )}

        {/* Parts List with Thumbnails */}
        {plan && plan.parts.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              <span>
                {modeType === 'trim'
                  ? `Ausschnitt: ${keptParts.length} von ${plan.parts.length} Teilen wird behalten`
                  : `Vorschau der ${plan.parts.length} Teilstücke`}
              </span>
              <span>
                {hasSizes && modeType === 'size'
                  ? `Größter Teil: ca. ${formatBytes(largestPart)}`
                  : `Dauer pro Teil: ca. ${formatTime(keptParts[0]?.duration || plan.parts[0]?.duration || 0)}`}
              </span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-80 overflow-y-auto pr-1">
              {plan.parts.map((p) => {
                const isHovered = hoveredPartIndex === p.index;

                return (
                  <div
                    key={p.index}
                    onMouseEnter={() => setHoveredPartIndex(p.index)}
                    onMouseLeave={() => setHoveredPartIndex(null)}
                    onClick={() => showPlayer && seek(p.start)}
                    title={showPlayer ? `Zu ${formatTime(p.start)} springen` : undefined}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${showPlayer ? 'cursor-pointer' : ''} ${
                      p.keep === false
                        ? 'border-dashed border-zinc-300 dark:border-zinc-700 opacity-50'
                        : isHovered
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 shadow-xs'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40'
                    }`}
                  >
                    {/* Lazy loaded thumbnail */}
                    <div className="w-16 h-10 rounded-lg bg-zinc-200 dark:bg-zinc-700 overflow-hidden shrink-0 relative">
                      <img
                        src={`/api/videos/${encodeURIComponent(videoId)}/thumb?t=${p.start}`}
                        alt={`Teil ${p.index}`}
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          // Hide broken image placeholder
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="font-bold text-xs text-zinc-900 dark:text-zinc-100">
                        {p.keep === false ? 'Wird verworfen' : modeType === 'trim' ? 'Ausschnitt' : `Teil ${p.index}`}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                        {formatTime(p.start)} – {formatTime(p.end)}
                      </div>
                      <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        {formatTime(p.duration)}
                        {typeof p.bytes === 'number' && <span className="text-zinc-400 font-normal"> · ca. {formatBytes(p.bytes)}</span>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* LosslessCut-CSV */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={downloadLosslessCutCsv}
                title="Schnittplan als CSV (start,end,name) für die Feinarbeit in LosslessCut"
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-zinc-500 hover:text-blue-600 dark:hover:text-blue-400 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Plan als LosslessCut-CSV
              </button>
            </div>

            {/* Deviation Notice */}
            {plan.maxDeltaSeconds > 1.0 && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-3 rounded-xl border border-zinc-200 dark:border-zinc-700/60 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span>
                  Schnitte liegen auf Keyframes (max. Abweichung {plan.maxDeltaSeconds.toFixed(1)} s) – nur so bleibt es verlustfrei.
                </span>
              </div>
            )}
          </div>
        )}

        {/* Kapitel-Export (nur Szenen-Modus) */}
        {modeType === 'scenes' && scenes && onStartChapters && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/60">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              <div className="font-semibold text-zinc-800 dark:text-zinc-200">Oder nur Sprungmarken setzen</div>
              {chaptersPossible
                ? `Kopie mit ${activeBoundaries.size + 1} Kapiteln an den gewählten Grenzen – bildgenau, ohne Schnitt, verlustfrei. Dazu eine CSV mit den Zeiten.`
                : `Kapitel gehen nur bei MP4, MOV und MKV (dieses Video: ${probe.container}).`}
            </div>
            <button
              type="button"
              onClick={() => onStartChapters(boundaryTimes)}
              disabled={isStartingSplit || sceneProgress !== null || activeBoundaries.size === 0 || !chaptersPossible}
              className="shrink-0 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 hover:bg-zinc-100 dark:hover:bg-zinc-800 disabled:opacity-40 text-zinc-800 dark:text-zinc-100 text-sm font-semibold transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <BookmarkPlus className="w-4 h-4" />
              Als Kapitel speichern
            </button>
          </div>
        )}

        {/* Big Action Button */}
        <div className="pt-2">
          <button
            onClick={() => onStartSplit(currentMode)}
            disabled={
              isStartingSplit ||
              !plan ||
              sceneProgress !== null ||
              (modeType === 'trim' ? !trimValid || keptParts.length === 0 || plan.parts.length <= 1 : plan.parts.length <= 1)
            }
            className="w-full py-4 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 text-white font-bold text-base transition-all shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/30 flex items-center justify-center gap-3 cursor-pointer disabled:cursor-not-allowed"
          >
            <Scissors className="w-5 h-5" />
            <span>
              {isStartingSplit
                ? 'Wird vorbereitet...'
                : modeType === 'scenes' && (!scenes || activeBoundaries.size === 0)
                ? scenes
                  ? 'Keine Szenengrenze gewählt'
                  : 'Erst Szenen erkennen'
                : modeType === 'trim'
                ? trimValid && keptParts.length > 0
                  ? `Ausschnitt ${formatTime(keptParts[0].start)} – ${formatTime(keptParts[keptParts.length - 1].end)} speichern`
                  : 'Bereich wählen'
                : modeType === 'size'
                ? `In ${totalCalculatedParts} Teile schneiden (max. ${maxSizeMb >= 1024 ? `${(maxSizeMb / 1024).toFixed(maxSizeMb % 1024 === 0 ? 0 : 1)} GB` : `${maxSizeMb} MB`})`
                : `In ${totalCalculatedParts} Teile schneiden`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
