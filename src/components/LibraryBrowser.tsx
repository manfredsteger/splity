import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ChevronRight,
  Clock,
  Film,
  Folder,
  FolderOpen,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import { formatBytes, formatDate } from '../utils/format.js';
import type { LibraryBrowseResult, VideoItem } from '../types.js';

const RECENT_FOLDERS_KEY = 'splity_recent_library_folders';

interface RecentFolderItem {
  name: string;
  path: string;
}

interface LibraryBrowserProps {
  onSelectVideo: (video: VideoItem) => void;
  onClose: () => void;
  libraryHostPath?: string | null;
}

export const LibraryBrowser: React.FC<LibraryBrowserProps> = ({
  onSelectVideo,
  onClose,
  libraryHostPath,
}) => {
  const [currentPath, setCurrentPath] = useState<string>('');
  const [data, setData] = useState<LibraryBrowseResult | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [filterText, setFilterText] = useState<string>('');

  // Recent folders from localStorage
  const [recentFolders, setRecentFolders] = useState<RecentFolderItem[]>(() => {
    try {
      const stored = localStorage.getItem(RECENT_FOLDERS_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, 5);
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  const saveRecentFolder = useCallback((folderName: string, folderPath: string) => {
    if (!folderPath) return; // Do not store root in recent folders
    setRecentFolders((prev) => {
      const filtered = prev.filter((item) => item.path !== folderPath);
      const updated = [{ name: folderName, path: folderPath }, ...filtered].slice(0, 5);
      try {
        localStorage.setItem(RECENT_FOLDERS_KEY, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  }, []);

  const loadFolder = useCallback(
    async (targetPath: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/library?path=${encodeURIComponent(targetPath)}`);
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || 'Fehler beim Laden des Bibliotheksordners.');
        }
        const browseData: LibraryBrowseResult = await res.json();
        setData(browseData);
        setCurrentPath(browseData.path);

        if (browseData.path) {
          const folderName = browseData.path.split('/').pop() || browseData.path;
          saveRecentFolder(folderName, browseData.path);
        }
      } catch (err: any) {
        setError(err.message || 'Konnte Ordner nicht laden.');
      } finally {
        setIsLoading(false);
      }
    },
    [saveRecentFolder]
  );

  useEffect(() => {
    loadFolder(currentPath);
  }, []); // Initial load at root

  const handleOpenFolder = (folderPath: string) => {
    setFilterText('');
    loadFolder(folderPath);
  };

  const handleSelectVideoItem = (v: { id: string; name: string; size: number; mtime: string }) => {
    onSelectVideo({
      id: v.id,
      name: v.name,
      source: 'lib',
      relPath: currentPath ? `${currentPath}/${v.name}` : v.name,
      size: v.size,
      mtime: v.mtime,
      deletable: false,
      isAnalyzed: false,
    });
  };

  // Filter folders and videos
  const cleanFilter = filterText.trim().toLowerCase();
  const filteredFolders = (data?.folders || []).filter((f) =>
    cleanFilter ? f.name.toLowerCase().includes(cleanFilter) : true
  );
  const filteredVideos = (data?.videos || []).filter((v) =>
    cleanFilter ? v.name.toLowerCase().includes(cleanFilter) : true
  );

  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-in fade-in duration-200">
      {/* Top Header & Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <button
          onClick={onClose}
          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-600 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors cursor-pointer self-start"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Zurück zur Übersicht</span>
        </button>

        {/* Current Host Path info */}
        <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400 min-w-0">
          <HardDrive className="w-4 h-4 text-purple-600 dark:text-purple-400 shrink-0" />
          <span className="font-medium shrink-0">Pfad:</span>
          <span className="font-mono text-zinc-900 dark:text-zinc-200 truncate bg-white dark:bg-zinc-800 px-2 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 select-all">
            {data?.hostPath || libraryHostPath || '...'}
          </span>
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 shrink-0">
            nur lesend
          </span>
        </div>
      </div>

      {/* Main Browser Card */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl shadow-sm overflow-hidden flex flex-col">
        {/* Card Header: Title & Refresh */}
        <div className="p-5 md:p-6 border-b border-zinc-100 dark:border-zinc-800 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0">
                <FolderOpen className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
                  Bibliothek durchsuchen
                </h3>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Direkt aus deiner Sammlung wählen – ohne Upload oder Speicherdopplung
                </p>
              </div>
            </div>

            <button
              onClick={() => loadFolder(currentPath)}
              disabled={isLoading}
              className="p-2 rounded-xl text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
              title="Aktualisieren"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Recent folders chips */}
          {recentFolders.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 text-xs">
              <span className="text-zinc-400 font-medium shrink-0 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                <span>Zuletzt:</span>
              </span>
              <div className="flex items-center gap-1.5 flex-wrap">
                {recentFolders.map((item) => (
                  <button
                    key={item.path}
                    onClick={() => handleOpenFolder(item.path)}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-zinc-100 dark:bg-zinc-800 hover:bg-purple-50 dark:hover:bg-purple-950/40 hover:text-purple-600 dark:hover:text-purple-400 text-zinc-700 dark:text-zinc-300 font-medium transition-colors cursor-pointer"
                  >
                    <Folder className="w-3 h-3 text-amber-500 shrink-0" />
                    <span className="truncate max-w-[150px]">{item.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Breadcrumb Navigation */}
          <div className="flex items-center gap-1.5 flex-wrap text-sm pt-1">
            <button
              onClick={() => handleOpenFolder('')}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer ${
                currentPath === ''
                  ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 font-semibold'
                  : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800'
              }`}
            >
              <HardDrive className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
              <span>Bibliothek</span>
            </button>

            {data?.parents &&
              data.parents.map((parent, idx) => {
                // If parent path is empty, we already rendered "Bibliothek"
                if (parent.path === '') return null;
                return (
                  <React.Fragment key={parent.path || idx}>
                    <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                    <button
                      onClick={() => handleOpenFolder(parent.path)}
                      className="px-2.5 py-1 rounded-lg text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 font-medium transition-colors cursor-pointer"
                    >
                      {parent.name}
                    </button>
                  </React.Fragment>
                );
              })}

            {currentPath !== '' && (
              <>
                <ChevronRight className="w-4 h-4 text-zinc-400 shrink-0" />
                <span className="px-2.5 py-1 rounded-lg bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300 font-semibold truncate max-w-[200px]">
                  {currentPath.split('/').pop()}
                </span>
              </>
            )}
          </div>

          {/* Search / Filter input */}
          <div className="relative">
            <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder="Name enthält …"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="w-full pl-10 pr-9 py-2.5 rounded-xl border border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/60 text-zinc-900 dark:text-zinc-100 text-sm focus:outline-hidden focus:ring-2 focus:ring-purple-500 placeholder:text-zinc-400"
            />
            {filterText && (
              <button
                onClick={() => setFilterText('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Truncated Notice */}
        {data?.truncated && (
          <div className="px-6 py-2.5 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-900/50 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>
              Dieser Ordner enthält über 500 Einträge. Es werden die ersten 500 angezeigt. Nutze das Filterfeld oben, um gezielt zu suchen.
            </span>
          </div>
        )}

        {/* Directory Content List */}
        <div className="p-4 md:p-6 min-h-[300px] flex flex-col justify-start">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-16 text-zinc-400 space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-purple-600" />
              <span className="text-sm">Lade Ordnerinhalt...</span>
            </div>
          ) : error ? (
            <div className="p-6 rounded-2xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-center space-y-3 my-8">
              <AlertCircle className="w-8 h-8 text-red-600 mx-auto" />
              <div className="text-sm font-semibold text-red-700 dark:text-red-300">{error}</div>
              <button
                onClick={() => loadFolder(currentPath)}
                className="px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-semibold transition-colors cursor-pointer"
              >
                Erneut versuchen
              </button>
            </div>
          ) : filteredFolders.length === 0 && filteredVideos.length === 0 ? (
            <div className="text-center py-16 text-zinc-400 space-y-2">
              <FolderOpen className="w-12 h-12 mx-auto text-zinc-300 dark:text-zinc-700" />
              <div className="font-semibold text-sm text-zinc-700 dark:text-zinc-300">
                {filterText ? 'Keine Treffer für deinen Filter' : 'Dieser Ordner ist leer'}
              </div>
              <div className="text-xs">
                {filterText
                  ? 'Versuche einen anderen Suchbegriff.'
                  : 'Hier befinden sich keine unterstützten Videos oder Unterordner.'}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Folders List */}
              {filteredFolders.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-2">
                    Ordner ({filteredFolders.length})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {filteredFolders.map((folder) => (
                      <div
                        key={folder.path}
                        onClick={() => handleOpenFolder(folder.path)}
                        className="group flex items-center justify-between p-3 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-800/40 hover:border-purple-500 dark:hover:border-purple-500 hover:bg-purple-50/40 dark:hover:bg-purple-950/20 transition-all cursor-pointer shadow-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-amber-100/70 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                            <Folder className="w-4 h-4 fill-amber-500/20" />
                          </div>
                          <span className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                            {folder.name}
                          </span>
                        </div>
                        <ChevronRight className="w-4 h-4 text-zinc-400 group-hover:text-purple-600 group-hover:translate-x-0.5 transition-all shrink-0" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Videos List */}
              {filteredVideos.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-2">
                    Videos ({filteredVideos.length})
                  </div>
                  <div className="grid grid-cols-1 gap-2">
                    {filteredVideos.map((video) => (
                      <div
                        key={video.id}
                        onClick={() => handleSelectVideoItem(video)}
                        className="group flex items-center justify-between gap-4 p-3.5 rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 hover:border-purple-500 dark:hover:border-purple-500 hover:shadow-md transition-all cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 flex items-center justify-center shrink-0 group-hover:bg-purple-600 group-hover:text-white transition-colors">
                            <Film className="w-5 h-5" />
                          </div>

                          <div className="min-w-0">
                            <div className="font-semibold text-sm text-zinc-900 dark:text-zinc-100 truncate group-hover:text-purple-600 dark:group-hover:text-purple-400 transition-colors">
                              {video.name}
                            </div>
                            <div className="text-xs text-zinc-500 dark:text-zinc-400 flex items-center gap-2 mt-0.5">
                              <span className="font-medium text-zinc-700 dark:text-zinc-300">
                                {formatBytes(video.size)}
                              </span>
                              <span>•</span>
                              <span>{formatDate(video.mtime)}</span>
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSelectVideoItem(video);
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-purple-50 dark:bg-purple-950/60 text-purple-600 dark:text-purple-400 group-hover:bg-purple-600 group-hover:text-white font-semibold text-xs transition-colors cursor-pointer"
                          >
                            Wählen
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
