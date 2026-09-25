import React from 'react';
import { FileCheck, Loader2, Scissors, XCircle } from 'lucide-react';
import type { Job } from '../types.js';

interface CuttingProgressProps {
  job: Job;
  onCancel: () => void;
  isCancelling: boolean;
}

export const CuttingProgress: React.FC<CuttingProgressProps> = ({
  job,
  onCancel,
  isCancelling,
}) => {
  const isVerifying = job.phase === 'verify';

  return (
    <div className="max-w-2xl mx-auto my-12 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 shadow-lg text-center space-y-6 animate-in fade-in zoom-in-95 duration-200">
      {/* Icon */}
      <div className="w-20 h-20 mx-auto rounded-3xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shadow-inner">
        {isVerifying ? (
          <FileCheck className="w-10 h-10 animate-pulse text-emerald-600 dark:text-emerald-400" />
        ) : (
          <Scissors className="w-10 h-10 -rotate-45 animate-pulse" />
        )}
      </div>

      <div>
        <h3 className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">
          {isVerifying ? 'Prüfe Teile gegen das Original …' : 'Video wird verlustfrei getrennt'}
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 truncate max-w-lg mx-auto">
          {job.videoName}
        </p>
      </div>

      {/* Progress & Current Part */}
      <div className="space-y-3 max-w-md mx-auto">
        <div className="flex items-center justify-between text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          <span>
            {isVerifying
              ? 'Bitgenaue Paket-Prüfung'
              : job.currentPart > 0 && job.totalParts > 0
              ? `Teil ${job.currentPart} von ${job.totalParts}`
              : 'Wird gestartet...'}
          </span>
          <span className="font-mono text-blue-600 dark:text-blue-400 font-bold text-base">
            {job.progress}%
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-3 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-200 ease-out ${
              isVerifying ? 'bg-emerald-600' : 'bg-blue-600'
            }`}
            style={{ width: `${Math.max(2, job.progress)}%` }}
          />
        </div>

        <div className="text-xs text-zinc-400 flex items-center justify-center gap-1.5 pt-1">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
          <span>
            {isVerifying
              ? 'Paket-Hashes (framemd5) werden ohne Decodieren verglichen'
              : 'Verlustfreier Segment-Muxer ohne Neukodierung'}
          </span>
        </div>
      </div>

      {/* Cancel Button */}
      <div className="pt-2">
        <button
          onClick={onCancel}
          disabled={isCancelling}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 text-sm font-semibold transition-colors cursor-pointer disabled:opacity-50"
        >
          <XCircle className="w-4 h-4" />
          <span>{isCancelling ? 'Wird abgebrochen...' : 'Schnitt abbrechen'}</span>
        </button>
      </div>
    </div>
  );
};
