import React, { useMemo } from 'react';
import { formatTime } from '../utils/format.js';
import type { Cut, Part } from '../types.js';

export interface TimelineMarker {
  time: number;
  active: boolean;
  label?: string;
}

interface TimelineProps {
  duration: number;
  parts: Part[];
  cuts: Cut[];
  keyframes: number[];
  /** Szenengrenzen: aktiv = wird geschnitten (grün), inaktiv = nur Markierung (grau) */
  markers?: TimelineMarker[];
  activePartIndex?: number;
  onHoverPart?: (index: number | null) => void;
  /** Klick auf die Leiste springt im Player dorthin */
  onSeek?: (seconds: number) => void;
}

export const Timeline: React.FC<TimelineProps> = ({
  duration,
  parts,
  cuts,
  keyframes,
  markers,
  activePartIndex,
  onHoverPart,
  onSeek,
}) => {
  // Subsample keyframes if > 2000 to keep DOM fast
  const sampledKeyframes = useMemo(() => {
    if (!keyframes || keyframes.length === 0 || duration <= 0) return [];
    if (keyframes.length <= 2000) return keyframes;

    const step = Math.ceil(keyframes.length / 2000);
    const result: number[] = [];
    for (let i = 0; i < keyframes.length; i += step) {
      result.push(keyframes[i]);
    }
    return result;
  }, [keyframes, duration]);

  if (duration <= 0 || parts.length === 0) return null;

  return (
    <div className="w-full space-y-2 select-none">
      {/* Time marks row */}
      <div className="flex justify-between items-center text-[11px] font-mono text-zinc-400 px-1">
        <span>00:00</span>
        <span>{formatTime(duration / 2)}</span>
        <span>{formatTime(duration)}</span>
      </div>

      {/* Main Bar with parts and cuts */}
      <div
        className={`relative w-full h-12 rounded-xl overflow-hidden shadow-inner bg-zinc-200 dark:bg-zinc-800 flex ${onSeek ? 'cursor-pointer' : ''}`}
        onClick={(e) => {
          if (!onSeek) return;
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
          onSeek(ratio * duration);
        }}
      >
        {parts.map((part, idx) => {
          const widthPercent = (part.duration / duration) * 100;
          const isEven = idx % 2 === 0;
          const isHovered = activePartIndex === part.index;

          return (
            <div
              key={part.index}
              onMouseEnter={() => onHoverPart?.(part.index)}
              onMouseLeave={() => onHoverPart?.(null)}
              className={`relative h-full transition-all duration-150 flex flex-col justify-center px-1.5 cursor-pointer ${
                isEven
                  ? 'bg-blue-600 hover:bg-blue-500'
                  : 'bg-blue-700 hover:bg-blue-600'
              } ${isHovered ? 'ring-2 ring-white/80 z-10' : ''}`}
              style={{ width: `${widthPercent}%` }}
              title={`Teil ${part.index}: ${formatTime(part.start)} – ${formatTime(part.end)} (${formatTime(part.duration)})`}
            >
              {/* Part Label */}
              <div className="text-white text-xs font-bold truncate text-center drop-shadow-xs">
                {widthPercent > 6 ? `T${part.index}` : ''}
              </div>
              {widthPercent > 12 && (
                <div className="text-blue-100 text-[10px] truncate text-center font-mono opacity-90">
                  {formatTime(part.duration)}
                </div>
              )}
            </div>
          );
        })}

        {/* Vertical Cut Lines */}
        {cuts.map((cut, idx) => {
          const leftPercent = (cut.actualTime / duration) * 100;
          return (
            <div
              key={idx}
              className="absolute top-0 bottom-0 w-[2px] bg-white shadow-md z-20 pointer-events-none -translate-x-1/2"
              style={{ left: `${leftPercent}%` }}
            >
              <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 rounded-full bg-white shadow-xs" />
            </div>
          );
        })}
      </div>

      {/* Szenen-Marker (über der Keyframe-Reihe) */}
      {markers && markers.length > 0 && (
        <div className="relative w-full h-2.5 px-0.5">
          {markers.map((m, i) => {
            const leftPercent = Math.min(100, Math.max(0, (m.time / duration) * 100));
            return (
              <div
                key={i}
                className={`absolute top-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-b-[8px] border-l-transparent border-r-transparent ${
                  m.active ? 'border-b-emerald-500' : 'border-b-zinc-400 dark:border-b-zinc-600 opacity-60'
                }`}
                style={{ left: `${leftPercent}%` }}
                title={m.label || `Szene bei ${formatTime(m.time)}`}
              />
            );
          })}
        </div>
      )}

      {/* Keyframe tick marks */}
      <div className="relative w-full h-2 px-0.5 overflow-hidden">
        <div className="absolute inset-0 flex items-center">
          {sampledKeyframes.map((kf, i) => {
            const leftPercent = Math.min(100, Math.max(0, (kf / duration) * 100));
            return (
              <div
                key={i}
                className="absolute top-0 w-[1px] h-2 bg-zinc-400 dark:bg-zinc-600 opacity-60"
                style={{ left: `${leftPercent}%` }}
                title={`Keyframe bei ${kf.toFixed(2)}s`}
              />
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-sm bg-blue-600 inline-block" />
          <span>{parts.length} Teile berechnet</span>
        </span>
        <span className="flex items-center gap-3">
          {markers && markers.length > 0 && (
            <span className="flex items-center gap-1">
              <span className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[6px] border-l-transparent border-r-transparent border-b-emerald-500 inline-block" />
              <span>{markers.filter((m) => m.active).length} von {markers.length} Szenengrenzen aktiv</span>
            </span>
          )}
          <span className="flex items-center gap-1">
            <span className="w-1 h-2 bg-zinc-400 inline-block" />
            <span>{keyframes.length} Keyframes im Video</span>
          </span>
        </span>
      </div>
    </div>
  );
};
