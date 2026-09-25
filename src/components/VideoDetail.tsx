import React, { useEffect, useState, useTransition } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ChevronDown,
  Clock,
  Film,
  Minus,
  Plus,
  Scissors,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { Timeline } from './Timeline.js';
import { formatBytes, formatTime } from '../utils/format.js';
import type { ProbeResult, SplitMode, SplitPlan } from '../types.js';

interface VideoDetailProps {
  probe: ProbeResult;
  onBack: () => void;
  onStartSplit: (mode: SplitMode) => void;
  isStartingSplit: boolean;
  defaultParts: number;
}

export const VideoDetail: React.FC<VideoDetailProps> = ({
  probe,
  onBack,
  onStartSplit,
  isStartingSplit,
  defaultParts,
}) => {
  const [modeType, setModeType] = useState<'count' | 'every'>('count');
  const [partCount, setPartCount] = useState<number>(defaultParts || 8);
  const [everyMinutes, setEveryMinutes] = useState<number>(10);
  const [plan, setPlan] = useState<SplitPlan | null>(null);
  const [hoveredPartIndex, setHoveredPartIndex] = useState<number | null>(null);
  const [, startTransition] = useTransition();

  const currentMode: SplitMode =
    modeType === 'count'
      ? { type: 'count', n: partCount }
      : { type: 'every', seconds: everyMinutes * 60 };

  // Fetch plan with debounce 150ms
  useEffect(() => {
    const timer = setTimeout(() => {
      fetch(`/api/videos/${encodeURIComponent(probe.filename)}/plan`, {
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
  }, [probe.filename, modeType, partCount, everyMinutes]);

  // Keyboard navigation: Enter = cut, ArrowUp/ArrowDown = parts +1 / -1
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is inside an input/textarea
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (modeType === 'count') {
          setPartCount((prev) => Math.min(200, prev + 1));
        } else {
          setEveryMinutes((prev) => prev + 1);
        }
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (modeType === 'count') {
          setPartCount((prev) => Math.max(2, prev - 1));
        } else {
          setEveryMinutes((prev) => Math.max(1, prev - 1));
        }
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (!isStartingSplit) {
          onStartSplit(currentMode);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [modeType, partCount, everyMinutes, isStartingSplit, currentMode, onStartSplit]);

  const quickChipsCount = [2, 3, 4, 5, 8, 10];
  const quickChipsMinutes = [1, 2, 5, 10, 15, 30];

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
            <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Film className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100 truncate" title={probe.filename}>
                {probe.filename}
              </h2>
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
            </div>
          </div>

          <div className="shrink-0 bg-blue-50 dark:bg-blue-950/40 border border-blue-100 dark:border-blue-900/50 rounded-xl px-3.5 py-2 text-xs text-blue-700 dark:text-blue-300">
            <div className="font-semibold">Keyframe-Abstand</div>
            <div>etwa alle {probe.keyframeIntervalAvg.toFixed(1)} s</div>
          </div>
        </div>
      </div>

      {/* Split Control & Mode Switcher */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-xs space-y-6">
        {/* Mode Selector Tabs */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-200 dark:border-zinc-800 pb-5">
          <div className="flex items-center gap-2 p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl self-start">
            <button
              onClick={() => setModeType('count')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                modeType === 'count'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              In gleiche Teile
            </button>
            <button
              onClick={() => setModeType('every')}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all cursor-pointer ${
                modeType === 'every'
                  ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
              }`}
            >
              Alle X Minuten
            </button>
          </div>

          <div className="text-xs text-zinc-500 dark:text-zinc-400">
            Tipp: Pfeiltasten <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-zinc-700 dark:text-zinc-300">↑</kbd> <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-zinc-700 dark:text-zinc-300">↓</kbd> zum Anpassen, <kbd className="px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800 font-mono text-zinc-700 dark:text-zinc-300">Enter</kbd> zum Schneiden
          </div>
        </div>

        {/* Counter & Chips */}
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

        {/* Timeline Visualization */}
        {plan && (
          <div className="pt-2">
            <Timeline
              duration={probe.duration}
              parts={plan.parts}
              cuts={plan.cuts}
              keyframes={probe.keyframes}
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
              <span>Vorschau der {plan.parts.length} Teilstücke</span>
              <span>Dauer pro Teil: ca. {formatTime(plan.parts[0]?.duration || 0)}</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 max-h-80 overflow-y-auto pr-1">
              {plan.parts.map((p) => {
                const isHovered = hoveredPartIndex === p.index;

                return (
                  <div
                    key={p.index}
                    onMouseEnter={() => setHoveredPartIndex(p.index)}
                    onMouseLeave={() => setHoveredPartIndex(null)}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                      isHovered
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30 shadow-xs'
                        : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40'
                    }`}
                  >
                    {/* Lazy loaded thumbnail */}
                    <div className="w-16 h-10 rounded-lg bg-zinc-200 dark:bg-zinc-700 overflow-hidden shrink-0 relative">
                      <img
                        src={`/api/videos/${encodeURIComponent(probe.filename)}/thumb?t=${p.start}`}
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
                        Teil {p.index}
                      </div>
                      <div className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                        {formatTime(p.start)} – {formatTime(p.end)}
                      </div>
                      <div className="text-[11px] font-medium text-blue-600 dark:text-blue-400">
                        {formatTime(p.duration)}
                      </div>
                    </div>
                  </div>
                );
              })}
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

        {/* Big Action Button */}
        <div className="pt-2">
          <button
            onClick={() => onStartSplit(currentMode)}
            disabled={isStartingSplit || !plan || plan.parts.length <= 1}
            className="w-full py-4 px-6 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 text-white font-bold text-base transition-all shadow-md shadow-blue-600/20 hover:shadow-lg hover:shadow-blue-600/30 flex items-center justify-center gap-3 cursor-pointer disabled:cursor-not-allowed"
          >
            <Scissors className="w-5 h-5" />
            <span>
              {isStartingSplit
                ? 'Wird vorbereitet...'
                : `In ${totalCalculatedParts} Teile schneiden`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
};
