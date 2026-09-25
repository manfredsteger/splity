import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  FileVideo,
  FolderCheck,
  RotateCcw,
} from 'lucide-react';
import { formatBytes, formatTime } from '../utils/format.js';
import type { SplitResult } from '../types.js';

interface ResultCardProps {
  videoName: string;
  result: SplitResult;
  onNextVideo: () => void;
  onCutAgain: () => void;
}

export const ResultCard: React.FC<ResultCardProps> = ({
  videoName,
  result,
  onNextVideo,
  onCutAgain,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopyPath = () => {
    if (result.hostOutputDir) {
      navigator.clipboard.writeText(result.hostOutputDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fileCount = result.files.length;
  const durationSec = result.durationSeconds || 1;

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-300">
      {/* Green Success Banner Card */}
      <div className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-3xl p-6 sm:p-8 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-lg shadow-emerald-500/20">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold text-emerald-950 dark:text-emerald-100">
                {fileCount} {fileCount === 1 ? 'Datei' : 'Dateien'} in {durationSec} s erstellt, verlustfrei
              </h2>
              <p className="text-sm text-emerald-800 dark:text-emerald-300 mt-0.5">
                Direkt per Segment-Muxer ohne Qualitätsverlust auf deiner Festplatte gespeichert.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Output Path Card with Copy Button */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
            <FolderCheck className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 uppercase tracking-wider">
              Ausgabeordner auf deinem Mac
            </div>
            <div className="font-mono text-sm text-zinc-900 dark:text-zinc-100 truncate mt-0.5 select-all" title={result.hostOutputDir}>
              {result.hostOutputDir}
            </div>
          </div>
        </div>

        <button
          onClick={handleCopyPath}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 font-semibold text-xs transition-colors shrink-0 cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400">Pfad kopiert!</span>
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              <span>Ordnerpfad kopieren</span>
            </>
          )}
        </button>
      </div>

      {/* Warnings if any */}
      {result.warnings && result.warnings.length > 0 && (
        <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-sm flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div className="font-semibold">Hinweise zum Schnitt:</div>
            {result.warnings.map((w, i) => (
              <div key={i}>• {w}</div>
            ))}
          </div>
        </div>
      )}

      {/* Files List */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-4">
        <div className="flex items-center justify-between text-xs font-semibold text-zinc-500 dark:text-zinc-400">
          <span>Erzeugte Teildateien ({result.files.length})</span>
          <span>Gesamtgröße: {formatBytes(result.files.reduce((sum, f) => sum + f.size, 0))}</span>
        </div>

        <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {result.files.map((file, idx) => (
            <div
              key={idx}
              className="py-3 flex items-center justify-between gap-4 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/40 px-2 rounded-xl transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <FileVideo className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                <span className="font-medium text-zinc-900 dark:text-zinc-100 truncate" title={file.name}>
                  {file.name}
                </span>
              </div>

              <div className="flex items-center gap-3 shrink-0 text-xs font-mono text-zinc-500 dark:text-zinc-400">
                <span>{formatTime(file.duration)}</span>
                <span>•</span>
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {formatBytes(file.size)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
        <button
          onClick={onCutAgain}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 text-zinc-700 dark:text-zinc-200 font-semibold text-sm transition-colors cursor-pointer shadow-xs"
        >
          <RotateCcw className="w-4 h-4" />
          <span>Gleiches Video anders schneiden</span>
        </button>

        <button
          onClick={onNextVideo}
          className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors cursor-pointer shadow-md shadow-blue-600/20"
        >
          <span>Nächstes Video</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
