import React from 'react';
import { Clock, Combine, HardDrive, Scissors, Settings } from 'lucide-react';
import { formatBytes } from '../utils/format.js';
import type { HealthInfo } from '../types.js';

export type NavTab = 'cut' | 'merge' | 'history' | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  activeJobsCount: number;
  health: HealthInfo | null;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  activeJobsCount,
  health,
}) => {
  return (
    <aside className="w-64 shrink-0 flex flex-col bg-white dark:bg-zinc-900/90 border-r border-zinc-200 dark:border-zinc-800 min-h-screen select-none">
      {/* Brand Header */}
      <div className="p-5 border-b border-zinc-200 dark:border-zinc-800 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
          <Scissors className="w-5 h-5 -rotate-45" />
        </div>
        <div>
          <h1 className="font-bold text-lg tracking-tight text-zinc-900 dark:text-zinc-100 flex items-center gap-1.5">
            Splity
          </h1>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">Verlustfreier Video-Schnitt</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-3 space-y-1">
        <button
          onClick={() => onSelectTab('cut')}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            currentTab === 'cut'
              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <Scissors className="w-4 h-4" />
          <span>Schneiden</span>
        </button>

        <button
          onClick={() => onSelectTab('merge')}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            currentTab === 'merge'
              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <Combine className="w-4 h-4" />
            <span>Zusammenfügen</span>
          </div>
          
        </button>
        <button
          onClick={() => onSelectTab('history')}
          className={`w-full flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            currentTab === 'history'
              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <div className="flex items-center gap-3">
            <Clock className="w-4 h-4" />
            <span>Verlauf</span>
          </div>
          {activeJobsCount > 0 && (
            <span className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-600 text-white animate-pulse">
              {activeJobsCount}
            </span>
          )}
        </button>

        <button
          onClick={() => onSelectTab('settings')}
          className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
            currentTab === 'settings'
              ? 'bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 font-semibold'
              : 'text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-200'
          }`}
        >
          <Settings className="w-4 h-4" />
          <span>Einstellungen</span>
        </button>
      </nav>

      {/* Footer Info */}
      <div className="p-4 border-t border-zinc-200 dark:border-zinc-800 text-xs text-zinc-500 dark:text-zinc-400 space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5" />
            <span>Freier Speicher</span>
          </span>
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            {health ? formatBytes(health.freeBytes) : '...'}
          </span>
        </div>

        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${health?.ffmpeg ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <span>FFmpeg</span>
          </span>
          <span className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400 truncate max-w-[100px]" title={health?.ffmpeg || 'Nicht gefunden'}>
            {health?.ffmpeg ? `v${health.ffmpeg}` : 'Fehlt'}
          </span>
        </div>
      </div>
    </aside>
  );
};
