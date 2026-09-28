import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, forwardRef } from 'react';
import { Clock, ZoomIn, ZoomOut } from 'lucide-react';
import { formatTime, formatTimePrecise } from '../utils/format.js';

/**
 * Gemeinsame Zeitleiste aller Modi: Lineal-Spur (ziehen = Nadel setzen), darunter die Spur mit
 * Teilen/Segmenten (Inhalt kommt vom Aufrufer), Keyframe-Ticks, Zoom.
 *
 * Regel: Nichts hier darf beim Bewegen der Maus seine Höhe ändern – ein früherer Umbruch der
 * Kopfzeile ließ die Leiste unter dem Zeiger springen. Cursor-Zeit ist deshalb ein schwebendes Label.
 */
export const ZOOM_STEPS = [1, 2, 4, 8, 16, 32];
const RULER_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];

export type NeedlePhase = 'drag' | 'end';

export interface ScrubberHandle {
  /** Zeit aus einer clientX-Koordinate (0..duration) */
  timeFromClientX: (clientX: number) => number;
  track: HTMLDivElement | null;
}

interface ScrubberProps {
  duration: number;
  keyframes: number[];
  needle: number;
  /** Nadel bewegt: phase 'drag' während des Ziehens, 'end' beim Loslassen (auch bei Klick) */
  onNeedle: (time: number, phase: NeedlePhase) => void;
  /** Nadel beim Ziehen auf Keyframes einrasten */
  snapNeedle?: boolean;
  /** Ziehen/Klicken auf der Spur (nicht auf Kind-Elementen) bewegt ebenfalls die Nadel */
  trackScrub?: boolean;
  /** Eigene Zeiger-Handler für die Spur (Segment-Editor: aufziehen/verschieben) */
  trackProps?: React.HTMLAttributes<HTMLDivElement>;
  trackClassName?: string;
  trackStyle?: React.CSSProperties;
  /** Inhalt der Spur (absolut positioniert) */
  children?: React.ReactNode;
  zoom?: number;
  onZoom?: (zoom: number) => void;
  /** Rechts in der Kopfzeile (z. B. Zoom-Knöpfe kommen automatisch) */
  headerLeft?: React.ReactNode;
  headerRight?: React.ReactNode;
  /** Unter der Leiste (Legende) */
  footer?: React.ReactNode;
}

export function snapToPoints(points: number[], t: number): number {
  if (points.length === 0) return t;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[Math.max(0, lo - 1)];
  return Math.abs(a - t) < Math.abs(b - t) ? a : b;
}

