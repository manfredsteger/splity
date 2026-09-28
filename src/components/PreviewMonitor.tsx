import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Magnet, Play, SkipBack, SkipForward, Square } from 'lucide-react';
import { VideoPlayer, type VideoPlayerHandle } from './VideoPlayer.js';
import { formatTimePrecise } from '../utils/format.js';
import type { NeedlePhase } from './Scrubber.js';

/**
 * Monitor: zeigt das Bild an der Nadel als Server-Einzelbild – unabhängig davon, ob der Browser den
 * Codec kann. Beim Ziehen sofort der letzte Keyframe (schnell, aus der Kopie), nach dem Loslassen
 * das exakte Bild (wird nachgeladen). Abspielen ist optional über das Videoelement.
 */
interface PreviewMonitorProps {
  videoId: string;
  duration: number;
  fps: number;
  keyframes: number[];
  container: string;
  codec?: string;
  keyframeIntervalAvg?: number;
  needle: number;
  /** true, solange die Nadel gezogen wird oder das Video läuft – dann nur Keyframe-Bilder */
  needleLive: boolean;
  onNeedle: (time: number, phase: NeedlePhase) => void;
}

export function keyframeAtOrBefore(keyframes: number[], t: number): number {
  let best = 0;
  for (const k of keyframes) {
    if (k <= t + 0.0005) best = k;
    else break;
  }
  return best;
}

interface Shown {
  url: string;
  time: number;
  exact: boolean;
  blob?: boolean;
}

