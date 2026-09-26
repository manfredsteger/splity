import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Film,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { formatDate, formatTime } from '../utils/format.js';
import type { Job } from '../types.js';

interface HistoryViewProps {
  jobs: Job[];
  isLoading: boolean;
  onRefresh: () => void;
  onCancelJob: (jobId: string) => void;
}

export const HistoryView: React.FC<HistoryViewProps> = ({
  jobs,
  isLoading,
  onRefresh,
  onCancelJob,
}) => {
  return (
    <div className="max-w-5xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100">
            Schnitt-Verlauf
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Die letzten {jobs.length} Schnitt-Aufträge (werden dauerhaft gespeichert)
          </p>
        </div>

        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:bg-zinc-50 dark:hover:bg-zinc-800 text-zinc-700 dark:text-zinc-300 font-semibold text-xs transition-colors cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Aktualisieren</span>
        </button>
      </div>

      {jobs.length === 0 ? (
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-12 text-center text-zinc-500 dark:text-zinc-400">
          <Clock className="w-12 h-12 mx-auto mb-3 opacity-40 text-blue-600" />
          <h3 className="font-semibold text-base text-zinc-900 dark:text-zinc-100 mb-1">
            Noch keine Schnitte durchgeführt
          </h3>
          <p className="text-sm max-w-sm mx-auto">
            Sobald du ein Video schneidest, erscheinen hier die Details, Laufzeiten und Ausgabepfade.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const isRunning = job.status === 'running';
            const isQueued = job.status === 'queued';
            const isDone = job.status === 'done';
            const isError = job.status === 'error';
            const isCancelled = job.status === 'cancelled';
            const isLib = job.source === 'lib' || job.videoId.startsWith('lib:');

            const isSceneJob = job.type === 'scenes';
            const modeLabel = isSceneJob
              ? `Szenenerkennung${job.scenes ? ` (${job.scenes.scenes.length} Szenen)` : ''}`
              : job.type === 'chapters'
              ? `Kapitel (${(job.chapterTimes?.length || 0) + 1})`
              : job.type === 'merge'
              ? `Zusammengefügt aus ${job.inputIds?.length || 0} Videos`
              : job.mode.type === 'count'
              ? `${job.mode.n} Teile`
              : job.mode.type === 'every'
              ? `Alle ${Math.round(job.mode.seconds / 60)} min`
              : job.mode.type === 'size'
              ? `Max. ${Math.round(job.mode.maxBytes / 1048576)} MB je Teil (${job.totalParts} Teile)`
              : job.mode.type === 'trim'
              ? `Ausschnitt ${formatTime(job.mode.start)} – ${formatTime(job.mode.end)}`
              : job.mode.origin === 'scenes'
              ? `Szenen (${job.mode.times.length + 1} Teile)`
              : `${job.mode.times.length + 1} Teile (Marker)`;

            return (
              <div
                key={job.id}
                className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                      isLib
                        ? 'bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400'
                        : 'bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                    }`}>
                      <Film className="w-5 h-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="font-bold text-sm text-zinc-900 dark:text-zinc-100 truncate" title={job.videoName}>
                          {job.videoName}
                        </div>
                        {isLib ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800 shrink-0">
                            <FolderOpen className="w-3 h-3" />
                            <span>Bibliothek</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-semibold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 shrink-0">
                            <HardDrive className="w-3 h-3" />
                            <span>Eingang</span>
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 mt-0.5">
                        <span className="font-medium text-zinc-700 dark:text-zinc-300">
                          {modeLabel}
                        </span>
                        <span>•</span>
                        <span>{formatDate(job.createdAt)}</span>
                        {job.durationSeconds && (
                          <>
                            <span>•</span>
                            <span>Dauer: {job.durationSeconds} s</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                    {/* Status Badge & Actions */}
                    <div className="flex items-center gap-3 shrink-0">
                      {/* Prüfung Indicator */}
                      {isDone && !isSceneJob && (
                        <div className="text-xs flex items-center gap-1">
                          <span className="text-zinc-400 font-medium">Prüfung:</span>
                          {job.result?.verification ? (
                            job.result.verification.skipped ? (
                              <span className="font-mono text-zinc-400 font-bold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800" title="Prüfung übersprungen">
                                –
                              </span>
                            ) : job.result.verification.ok ? (
                              <span className="font-mono text-emerald-600 dark:text-emerald-400 font-bold px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-800/60" title="Bit-identisch verifiziert">
                                ✓
                              </span>
                            ) : (
                              <span className="font-mono text-red-600 dark:text-red-400 font-bold px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-950/50 border border-red-200 dark:border-red-800/60" title={job.result.verification.errorMessage || 'Prüfung fehlgeschlagen'}>
                                ✗
                              </span>
                            )
                          ) : (
                            <span className="font-mono text-zinc-400 font-bold px-1.5 py-0.5 rounded bg-zinc-100 dark:bg-zinc-800">
                              –
                            </span>
                          )}
                        </div>
                      )}

                      {isDone && (
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>{isSceneJob ? `Fertig (${job.scenes?.scenes.length ?? job.totalParts} Szenen)` : `Fertig (${job.result?.files.length || job.totalParts} Dateien)`}</span>
                        </span>
                      )}

                    {isRunning && (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 animate-pulse">
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Läuft ({job.progress}%)</span>
                        </span>
                        <button
                          onClick={() => onCancelJob(job.id)}
                          className="px-2.5 py-1 rounded-lg border border-red-200 dark:border-red-900/60 text-red-600 dark:text-red-400 text-xs font-semibold hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                        >
                          Abbrechen
                        </button>
                      </div>
                    )}

                    {isQueued && (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800">
                          <Clock className="w-3.5 h-3.5" />
                          <span>Warteschlange</span>
                        </span>
                        <button
                          onClick={() => onCancelJob(job.id)}
                          className="px-2.5 py-1 rounded-lg border border-zinc-200 text-zinc-500 text-xs hover:text-red-600"
                        >
                          Entfernen
                        </button>
                      </div>
                    )}

                    {isError && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800">
                        <AlertCircle className="w-3.5 h-3.5" />
                        <span>Fehlgeschlagen</span>
                      </span>
                    )}

                    {isCancelled && (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400">
                        <XCircle className="w-3.5 h-3.5" />
                        <span>Abgebrochen</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Progress bar if running */}
                {isRunning && (
                  <div className="w-full h-1.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-600 transition-all duration-200"
                      style={{ width: `${job.progress}%` }}
                    />
                  </div>
                )}

                {/* Error message */}
                {job.error && (
                  <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 p-2.5 rounded-xl border border-red-100 dark:border-red-900/40">
                    {job.error}
                  </div>
                )}

                {/* Result path */}
                {job.result && (
                  <div className="flex items-center justify-between text-xs font-mono text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/40 p-2.5 rounded-xl border border-zinc-100 dark:border-zinc-800">
                    <div className="flex items-center gap-2 truncate">
                      <Folder className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                      <span className="truncate select-all">{job.result.hostOutputDir}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