export const Scrubber = forwardRef<ScrubberHandle, ScrubberProps>(
  (
    {
      duration,
      keyframes,
      needle,
      onNeedle,
      snapNeedle = false,
      trackScrub = false,
      trackProps,
      trackClassName,
      trackStyle,
      children,
      zoom: zoomProp,
      onZoom,
      headerLeft,
      headerRight,
      footer,
    },
    ref
  ) => {
    const [zoomState, setZoomState] = useState(1);
    const zoom = zoomProp ?? zoomState;
    const setZoom = useCallback(
      (z: number) => {
        setZoomState(z);
        onZoom?.(z);
      },
      [onZoom]
    );
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const laneRef = useRef<HTMLDivElement | null>(null); // gemeinsame Breite von Lineal + Spur
    const trackRef = useRef<HTMLDivElement | null>(null);
    const scrubbing = useRef(false);

    const snapPoints = useMemo(() => {
      const inner = keyframes.filter((k) => k >= 0.05 && k <= duration - 0.05);
      return Array.from(new Set([0, ...inner, Math.round(duration * 1000) / 1000])).sort((a, b) => a - b);
    }, [keyframes, duration]);

    const timeFromClientX = useCallback(
      (clientX: number) => {
        const el = laneRef.current;
        if (!el || duration <= 0) return 0;
        const r = el.getBoundingClientRect();
        return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration;
      },
      [duration]
    );

    useImperativeHandle(ref, () => ({ timeFromClientX, track: trackRef.current }), [timeFromClientX]);

    const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;
    const needleTime = (clientX: number) => {
      const t = timeFromClientX(clientX);
      return snapNeedle ? snapToPoints(snapPoints, t) : t;
    };

    // ---- Nadel ziehen (Lineal, optional auch Spur) ----
    const startScrub = (e: React.PointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      scrubbing.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      onNeedle(needleTime(e.clientX), 'drag');
    };
    const moveScrub = (e: React.PointerEvent<HTMLElement>) => {
      setHoverTime(timeFromClientX(e.clientX));
      if (!scrubbing.current) return;
      onNeedle(needleTime(e.clientX), 'drag');
    };
    const endScrub = (e: React.PointerEvent<HTMLElement>) => {
      if (!scrubbing.current) return;
      scrubbing.current = false;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      onNeedle(needleTime(e.clientX), 'end');
    };

    // Strg/Cmd + Mausrad zoomt
    useEffect(() => {
      const el = scrollRef.current;
      if (!el) return;
      const onWheel = (ev: WheelEvent) => {
        if (!ev.ctrlKey && !ev.metaKey) return;
        ev.preventDefault();
        const idx = ZOOM_STEPS.indexOf(zoom);
        setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + (ev.deltaY < 0 ? 1 : -1)))]);
      };
      el.addEventListener('wheel', onWheel, { passive: false });
      return () => el.removeEventListener('wheel', onWheel);
    }, [zoom, setZoom]);

    // Nadel im sichtbaren Bereich halten, wenn gezoomt
    useEffect(() => {
      const sc = scrollRef.current;
      const lane = laneRef.current;
      if (!sc || !lane || zoom <= 1 || duration <= 0) return;
      const x = (needle / duration) * lane.clientWidth;
      if (x < sc.scrollLeft + 20 || x > sc.scrollLeft + sc.clientWidth - 20) {
        sc.scrollLeft = Math.max(0, x - sc.clientWidth / 2);
      }
    }, [needle, zoom, duration]);

    const rulerStep = useMemo(() => RULER_STEPS.find((st) => duration / st <= 8 * zoom) || RULER_STEPS[RULER_STEPS.length - 1], [duration, zoom]);
    const rulerMarks = useMemo(() => {
      const out: number[] = [];
      for (let t = 0; t < duration; t += rulerStep) if (t === 0 || (duration - t) / duration > 0.05 / zoom) out.push(t);
      return out;
    }, [duration, rulerStep, zoom]);
    const sampledKeyframes = useMemo(() => {
      const max = 3000;
      if (keyframes.length <= max) return keyframes;
      const step = Math.ceil(keyframes.length / max);
      return keyframes.filter((_, i) => i % step === 0);
    }, [keyframes]);

    const zoomTo = (dir: -1 | 1) => {
      const idx = ZOOM_STEPS.indexOf(zoom);
      setZoom(ZOOM_STEPS[Math.min(ZOOM_STEPS.length - 1, Math.max(0, idx + dir))]);
    };

    // Schwebendes Zeit-Label nicht über den Rand hinaus
    const labelPos = (t: number) => {
      const w = laneRef.current?.clientWidth || 800;
      const margin = (45 / w) * duration;
      return pct(Math.min(duration - margin, Math.max(margin, t)));
    };

    const trackScrubProps: React.HTMLAttributes<HTMLDivElement> = trackScrub
      ? {
          onPointerDown: (e) => {
            if (e.target !== e.currentTarget) return; // Kind-Element (Teil) hat eigene Bedeutung
            startScrub(e);
          },
          onPointerMove: moveScrub,
          onPointerUp: endScrub,
          onPointerCancel: endScrub,
        }
      : {};

    return (
      <div className="space-y-2 select-none">
        {(headerLeft || headerRight) && (
          <div className="flex items-center justify-between gap-3 min-h-8">
            <div className="min-w-0">{headerLeft}</div>
            <div className="flex items-center gap-2 shrink-0">
              {headerRight}
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => zoomTo(-1)} disabled={zoom === ZOOM_STEPS[0]} className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 flex items-center justify-center cursor-pointer" title="Herauszoomen (Strg + Mausrad)">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[11px] font-mono w-8 text-center text-zinc-500">{zoom}×</span>
                <button type="button" onClick={() => zoomTo(1)} disabled={zoom === ZOOM_STEPS[ZOOM_STEPS.length - 1]} className="w-7 h-7 rounded-lg bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 flex items-center justify-center cursor-pointer" title="Hineinzoomen (Strg + Mausrad)">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        <div ref={scrollRef} className={`w-full pb-1 ${zoom > 1 ? 'overflow-x-auto' : 'overflow-x-hidden'}`}>
          <div ref={laneRef} style={{ width: `${zoom * 100}%` }} className="min-w-full relative">
            {/* Lineal = Scrub-Spur */}
            <div
              onPointerDown={startScrub}
              onPointerMove={moveScrub}
              onPointerUp={endScrub}
              onPointerCancel={endScrub}
              onPointerLeave={() => setHoverTime(null)}
              className="relative h-7 rounded-t-lg bg-zinc-100 dark:bg-zinc-800/70 border-b border-zinc-300 dark:border-zinc-700 cursor-ew-resize touch-none overflow-hidden"
              title="Ziehen oder klicken: Nadel setzen (Vorschau springt mit)"
            >
              {rulerMarks.map((t) => (
                <span key={t} className={`absolute top-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 whitespace-nowrap pointer-events-none ${t === 0 ? 'pl-1' : '-translate-x-1/2'}`} style={{ left: pct(t) }}>
                  {formatTime(t)}
                </span>
              ))}
              <span className="absolute top-1 right-1 text-[10px] font-mono text-zinc-500 dark:text-zinc-400 pointer-events-none">{formatTime(duration)}</span>
              {hoverTime !== null && !scrubbing.current && (
                <div className="absolute bottom-0.5 -translate-x-1/2 px-1.5 py-0.5 rounded bg-zinc-900/85 text-white text-[10px] font-mono pointer-events-none z-30 whitespace-nowrap flex items-center gap-1" style={{ left: labelPos(hoverTime) }}>
                  <Clock className="w-2.5 h-2.5" />
                  {formatTimePrecise(snapNeedle ? snapToPoints(snapPoints, hoverTime) : hoverTime)}
                </div>
              )}
            </div>

            {/* Spur */}
            <div
              ref={trackRef}
              {...trackScrubProps}
              {...trackProps}
              className={`relative w-full h-16 overflow-hidden shadow-inner bg-zinc-200 dark:bg-zinc-800 touch-none ${trackClassName || ''}`}
              style={trackStyle}
            >
              {children}
            </div>

            {/* Keyframes */}
            <div className="relative w-full h-2 mt-1 overflow-hidden pointer-events-none">
              {sampledKeyframes.map((kf, i) => (
                <div key={i} className="absolute top-0 w-px h-2 bg-zinc-400 dark:bg-zinc-600 opacity-60" style={{ left: pct(kf) }} />
              ))}
            </div>

            {/* Nadel über Lineal + Spur */}
            <div className="absolute top-0 bottom-3 w-[2px] bg-red-500 pointer-events-none z-40 -translate-x-1/2" style={{ left: pct(needle) }}>
              <div className="absolute top-0 left-1/2 -translate-x-1/2 w-0 h-0 border-l-[7px] border-r-[7px] border-t-[9px] border-l-transparent border-r-transparent border-t-red-500" />
            </div>
          </div>
        </div>

        {footer}
      </div>
    );
  }
);

Scrubber.displayName = 'Scrubber';