export const PreviewMonitor: React.FC<PreviewMonitorProps> = ({
  videoId,
  duration,
  fps,
  keyframes,
  container,
  codec,
  keyframeIntervalAvg,
  needle,
  needleLive,
  onNeedle,
}) => {
  const [shown, setShown] = useState<Shown | null>(null);
  const [loadingExact, setLoadingExact] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [playerOpen, setPlayerOpen] = useState(false);
  const playerRef = useRef<VideoPlayerHandle | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastPlayerTime = useRef<number | null>(null);
  const frame = Math.max(0.01, fps > 0 ? 1 / fps : 0.04);
  const clamp = useCallback((t: number) => Math.min(Math.max(0, duration - 0.001), Math.max(0, t)), [duration]);

  const kfTime = keyframeAtOrBefore(keyframes, needle);
  const onKeyframe = keyframes.some((k) => Math.abs(k - needle) < 0.02) || needle < 0.02;
  const frameUrl = (t: number, exact: boolean) => `/api/videos/${encodeURIComponent(videoId)}/frame?t=${t.toFixed(3)}&exact=${exact ? 1 : 0}&size=monitor`;

  // Neues Video: alles zurücksetzen
  useEffect(() => {
    setShown((s) => {
      if (s?.blob) URL.revokeObjectURL(s.url);
      return null;
    });
    setError(null);
    setPlayerOpen(false);
  }, [videoId]);

  // 1) Keyframe-Bild sofort (vorladen, erst beim Laden umschalten – kein Flackern)
  useEffect(() => {
    if (duration <= 0) return;
    const target = onKeyframe ? needle : kfTime;
    if (shown && !shown.exact && Math.abs(shown.time - target) < 0.005) return;
    if (shown && shown.exact && Math.abs(shown.time - needle) < 0.005) return;
    let cancelled = false;
    const img = new Image();
    const url = frameUrl(target, false);
    img.onload = () => {
      if (cancelled) return;
      setShown((s) => {
        if (s?.blob) URL.revokeObjectURL(s.url);
        return { url, time: target, exact: onKeyframe };
      });
      setError(null);
    };
    img.onerror = () => {
      if (!cancelled) setError('Einzelbild konnte nicht erzeugt werden.');
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, needle, kfTime, onKeyframe, duration]);

  // 2) Exaktes Bild nach dem Loslassen (zwischen zwei Keyframes)
  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoadingExact(false);
    if (needleLive || onKeyframe || duration <= 0) return;
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const timer = setTimeout(async () => {
      setLoadingExact(true);
      try {
        const res = await fetch(frameUrl(needle, true), { signal: ctrl.signal });
        if (!res.ok) throw new Error('Einzelbild konnte nicht erzeugt werden.');
        const blob = await res.blob();
        if (ctrl.signal.aborted) return;
        const url = URL.createObjectURL(blob);
        setShown((s) => {
          if (s?.blob) URL.revokeObjectURL(s.url);
          return { url, time: needle, exact: true, blob: true };
        });
        setError(null);
      } catch (err: any) {
        if (err?.name !== 'AbortError') setError(err.message || 'Einzelbild konnte nicht erzeugt werden.');
      } finally {
        if (!ctrl.signal.aborted) setLoadingExact(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId, needle, needleLive, onKeyframe, duration]);

  // Player folgt der Nadel (aber nicht seinen eigenen Zeit-Updates)
  useEffect(() => {
    if (!playerOpen) return;
    if (lastPlayerTime.current !== null && Math.abs(lastPlayerTime.current - needle) < 0.01) return;
    playerRef.current?.seek(needle, false);
  }, [needle, playerOpen]);

  const stepKeyframe = (dir: -1 | 1) => {
    let target: number | undefined;
    if (dir > 0) target = keyframes.find((k) => k > needle + 0.02);
    else {
      for (let i = keyframes.length - 1; i >= 0; i--) {
        if (keyframes[i] < needle - 0.02) {
          target = keyframes[i];
          break;
        }
      }
      if (target === undefined) target = 0;
    }
    if (target === undefined) return;
    onNeedle(clamp(target), 'end');
  };
  const stepFrame = (dir: -1 | 1) => onNeedle(clamp(needle + dir * frame), 'end');
  const snap = () => {
    const pts = [0, ...keyframes, duration];
    let best = pts[0];
    for (const p of pts) if (Math.abs(p - needle) < Math.abs(best - needle)) best = p;
    onNeedle(clamp(best), 'end');
  };

  // Tastatur: ←/→ Keyframe, Shift+←/→ ein Bild
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const dir = e.key === 'ArrowLeft' ? -1 : 1;
        if (e.shiftKey) stepFrame(dir);
        else stepKeyframe(dir);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const badge = loadingExact
    ? { text: 'exaktes Bild wird geladen …', cls: 'bg-zinc-800/90 text-zinc-100', spin: true }
    : shown?.exact
    ? { text: onKeyframe ? `Keyframe ${formatTimePrecise(shown.time)} · Schnittstelle` : `exakt ${formatTimePrecise(shown.time)}`, cls: onKeyframe ? 'bg-emerald-600/90 text-white' : 'bg-blue-600/90 text-white', spin: false }
    : shown
    ? { text: `letzter Keyframe ${formatTimePrecise(shown.time)}`, cls: 'bg-amber-500/90 text-white', spin: false }
    : null;

  const btn = 'inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed';

  return (
    <div className="space-y-2">
      <div className="relative rounded-xl overflow-hidden bg-black border border-zinc-200 dark:border-zinc-800 aspect-video max-h-[380px] w-full flex items-center justify-center">
        {shown ? (
          <img src={shown.url} alt="" className="w-full h-full object-contain" draggable={false} />
        ) : (
          <div className="text-zinc-500 text-sm flex items-center gap-2">
            <Loader2 className="w-4 h-4 animate-spin" />
            Bild wird geladen …
          </div>
        )}
        {badge && (
          <div className={`absolute top-2 left-2 px-2 py-1 rounded-md text-[11px] font-semibold flex items-center gap-1.5 ${badge.cls}`}>
            {badge.spin && <Loader2 className="w-3 h-3 animate-spin" />}
            {badge.text}
          </div>
        )}
        <div className="absolute bottom-2 left-2 px-2 py-1 rounded-md bg-black/70 text-white font-mono text-sm">{formatTimePrecise(needle)}</div>
        {error && <div className="absolute bottom-2 right-2 px-2 py-1 rounded-md bg-red-600/90 text-white text-[11px]">{error}</div>}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" onClick={() => stepKeyframe(-1)} className={btn} title="Vorheriger Keyframe (←)">
            <SkipBack className="w-3.5 h-3.5" />
            Keyframe
          </button>
          <button type="button" onClick={() => stepFrame(-1)} className={btn} title="Ein Bild zurück (Shift + ←) – exaktes Bild wird nachgeladen">
            <ChevronLeft className="w-3.5 h-3.5" />
            Bild
          </button>
          <button type="button" onClick={() => stepFrame(1)} className={btn} title="Ein Bild vor (Shift + →) – exaktes Bild wird nachgeladen">
            Bild
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={() => stepKeyframe(1)} className={btn} title="Nächster Keyframe (→)">
            Keyframe
            <SkipForward className="w-3.5 h-3.5" />
          </button>
          <button type="button" onClick={snap} disabled={onKeyframe} className={btn} title="Nadel auf den nächstgelegenen Keyframe setzen (dort wird geschnitten)">
            <Magnet className="w-3.5 h-3.5" />
            Einrasten
          </button>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
            Schnitte nur an Keyframes{keyframeIntervalAvg ? ` (etwa alle ${keyframeIntervalAvg.toFixed(1)} s)` : ''}
          </span>
          <button
            type="button"
            onClick={() => {
              if (playerOpen) {
                setPlayerOpen(false);
                lastPlayerTime.current = null;
                onNeedle(needle, 'end');
              } else setPlayerOpen(true);
            }}
            className={`${btn} ${playerOpen ? 'ring-2 ring-blue-500/40' : ''}`}
            title="Video ab der Nadel abspielen (Videoelement des Browsers, ggf. Vorschau-Kopie)"
          >
            {playerOpen ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
            {playerOpen ? 'Player schließen' : 'Abspielen'}
          </button>
        </div>
      </div>

      {playerOpen && (
        <VideoPlayer
          ref={playerRef}
          videoId={videoId}
          container={container}
          codec={codec}
          keyframeIntervalAvg={keyframeIntervalAvg}
          keyframes={keyframes}
          onTimeUpdate={(t) => {
            lastPlayerTime.current = t;
            onNeedle(t, 'drag');
          }}
        />
      )}
    </div>
  );
};
