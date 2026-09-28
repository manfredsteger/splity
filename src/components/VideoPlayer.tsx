import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AlertCircle, Clapperboard, Loader2, Play, X } from 'lucide-react';
import { formatBytes, formatTime } from '../utils/format.js';
import type { PreviewKind, PreviewStatus } from '../types.js';

export interface VideoPlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

interface VideoPlayerProps {
  videoId: string;
  container: string;
  codec?: string;
  /** Mittlerer Keyframe-Abstand (s) – nur für den Hinweis zur Keyframe-Kopie */
  keyframeIntervalAvg?: number;
  onTimeUpdate?: (seconds: number) => void;
}

const MIME_BY_CONTAINER: Record<string, string> = {
  MP4: 'video/mp4',
  M4V: 'video/mp4',
  MOV: 'video/quicktime',
  MKV: 'video/x-matroska',
  WEBM: 'video/webm',
  AVI: 'video/x-msvideo',
  TS: 'video/mp2t',
};

const IDLE: PreviewStatus = { available: false, building: false, percent: 0 };

/**
 * Vorschau per HTTP-Range-Streaming. Kann der Browser das Format nicht (MKV, HEVC, 5K …),
 * lässt sich eine kleine H.264-Vorschau-Kopie erzeugen – die Quelle bleibt unverändert,
 * geschnitten wird immer das Original.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ videoId, container, codec, keyframeIntervalAvg, onTimeUpdate }, ref) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [current, setCurrent] = useState(0);
  const [preview, setPreview] = useState<PreviewStatus>(IDLE);
  const [useProxy, setUseProxy] = useState(false);
  const esRef = useRef<EventSource | null>(null);
  const pendingSeekRef = useRef<number | null>(null);

  const src = useProxy && preview.available
    ? `/api/videos/${encodeURIComponent(videoId)}/preview/stream`
    : `/api/videos/${encodeURIComponent(videoId)}/stream`;

  const closeEvents = () => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  };

  // Fortschritt der Vorschau-Kopie mitlesen
  const watchBuild = useCallback(
    (id: string) => {
      closeEvents();
      const es = new EventSource(`/api/videos/${encodeURIComponent(id)}/preview/events`);
      esRef.current = es;
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { type: string; percent?: number; error?: string; status?: PreviewStatus };
          if (data.type === 'progress') {
            setPreview((p) => ({ ...(data.status || p), building: true, percent: data.percent || 0 }));
          } else if (data.type === 'done') {
            closeEvents();
            setPreview(data.status || { available: true, kind: 'keyframes', building: false, percent: 100 });
            setUseProxy(true);
            setUnsupported(false);
          } else if (data.type === 'error') {
            closeEvents();
            setPreview((p) => ({ ...p, building: false, buildingKind: undefined, percent: 0, error: data.error }));
          } else if (data.type === 'idle') {
            closeEvents();
            setPreview(IDLE);
          }
        } catch {
          // ignore
        }
      };
      es.onerror = () => {
        // EventSource verbindet sich selbst neu
      };
    },
    []
  );

  useEffect(() => {
    setUnsupported(false);
    setCurrent(0);
    setPreview(IDLE);
    setUseProxy(false);
    let cancelled = false;
    fetch(`/api/videos/${encodeURIComponent(videoId)}/preview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((status: PreviewStatus | null) => {
        if (cancelled || !status) return;
        setPreview(status);
        if (status.available) setUseProxy(true);
        if (status.building) watchBuild(videoId);
      })
      .catch(() => undefined);
    const el = videoRef.current;
    const mime = MIME_BY_CONTAINER[(container || '').toUpperCase()];
    if (el && mime && el.canPlayType(mime) === '') {
      setUnsupported(true);
    }
    return () => {
      cancelled = true;
      closeEvents();
    };
  }, [videoId, container, watchBuild]);

  const startBuild = useCallback(async (kind: PreviewKind = 'keyframes') => {
    setPreview((p) => ({ ...p, building: true, buildingKind: kind, percent: 0, error: undefined }));
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Vorschau-Kopie konnte nicht gestartet werden.');
      }
      const status = (await res.json()) as PreviewStatus;
      setPreview(status);
      if (status.building) {
        watchBuild(videoId);
      } else if (status.available) {
        setUseProxy(true);
        setUnsupported(false);
      }
    } catch (err: any) {
      setPreview((p) => ({ ...p, building: false, buildingKind: undefined, percent: 0, error: err.message }));
    }
  }, [videoId, watchBuild]);

  const cancelBuild = useCallback(async () => {
    try {
      await fetch(`/api/videos/${encodeURIComponent(videoId)}/preview`, { method: 'DELETE' });
    } catch {
      // ignore
    }
    closeEvents();
    setPreview((p) => ({ ...p, building: false, buildingKind: undefined, percent: 0 }));
  }, [videoId]);

  const doSeek = useCallback((seconds: number, play: boolean) => {
    const el = videoRef.current;
    if (!el) return;
    try {
      el.currentTime = Math.max(0, seconds);
      if (play) void el.play().catch(() => undefined);
    } catch {
      // ignore
    }
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds: number, play = false) => {
        const el = videoRef.current;
        if (!el || (unsupported && !(useProxy && preview.available))) return;
        if (el.readyState === 0) {
          // Metadaten noch nicht da (z. B. gerade auf die Kopie gewechselt): später springen
          pendingSeekRef.current = seconds;
          return;
        }
        doSeek(seconds, play);
      },
    }),
    [unsupported, useProxy, preview.available, doSeek]
  );

  const playerUsable = !unsupported || (useProxy && preview.available);

  const buildPanel = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/60 text-sm text-zinc-600 dark:text-zinc-400">
      <AlertCircle className="w-5 h-5 shrink-0 text-zinc-400" />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-zinc-800 dark:text-zinc-200">Vorschau in diesem Browser nicht möglich</div>
        <div className="text-xs mt-0.5">
          {container}
          {codec ? ` mit ${codec.toUpperCase()}` : ''} kann der Browser nicht abspielen. Eine kleine Vorschau-Kopie (H.264, max. 854 px) löst das –
          der Schnitt läuft trotzdem am Original, die Vorschaubilder gehen immer.
        </div>
        <div className="text-xs mt-1">
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">Schnell</span> decodiert nur die Keyframes – genau die Bilder, an denen
          verlustfrei geschnitten werden kann{keyframeIntervalAvg ? ` (hier etwa alle ${keyframeIntervalAvg.toFixed(1)} s)` : ''} – und ist in Sekunden bis wenigen Minuten fertig.{' '}
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">Vollständig</span> decodiert jedes Bild und dauert bei langen 4K/5K-Videos sehr lange.
        </div>
        {preview.error && <div className="text-xs mt-1 text-red-600 dark:text-red-400">{preview.error}</div>}
        {preview.building && (
          <div className="mt-2 space-y-1">
            <div className="w-full h-1.5 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 rounded-full transition-all duration-300" style={{ width: `${Math.max(2, preview.percent)}%` }} />
            </div>
            <div className="text-[11px]">
              {preview.buildingKind === 'full' ? 'Vollständige Kopie' : 'Schnelle Keyframe-Kopie'} wird erzeugt … {preview.percent} %
            </div>
          </div>
        )}
      </div>
      {preview.building ? (
        <button
          type="button"
          onClick={cancelBuild}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
          Abbrechen
        </button>
      ) : (
        <div className="shrink-0 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => startBuild('keyframes')}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white cursor-pointer"
          >
            <Clapperboard className="w-3.5 h-3.5" />
            Schnelle Kopie (nur Keyframes)
          </button>
          <button
            type="button"
            onClick={() => startBuild('full')}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-300 dark:hover:bg-zinc-600 cursor-pointer"
          >
            Vollständige Kopie (langsam)
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-1.5">
      {!playerUsable && buildPanel}
      <div className={`relative rounded-xl overflow-hidden bg-black border border-zinc-200 dark:border-zinc-800 ${playerUsable ? '' : 'hidden'}`}>
        <video
          ref={videoRef}
          key={`${videoId}:${useProxy && preview.available ? 'proxy' : 'orig'}`}
          src={src}
          controls
          preload="metadata"
          playsInline
          className="w-full max-h-[360px] bg-black"
          onLoadedMetadata={() => {
            if (pendingSeekRef.current !== null) {
              const t = pendingSeekRef.current;
              pendingSeekRef.current = null;
              doSeek(t, false);
            }
          }}
          onTimeUpdate={(e) => {
            const t = (e.target as HTMLVideoElement).currentTime;
            setCurrent(t);
            onTimeUpdate?.(t);
          }}
          onError={() => {
            if (useProxy && preview.available) return; // Kopie kaputt? Nicht endlos umschalten
            if (preview.available) {
              setUseProxy(true);
            } else {
              setUnsupported(true);
            }
          }}
        />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
        <span className="flex items-center gap-1">
          <Play className="w-3 h-3" />
          <span>
            {useProxy && preview.available && preview.kind === 'keyframes'
              ? `Keyframe-Kopie: zeigt nur die Bilder an den möglichen Schnittstellen${keyframeIntervalAvg ? ` (etwa alle ${keyframeIntervalAvg.toFixed(1)} s)` : ''}`
              : 'Klick auf einen Teil, ein Segment oder eine Szene springt dorthin'}
          </span>
        </span>
        <span className="flex items-center gap-3">
          {preview.available && (
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setUseProxy(true)}
                className={`px-1.5 py-0.5 rounded cursor-pointer ${useProxy ? 'bg-blue-600 text-white' : 'hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                title={`Kleine Vorschau-Kopie${preview.kind === 'keyframes' ? ', nur Keyframes' : ''}${preview.size ? ` (${formatBytes(preview.size)})` : ''}`}
              >
                {preview.kind === 'keyframes' ? 'Kopie (Keyframes)' : 'Kopie'}
              </button>
              <button
                type="button"
                onClick={() => setUseProxy(false)}
                disabled={unsupported}
                className={`px-1.5 py-0.5 rounded cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${!useProxy ? 'bg-blue-600 text-white' : 'hover:text-zinc-900 dark:hover:text-zinc-100'}`}
                title={unsupported ? 'Das Original kann dieser Browser nicht abspielen' : 'Originaldatei abspielen'}
              >
                Original
              </button>
            </span>
          )}
          {playerUsable && preview.building && (
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {preview.buildingKind === 'full' ? 'Vollständige Kopie' : 'Keyframe-Kopie'} {preview.percent} %
              <button type="button" onClick={cancelBuild} className="underline cursor-pointer">abbrechen</button>
            </span>
          )}
          {playerUsable && !preview.building && !preview.available && (
            <button type="button" onClick={() => startBuild('keyframes')} className="underline hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer" title="Kleine H.264-Kopie nur aus den Keyframes – schnell erzeugt, ideal zum Setzen der Schnittstellen bei sehr großen Videos">
              schnelle Vorschau-Kopie erzeugen
            </button>
          )}
          {playerUsable && !preview.building && preview.available && preview.kind === 'keyframes' && (
            <button type="button" onClick={() => startBuild('full')} className="underline hover:text-zinc-900 dark:hover:text-zinc-100 cursor-pointer" title="Alle Bilder decodieren – flüssige Wiedergabe, dauert bei langen Videos lange">
              vollständige Kopie erzeugen
            </button>
          )}
          <span className="font-mono">{formatTime(current)}</span>
        </span>
      </div>
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';
