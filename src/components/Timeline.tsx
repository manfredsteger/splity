import React from 'react';
import { formatTime } from '../utils/format.js';
import type { Cut, Part } from '../types.js';

export interface TimelineMarker {
  time: number;
  active: boolean;
  label?: string;
}

interface PartsTrackProps {
  duration: number;
  parts: Part[];
  cuts: Cut[];
  /** Szenengrenzen: aktiv = wird geschnitten (grün), inaktiv = nur Markierung (grau) */
  markers?: TimelineMarker[];
  activePartIndex?: number;
  onHoverPart?: (index: number | null) => void;
  /** Klick auf einen Teil setzt die Nadel an seinen Anfang */
  onPartClick?: (part: Part) => void;
}

/**
 * Inhalt der Spur für die Modi Teile/Minuten/Größe/Ausschnitt/Szenen (wird in den Scrubber gelegt).
 */
export const PartsTrack: React.FC<PartsTrackProps> = ({ duration, parts, cuts, markers, activePartIndex, onHoverPart, onPartClick }) => {
  if (duration <= 0 || parts.length === 0) return null;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

  return (
    <>
      {parts.map((part, idx) => {
        const widthPercent = (part.duration / duration) * 100;
        const isEven = idx % 2 === 0;
        const isHovered = activePartIndex === part.index;
        const isDropped = part.keep === false;
        return (
          <div
            key={part.index}
            onMouseEnter={() => onHoverPart?.(part.index)}
            onMouseLeave={() => onHoverPart?.(null)}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => onPartClick?.(part)}
            className={`absolute top-1 bottom-1 first:rounded-l-lg last:rounded-r-lg flex flex-col justify-center px-1.5 cursor-pointer transition-colors ${
              isDropped
                ? 'bg-zinc-300 dark:bg-zinc-700 hover:bg-zinc-400 dark:hover:bg-zinc-600'
                : isEven
                ? 'bg-blue-600 hover:bg-blue-500'
                : 'bg-blue-700 hover:bg-blue-600'
            } ${isHovered ? 'ring-2 ring-white/80 z-10' : ''}`}
            style={{ left: pct(part.start), width: `${widthPercent}%` }}
            title={`${isDropped ? 'Wird verworfen' : `Teil ${part.index}`}: ${formatTime(part.start)} – ${formatTime(part.end)} (${formatTime(part.duration)}) – Klick setzt die Nadel`}
          >
            <div className={`text-xs font-bold truncate text-center drop-shadow-xs ${isDropped ? 'text-zinc-500 dark:text-zinc-400' : 'text-white'}`}>
              {widthPercent > 6 ? (isDropped ? '×' : `T${part.index}`) : ''}
            </div>
            {widthPercent > 12 && <div className="text-blue-100 text-[10px] truncate text-center font-mono opacity-90">{formatTime(part.duration)}</div>}
          </div>
        );
      })}

      {cuts.map((cut, idx) => (
        <div key={idx} className="absolute top-0 bottom-0 w-[2px] bg-white shadow-md z-20 pointer-events-none -translate-x-1/2" style={{ left: pct(cut.actualTime) }}>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 w-2 h-2 rounded-full bg-white shadow-xs" />
        </div>
      ))}

      {markers?.map((m, i) => (
        <div
          key={`m${i}`}
          className={`absolute bottom-0 -translate-x-1/2 w-0 h-0 border-l-[5px] border-r-[5px] border-b-[8px] border-l-transparent border-r-transparent pointer-events-none z-20 ${
            m.active ? 'border-b-emerald-400' : 'border-b-zinc-100 dark:border-b-zinc-400 opacity-70'
          }`}
          style={{ left: pct(m.time) }}
          title={m.label || `Szene bei ${formatTime(m.time)}`}
        />
      ))}
    </>
  );
};

export const PartsLegend: React.FC<{ partsCount: number; keyframesCount: number; markers?: TimelineMarker[] }> = ({ partsCount, keyframesCount, markers }) => (
  <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
    <span className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-sm bg-blue-600 inline-block" />
      <span>{partsCount} Teile berechnet · Klick auf einen Teil setzt die Nadel, Ziehen im Lineal scrubbt</span>
    </span>
    <span className="flex items-center gap-3">
      {markers && markers.length > 0 && (
        <span className="flex items-center gap-1">
          <span className="w-0 h-0 border-l-[4px] border-r-[4px] border-b-[6px] border-l-transparent border-r-transparent border-b-emerald-500 inline-block" />
          <span>
            {markers.filter((m) => m.active).length} von {markers.length} Szenengrenzen aktiv
          </span>
        </span>
      )}
      <span className="flex items-center gap-1">
        <span className="w-1 h-2 bg-zinc-400 inline-block" />
        <span>{keyframesCount} Keyframes im Video</span>
      </span>
    </span>
  </div>
);
