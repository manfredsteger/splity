import React from 'react';
import { Loader2, UploadCloud } from 'lucide-react';
import { formatBytes, formatTime } from '../utils/format.js';

interface UploadProgressProps {
  fileName: string;
  percent: number;
  loadedBytes: number;
  totalBytes: number;
  speedBytesPerSec: number;
  remainingSeconds: number;
  isAnalyzing: boolean;
  onCancel?: () => void;
}

export const UploadProgress: React.FC<UploadProgressProps> = ({
  fileName,
  percent,
  loadedBytes,
  totalBytes,
  speedBytesPerSec,
  remainingSeconds,
  isAnalyzing,
  onCancel,
}) => {
  return (
    <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-6 shadow-sm max-w-2xl mx-auto my-8">
      <div className="flex items-center gap-4 mb-4">
        <div className="w-12 h-12 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
          {isAnalyzing ? (
            <Loader2 className="w-6 h-6 animate-spin" />
          ) : (
            <UploadCloud className="w-6 h-6 animate-pulse" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <h3 className="font-semibold text-zinc-900 dark:text-zinc-100 truncate text-base">
              {fileName}
            </h3>
            <span className="font-bold text-blue-600 dark:text-blue-400 text-sm shrink-0">
              {isAnalyzing ? 'Wird analysiert...' : `${percent}%`}
            </span>
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400 mt-1 flex items-center gap-2">
            <span>
              {formatBytes(loadedBytes)} von {formatBytes(totalBytes)}
            </span>
            {!isAnalyzing && speedBytesPerSec > 0 && (
              <>
                <span>•</span>
                <span>{formatBytes(speedBytesPerSec)}/s</span>
              </>
            )}
            {!isAnalyzing && remainingSeconds > 0 && percent < 100 && (
              <>
                <span>•</span>
                <span>noch ca. {formatTime(remainingSeconds)}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden mb-4 relative">
        <div
          className={`h-full transition-all duration-150 rounded-full ${
            isAnalyzing
              ? 'bg-blue-500 animate-pulse w-full'
              : 'bg-blue-600'
          }`}
          style={{ width: isAnalyzing ? '100%' : `${percent}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
        <span>
          {isAnalyzing
            ? 'Keyframes werden blitzschnell ohne Neukodierung erfasst...'
            : 'Streaming direkt auf die Festplatte (kein Speicherüberlauf)'}
        </span>
        {onCancel && !isAnalyzing && (
          <button
            onClick={onCancel}
            className="text-red-500 hover:text-red-600 font-medium transition-colors cursor-pointer"
          >
            Abbrechen
          </button>
        )}
      </div>
    </div>
  );
};
