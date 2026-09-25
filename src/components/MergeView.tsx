import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Combine,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { CuttingProgress } from './CuttingProgress.js';
import { LibraryBrowser } from './LibraryBrowser.js';
import { ResultCard } from './ResultCard.js';
import { formatBytes, formatTime } from '../utils/format.js';
import type { Job, MergeCheckResult, OutputFolder, SplitResult, VideoItem } from '../types.js';

interface MergeViewProps {
  existingVideos: VideoItem[];
  libraryHostPath?: string | null;
  fertigHostPath?: string;
  onToast: (type: 'info' | 'success' | 'error', message: string, title?: string) => void;
  onJobsChanged: () => void;
}

interface MergeItem {
  id: string;
  name: string;
  size: number;
}

type SourceTab = 'outputs' | 'inbox';

export const MergeView: React.FC<MergeViewProps> = ({ existingVideos, libraryHostPath, fertigHostPath, onToast, onJobsChanged }) => {
  const [items, setItems] = useState<MergeItem[]>([]);
  const [check, setCheck] = useState<MergeCheckResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);
  const [checkError, setCheckError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [sourceTab, setSourceTab] = useState<SourceTab>('outputs');
  const [outputs, setOutputs] = useState<OutputFolder[]>([]);
  const [isBrowsingLibrary, setIsBrowsingLibrary] = useState(false);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [result, setResult] = useState<{ name: string; result: SplitResult } | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const loadOutputs = useCallback(async () => {
    try {
      const res = await fetch('/api/merge/outputs');
      if (res.ok) setOutputs((await res.json()) as OutputFolder[]);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadOutputs();
    return () => {
      if (esRef.current) esRef.current.close();
    };
  }, [loadOutputs]);

  // Vorprüfung, entprellt, sobald sich die Liste ändert
  const idsKey = items.map((i) => i.id).join('|');
  useEffect(() => {
    if (items.length === 0) {
      setCheck(null);
      setCheckError(null);
      return;
    }
    let cancelled = false;
    setIsChecking(true);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch('/api/merge/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: items.map((i) => i.id) }),
        });
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error || 'Vorprüfung fehlgeschlagen.');
        setCheck(data as MergeCheckResult);
        setCheckError(null);
        setName((prev) => prev || (data as MergeCheckResult).suggestedName || '');
      } catch (err: any) {
        if (!cancelled) {
          setCheck(null);
          setCheckError(err.message || 'Vorprüfung fehlgeschlagen.');
        }
      } finally {
        if (!cancelled) setIsChecking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [idsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const addItems = useCallback((newItems: MergeItem[]) => {
    setItems((prev) => {
      const seen = new Set(prev.map((p) => p.id));
      return [...prev, ...newItems.filter((n) => !seen.has(n.id))];
    });
  }, []);

  const move = (index: number, dir: -1 | 1) => {
    setItems((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const startMerge = async () => {
    if (items.length < 2) return;
    setIsStarting(true);
    try {
      const res = await fetch('/api/merge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: items.map((i) => i.id), name: name.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Zusammenfügen konnte nicht gestartet werden.');
      const job = data.job as Job;
      setActiveJob(job);
      onJobsChanged();

      const es = new EventSource(`/api/jobs/${encodeURIComponent(job.id)}/events`);
      esRef.current = es;
      es.onmessage = (event) => {
        try {
          const updated = JSON.parse(event.data) as Job;
          setActiveJob(updated);
          if (updated.status === 'done' && updated.result) {
            es.close();
            esRef.current = null;
            setActiveJob(null);
            setResult({ name: updated.videoName, result: updated.result });
            onToast('success', 'Videos verlustfrei zusammengefügt.', 'Fertig');
            onJobsChanged();
            loadOutputs();
          } else if (updated.status === 'error' || updated.status === 'cancelled') {
            es.close();
            esRef.current = null;
            setActiveJob(null);
            onToast(updated.status === 'error' ? 'error' : 'info', updated.error || 'Abgebrochen.', updated.status === 'error' ? 'Fehler' : undefined);
            onJobsChanged();
          }
        } catch {
          // ignore
        }
      };
    } catch (err: any) {
      onToast('error', err.message || 'Fehler beim Starten.', 'Fehler');
    } finally {
      setIsStarting(false);
    }
  };

  const cancelJob = async () => {
    if (!activeJob) return;
    setIsCancelling(true);
    try {
      await fetch(`/api/jobs/${encodeURIComponent(activeJob.id)}/cancel`, { method: 'POST' });
    } finally {
      setIsCancelling(false);
    }
  };

  if (activeJob) {
    return <CuttingProgress job={activeJob} onCancel={cancelJob} isCancelling={isCancelling} />;
  }

  if (result) {
    return (
      <ResultCard
        videoName={result.name}
        result={result.result}
        kind="merge"
        onNextVideo={() => {
          setResult(null);
          setItems([]);
          setName('');
        }}
        onCutAgain={() => setResult(null)}
      />
    );
  }

  if (isBrowsingLibrary && libraryHostPath) {
    return (
      <LibraryBrowser
        libraryHostPath={libraryHostPath}
        onClose={() => setIsBrowsingLibrary(false)}
        onSelectVideo={(video) => {
          addItems([{ id: video.id, name: video.name, size: video.size }]);
          setIsBrowsingLibrary(false);
        }}
      />
    );
  }

  const itemInfo = new Map(check?.items.map((i) => [i.id, i]) || []);

  return (
    <div className="max-w-6xl mx-auto space-y-6 animate-in fade-in duration-200">
      <div>
        <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
          <Combine className="w-5 h-5 text-blue-600" />
          Zusammenfügen
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Teile oder Videos mit gleichen Codec-Parametern verlustfrei aneinanderhängen – das Gegenstück zum Schneiden.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        {/* Quelle */}
        <div className="lg:col-span-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center gap-2 p-1 bg-zinc-100 dark:bg-zinc-800/80 rounded-xl">
            {(['outputs', 'inbox'] as SourceTab[]).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setSourceTab(tab)}
                className={`flex-1 px-3 py-2 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                  sourceTab === tab
                    ? 'bg-white dark:bg-zinc-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-200'
                }`}
              >
                {tab === 'outputs' ? 'Fertig-Ordner' : 'Eingang'}
              </button>
            ))}
            {libraryHostPath && (
              <button
                type="button"
                onClick={() => setIsBrowsingLibrary(true)}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold text-purple-600 dark:text-purple-400 hover:bg-white dark:hover:bg-zinc-900 transition-all cursor-pointer flex items-center justify-center gap-1"
              >
                <FolderOpen className="w-3.5 h-3.5" />
                Bibliothek
              </button>
            )}
          </div>

          {sourceTab === 'outputs' && (
            <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
              {outputs.length === 0 && (
                <div className="text-sm text-zinc-500 dark:text-zinc-400 p-4 text-center">
                  Noch keine Ordner in {fertigHostPath || 'Fertig/'}.
                </div>
              )}
              {outputs.map((folder) => (
                <div key={folder.path} className="rounded-xl border border-zinc-200 dark:border-zinc-800 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Folder className="w-4 h-4 text-blue-600 shrink-0" />
                      <span className="text-sm font-semibold truncate" title={folder.hostPath}>
                        {folder.name}
                      </span>
                      <span className="text-[11px] text-zinc-400 shrink-0">{folder.videos.length} Dateien</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => addItems(folder.videos.map((v) => ({ id: v.id, name: v.name, size: v.size })))}
                      className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 hover:bg-blue-600 hover:text-white transition-colors cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      Alle
                    </button>
                  </div>
                  <div className="space-y-1">
                    {folder.videos.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => addItems([{ id: v.id, name: v.name, size: v.size }])}
                        className="w-full flex items-center justify-between gap-2 px-2 py-1 rounded-lg text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800 cursor-pointer"
                      >
                        <span className="truncate text-zinc-700 dark:text-zinc-300">{v.name}</span>
                        <span className="text-zinc-400 font-mono shrink-0">{formatBytes(v.size)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {sourceTab === 'inbox' && (
            <div className="space-y-1 max-h-[480px] overflow-y-auto pr-1">
              {existingVideos.length === 0 && (
                <div className="text-sm text-zinc-500 dark:text-zinc-400 p-4 text-center">Der Eingang ist leer.</div>
              )}
              {existingVideos.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => addItems([{ id: v.id, name: v.name, size: v.size }])}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-xl text-left text-xs border border-transparent hover:border-zinc-200 dark:hover:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <HardDrive className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                    <span className="truncate text-zinc-700 dark:text-zinc-300">{v.name}</span>
                  </span>
                  <span className="text-zinc-400 font-mono shrink-0">{formatBytes(v.size)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Reihenfolge */}
        <div className="lg:col-span-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-5 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              Reihenfolge ({items.length})
              {check && items.length > 0 && (
                <span className="ml-2 text-xs font-normal text-zinc-500 dark:text-zinc-400">
                  Gesamt {formatTime(check.totalDuration)} · {formatBytes(check.totalSize)}
                </span>
              )}
            </div>
            {items.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setItems([]);
                  setName('');
                }}
                className="text-xs text-zinc-500 hover:text-red-600 flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" /> Liste leeren
              </button>
            )}
          </div>

          {items.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-zinc-200 dark:border-zinc-800 p-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              Links Dateien hinzufügen – z. B. mit „Alle“ einen ganzen Fertig-Ordner in der richtigen Reihenfolge.
            </div>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {items.map((item, idx) => {
                const info = itemInfo.get(item.id);
                const hasProblem = check?.problems.some((p) => p.file === item.name);
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-3 p-2.5 rounded-xl border ${
                      hasProblem ? 'border-red-300 dark:border-red-800 bg-red-50/40 dark:bg-red-950/20' : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40'
                    }`}
                  >
                    <div className="w-6 text-center text-xs font-bold text-zinc-400 shrink-0">{idx + 1}</div>
                    <div className="w-16 h-10 rounded-lg bg-zinc-200 dark:bg-zinc-700 overflow-hidden shrink-0">
                      <img
                        src={`/api/videos/${encodeURIComponent(item.id)}/thumb?t=1`}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-zinc-900 dark:text-zinc-100 truncate" title={item.name}>
                        {item.name}
                      </div>
                      <div className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
                        {info
                          ? `${formatTime(info.duration)} · ${info.container} · ${info.videoCodec.toUpperCase()} ${info.resolution} · ${info.audioSummary}`
                          : formatBytes(item.size)}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0} className="w-7 h-7 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed" aria-label="Nach oben">
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => move(idx, 1)} disabled={idx === items.length - 1} className="w-7 h-7 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed" aria-label="Nach unten">
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                      <button type="button" onClick={() => setItems((prev) => prev.filter((p) => p.id !== item.id))} className="w-7 h-7 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/60 text-zinc-500 hover:text-red-600 flex items-center justify-center cursor-pointer" aria-label="Entfernen">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Vorprüfung */}
          {items.length > 0 && (
            <div className="space-y-2">
              {isChecking ? (
                <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Vorprüfung läuft (analysiert neue Dateien) …
                </div>
              ) : checkError ? (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 text-sm flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{checkError}</span>
                </div>
              ) : check && items.length < 2 ? (
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Mindestens zwei Videos nötig.</div>
              ) : check && check.ok ? (
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 text-emerald-800 dark:text-emerald-300 text-sm flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>Codec-Parameter passen – Zusammenfügen ist verlustfrei möglich (Ausgabe: {check.outputExt.replace('.', '').toUpperCase()}).</span>
                </div>
              ) : check ? (
                <div className="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-800 dark:text-red-300 text-sm space-y-2">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    Verlustfreies Zusammenfügen geht nur bei gleichen Codec-Parametern.
                  </div>
                  <table className="w-full text-xs">
                    <thead className="text-left text-red-600/70 dark:text-red-400/70">
                      <tr>
                        <th className="py-1 pr-2 font-medium">Datei</th>
                        <th className="py-1 pr-2 font-medium">Feld</th>
                        <th className="py-1 pr-2 font-medium">Wert</th>
                        <th className="py-1 font-medium">Erwartet (wie 1. Datei)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {check.problems.map((p, i) => (
                        <tr key={i} className="border-t border-red-200/60 dark:border-red-800/40">
                          <td className="py-1 pr-2 truncate max-w-[180px]" title={p.file}>{p.file}</td>
                          <td className="py-1 pr-2">{p.field}</td>
                          <td className="py-1 pr-2 font-mono">{p.value}</td>
                          <td className="py-1 font-mono">{p.expected}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>
          )}

          {/* Name + Start */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 pt-2 border-t border-zinc-200 dark:border-zinc-800">
            <label className="flex-1 flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <span className="font-medium shrink-0">Name</span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={check?.suggestedName || 'Ausgabename'}
                className="flex-1 min-w-0 px-3 py-2 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
              />
              <span className="font-mono text-zinc-400 shrink-0">(zusammengefügt){check?.outputExt || ''}</span>
            </label>
            <button
              type="button"
              onClick={startMerge}
              disabled={isStarting || isChecking || !check || !check.ok || items.length < 2}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-300 dark:disabled:bg-zinc-800 text-white text-sm font-bold transition-colors cursor-pointer disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-xs"
            >
              {isStarting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Combine className="w-4 h-4" />}
              Zusammenfügen
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
