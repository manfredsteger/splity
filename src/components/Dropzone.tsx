import React, { useRef, useState } from 'react';
import {
  Check,
  Copy,
  Film,
  FolderOpen,
  HardDrive,
  Trash2,
  Upload,
} from 'lucide-react';
import { formatBytes, formatDate, formatTime } from '../utils/format.js';
import type { VideoItem } from '../types.js';

interface DropzoneProps {
  onFileSelected: (file: File) => void;
  existingVideos: VideoItem[];
  onSelectExistingVideo: (video: VideoItem) => void;
  onDeleteExistingVideo: (video: VideoItem) => void;
  eingangHostPath: string;
  libraryHostPath?: string | null;
  onOpenLibrary?: () => void;
  isLoadingExisting: boolean;
}

export const Dropzone: React.FC<DropzoneProps> = ({
  onFileSelected,
  existingVideos,
  onSelectExistingVideo,
  onDeleteExistingVideo,
  eingangHostPath,
  libraryHostPath,
  onOpenLibrary,
  isLoadingExisting,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleCopyPath = () => {
    if (eingangHostPath) {
      navigator.clipboard.writeText(eingangHostPath);
      setCopiedPath(true);
      setTimeout(() => setCopiedPath(false), 2000);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      onFileSelected(files[0]);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 animate-in fade-in duration-300">
      {/* Primary Dropzone */}
      <div
        onClick={() => fileInputRef.current?.click()}
        className="relative group cursor-pointer border-2 border-dashed border-zinc-300 dark:border-zinc-700 hover:border-blue-500 dark:hover:border-blue-500 rounded-3xl p-12 text-center bg-white dark:bg-zinc-900 transition-all duration-200 hover:shadow-lg hover:shadow-blue-500/5"
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".mp4,.mov,.m4v,.mkv,.webm,.avi,.ts,.mts,.m2ts"
          className="hidden"
          onChange={handleInputChange}
        />

        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-transform group-hover:scale-105 shadow-sm">
          <Upload className="w-10 h-10" />
        </div>

        <h3 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-2">
          Video hier reinziehen
        </h3>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-md mx-auto mb-6">
          MP4, MOV, MKV, TS, M4V, WEBM oder AVI. Ohne Größenbeschränkung – wird verlustfrei und in Sekunden geteilt.
        </p>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors shadow-sm shadow-blue-600/20 cursor-pointer"
        >
          <FolderOpen className="w-4 h-4" />
          <span>Datei wählen</span>
        </button>
      </div>

      {/* Host Path Banner */}
      <div className="bg-zinc-100/80 dark:bg-zinc-900/50 border border-zinc-200 dark:border-zinc-800 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2.5 text-zinc-600 dark:text-zinc-400 min-w-0">
          <HardDrive className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
          <span className="font-medium shrink-0">Eingangsordner auf deinem Mac:</span>
          <span className="font-mono text-zinc-900 dark:text-zinc-200 truncate bg-white dark:bg-zinc-800 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 select-all">
            {eingangHostPath || '...'}
          </span>
        </div>

        <button
          onClick={handleCopyPath}
          className="inline-flex items-center gap-1.5 self-start sm:self-auto px-3 py-1.5 rounded-lg bg-white dark:bg-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-700 border border-zinc-200 dark:border-zinc-700 text-zinc-700 dark:text-zinc-300 font-medium transition-colors cursor-pointer shrink-0"
        >
          {copiedPath ? (
            <>
              <Check className="w-3.5 h-3.5 text-emerald-500" />
              <span className="text-emerald-600 dark:text-emerald-400">Kopiert!</span>
            </>
          ) : (
            <>
              <Copy className="w-3.5 h-3.5" />
              <span>Pfad kopieren</span>
            </>
          )}
        </button>
      </div>

      {/* Dritter Block: Aus Bibliothek wählen (nur wenn konfiguriert) */}
      {libraryHostPath && (
        <div
          onClick={onOpenLibrary}
          className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-3xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-purple-500 dark:hover:border-purple-500 transition-all cursor-pointer shadow-xs hover:shadow-lg hover:shadow-purple-500/5"
        >
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
              <FolderOpen className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h4 className="font-bold text-base text-zinc-900 dark:text-zinc-100 group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                  Aus Bibliothek wählen
                </h4>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-semibold bg-purple-100 dark:bg-purple-950/80 text-purple-700 dark:text-purple-300">
                  keine Kopie
                </span>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                Große Video-Dateien direkt vom Mac öffnen – ohne zeitaufwändigen Upload
              </p>
              <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
                <HardDrive className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400 shrink-0" />
                <span className="font-mono text-zinc-800 dark:text-zinc-300 truncate bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-[11px] select-all">
                  {libraryHostPath}
                </span>
                <span className="text-[10px] text-zinc-400 shrink-0">nur lesend</span>
              </div>
            </div>
          </div>

          <div className="shrink-0 self-end sm:self-auto">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLibrary?.();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-semibold text-xs transition-colors shadow-sm shadow-purple-600/20 cursor-pointer"
            >
              <FolderOpen className="w-4 h-4" />
              <span>Bibliothek öffnen</span>
            </button>
          </div>
        </div>
      )}

      {/* Section: Schon im Eingang */}
      {existingVideos.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <Film className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Schon im Eingang ({existingVideos.length})</span>
            </h4>
            <span className="text-xs text-zinc-400">Klicken zum sofortigen Schneiden</span>
          </div>

          <div className="grid grid-cols-1 gap-2.5">
            {existingVideos.map((v) => {
              const isConfirming = confirmDeleteId === v.id;

              return (
                <div
                  key={v.id}
                  onClick={() => onSelectExistingVideo(v)}
                  className="group relative flex items-center justify-between gap-4 p-4 rounded-2xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 hover:border-blue-500 dark:hover:border-blue-500 transition-all cursor-pointer shadow-xs hover:shadow-md"
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-blue-600 group-hover:bg-blue-50 dark:group-hover:bg-blue-950/50 transition-colors shrink-0">
                      <Film className="w-5 h-5" />
                    </div>

                    <div className="min-w-0">
                      <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                        {v.name}
                      </div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 mt-0.5">
                        <span>{formatBytes(v.size)}</span>
                        {v.duration && (
                          <>
                            <span>•</span>
                            <span>{formatTime(v.duration)}</span>
                          </>
                        )}
                        {v.resolution && (
                          <>
                            <span>•</span>
                            <span>{v.resolution}</span>
                          </>
                        )}
                        {v.codec && (
                          <>
                            <span>•</span>
                            <span className="uppercase">{v.codec}</span>
                          </>
                        )}
                        <span>•</span>
                        <span>{formatDate(v.mtime)}</span>
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {v.deletable !== false && (
                      isConfirming ? (
                        <div className="flex items-center gap-1.5 bg-red-50 dark:bg-red-950/40 p-1.5 rounded-xl border border-red-200 dark:border-red-900">
                          <span className="text-xs text-red-600 dark:text-red-400 font-medium px-1">
                            Löschen?
                          </span>
                          <button
                            onClick={() => {
                              onDeleteExistingVideo(v);
                              setConfirmDeleteId(null);
                            }}
                            className="px-2 py-1 rounded-lg bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition-colors"
                          >
                            Ja
                          </button>
                          <button
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-1 rounded-lg bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-xs font-medium hover:bg-zinc-300 dark:hover:bg-zinc-600 transition-colors"
                          >
                            Nein
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDeleteId(v.id)}
                          className="p-2 rounded-xl text-zinc-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                          title="Aus Eingang löschen"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )
                    )}

                    <button
                      onClick={() => onSelectExistingVideo(v)}
                      className="px-3.5 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/50 group-hover:bg-blue-600 text-blue-600 dark:text-blue-400 group-hover:text-white font-semibold text-xs transition-colors"
                    >
                      Wählen
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
