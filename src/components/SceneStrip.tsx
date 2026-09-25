import React, { useMemo } from 'react';
import { AlertTriangle, Check, Moon, Play, Scissors } from 'lucide-react';
import { formatTime } from '../utils/format.js';
import type { Scene } from '../types.js';

interface SceneStripProps {
  videoId: string;
  scenes: Scene[];
  keyframes: number[];
  /** Szenenanfänge (Sekunden), an denen geschnitten wird */
  activeBoundaries: Set<number>;
  onToggle: (start: number) => void;
  onSeek?: (seconds: number) => void;
}

/** Abstand einer Zeit zum nächstgelegenen Keyframe (Sekunden) */
export function nearestKeyframeDelta(time: number, keyframes: number[]): { keyframe: number; delta: number } {
  if (keyframes.length === 0) return { keyframe: time, delta: 0 };
  // Binärsuche, die Keyframe-Liste ist sortiert
  let lo = 0;
  let hi = keyframes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keyframes[mid] < time) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [keyframes[lo], keyframes[Math.max(0, lo - 1)]];
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c - time) < Math.abs(best - time)) best = c;
  }
  return { keyframe: best, delta: Math.abs(best - time) };
}

export const SceneStrip: React.FC<SceneStripProps> = ({ videoId, scenes, keyframes, activeBoundaries, onToggle, onSeek }) => {
  const deltas = useMemo(
    () => new Map(scenes.map((s) => [s.index, nearestKeyframeDelta(s.start, keyframes)])),
    [scenes, keyframes]
  );

  return (
    <div className="flex gap-2.5 overflow-x-auto pb-2 pr-1 snap-x">
      {scenes.map((scene) => {
        const isFirst = scene.index === 1;
        const isActive = !isFirst && activeBoundaries.has(scene.start);
        const kf = deltas.get(scene.index) || { keyframe: scene.start, delta: 0 };
        const farFromKeyframe = !isFirst && kf.delta > 1;

        return (
          <button
            key={scene.index}
            type="button"
            disabled={isFirst}
            onClick={() => onToggle(scene.start)}
            title={
              isFirst
                ? 'Erste Szene beginnt immer bei 00:00'
                : farFromKeyframe
                ? `Liegt auf Keyframe bei ${formatTime(kf.keyframe)} (Abweichung ${kf.delta.toFixed(1)} s)`
                : isActive
                ? 'Klick: hier nicht schneiden'
                : 'Klick: hier schneiden'
            }
            className={`snap-start shrink-0 w-40 text-left rounded-xl border-2 p-2 transition-all ${
              isFirst
                ? 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 cursor-default'
                : isActive
                ? farFromKeyframe
                  ? 'border-orange-400 bg-orange-50/60 dark:bg-orange-950/30 cursor-pointer'
                  : 'border-emerald-500 bg-emerald-50/60 dark:bg-emerald-950/30 cursor-pointer'
                : 'border-dashed border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 opacity-70 hover:opacity-100 cursor-pointer'
            }`}
          >
            <div className="relative w-full aspect-video rounded-lg bg-zinc-200 dark:bg-zinc-700 overflow-hidden">
              <img
                src={`/api/videos/${encodeURIComponent(videoId)}/thumb?t=${scene.start}`}
                alt={`Szene ${scene.index}`}
                loading="lazy"
                className="w-full h-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              {!isFirst && (
                <div
                  className={`absolute top-1 left-1 w-6 h-6 rounded-md flex items-center justify-center text-white shadow ${
                    isActive ? (farFromKeyframe ? 'bg-orange-500' : 'bg-emerald-600') : 'bg-zinc-500/80'
                  }`}
                >
                  {isActive ? (farFromKeyframe ? <AlertTriangle className="w-3.5 h-3.5" /> : <Scissors className="w-3.5 h-3.5" />) : <Check className="w-3.5 h-3.5 opacity-0" />}
                </div>
              )}
              {onSeek && (
                <span
                  role="button"
                  title="Im Player anspringen"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSeek(scene.start);
                  }}
                  className="absolute bottom-1 right-1 w-6 h-6 rounded-md bg-white/85 dark:bg-zinc-900/85 text-zinc-800 dark:text-zinc-100 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-colors"
                >
                  <Play className="w-3 h-3" />
                </span>
              )}
              {scene.kind === 'black' && (
                <div className="absolute top-1 right-1 w-6 h-6 rounded-md bg-zinc-900/80 text-white flex items-center justify-center" title="Schwarzbild">
                  <Moon className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
            <div className="mt-1.5 flex items-baseline justify-between gap-2">
              <span className="text-xs font-bold text-zinc-900 dark:text-zinc-100">Szene {scene.index}</span>
              <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">{formatTime(scene.start)}</span>
            </div>
            <div className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
              {formatTime(scene.duration)}
              {!isFirst && scene.score > 0 && scene.kind === 'scene' && (
                <span className="text-zinc-400 font-normal"> · Score {Math.round(scene.score)}</span>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
};
