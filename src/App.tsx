/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CuttingProgress } from './components/CuttingProgress.js';
import { DragOverlay } from './components/DragOverlay.js';
import { Dropzone } from './components/Dropzone.js';
import { HistoryView } from './components/HistoryView.js';
import { LibraryBrowser } from './components/LibraryBrowser.js';
import { ResultCard } from './components/ResultCard.js';
import { SettingsView } from './components/SettingsView.js';
import { type NavTab, Sidebar } from './components/Sidebar.js';
import { ToastContainer } from './components/Toast.js';
import { UploadProgress } from './components/UploadProgress.js';
import { VideoDetail } from './components/VideoDetail.js';
import type {
  AppSettings,
  HealthInfo,
  Job,
  ProbeResult,
  SplitMode,
  SplitResult,
  ToastMessage,
  VideoItem,
} from './types.js';

export default function App() {
  // Navigation & tabs
  const [currentTab, setCurrentTab] = useState<NavTab>('cut');

  // System & Settings state
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [settings, setSettings] = useState<AppSettings>({
    defaultParts: 8,
    namePattern: '{name} - Teil {nr} von {gesamt}',
    verifyAfterSplit: true,
  });

  // Videos & Queue
  const [existingVideos, setExistingVideos] = useState<VideoItem[]>([]);
  const [isLoadingExisting, setIsLoadingExisting] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);

  // Active video workflow
  const [selectedVideo, setSelectedVideo] = useState<VideoItem | null>(null);
  const [isBrowsingLibrary, setIsBrowsingLibrary] = useState(false);
  const [probeResult, setProbeResult] = useState<ProbeResult | null>(null);
  const [isLoadingProbe, setIsLoadingProbe] = useState(false);
  const [isAnalyzingVideo, setIsAnalyzingVideo] = useState(false);
  const [analysisPercent, setAnalysisPercent] = useState(0);
  const activeAnalysisEsRef = useRef<EventSource | null>(null);

  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [isStartingSplit, setIsStartingSplit] = useState(false);
  const [isCancellingJob, setIsCancellingJob] = useState(false);
  const [resultData, setResultData] = useState<{ videoName: string; result: SplitResult } | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadFileName, setUploadFileName] = useState('');
  const [uploadPercent, setUploadPercent] = useState(0);
  const [uploadLoaded, setUploadLoaded] = useState(0);
  const [uploadTotal, setUploadTotal] = useState(0);
  const [uploadSpeed, setUploadSpeed] = useState(0);
  const [uploadRemainingSec, setUploadRemainingSec] = useState(0);
  const [isAnalyzingUpload, setIsAnalyzingUpload] = useState(false);
  const currentXhrRef = useRef<XMLHttpRequest | null>(null);

  // Window drag overlay
  const [isDraggingWindow, setIsDraggingWindow] = useState(false);
  const dragCounterRef = useRef(0);

  // Toasts
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback(
    (type: 'info' | 'success' | 'error', message: string, title?: string) => {
      const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      setToasts((prev) => [...prev, { id, type, message, title }]);

      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Fetch Health & Settings
  const fetchHealth = useCallback(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        const data = await res.json();
        setHealth(data);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch('/api/settings');
      if (res.ok) {
        const data = await res.json();
        setSettings(data);
      }
    } catch {
      // ignore
    }
  }, []);

  const fetchVideos = useCallback(async () => {
    setIsLoadingExisting(true);
    try {
      const res = await fetch('/api/videos');
      if (res.ok) {
        const data = await res.json();
        setExistingVideos(data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingExisting(false);
    }
  }, []);

  const fetchJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const res = await fetch('/api/jobs');
      if (res.ok) {
        const data = await res.json();
        setJobs(data);
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  // Load initial data
  useEffect(() => {
    fetchHealth();
    fetchSettings();
    fetchVideos();
    fetchJobs();

    const interval = setInterval(() => {
      fetchHealth();
    }, 30000);
    return () => clearInterval(interval);
  }, [fetchHealth, fetchSettings, fetchVideos, fetchJobs]);

  // Clean up analysis SSE on unmount
  useEffect(() => {
    return () => {
      if (activeAnalysisEsRef.current) {
        activeAnalysisEsRef.current.close();
      }
    };
  }, []);

  // Load probe data for a video (handles 202 with SSE progress)
  const loadProbeForVideo = useCallback(
    async (videoId: string) => {
      if (activeAnalysisEsRef.current) {
        activeAnalysisEsRef.current.close();
        activeAnalysisEsRef.current = null;
      }

      setIsLoadingProbe(true);
      setIsAnalyzingVideo(false);
      setAnalysisPercent(0);

      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}`);
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Fehler beim Analysieren des Videos.');
        }

        if (res.status === 202) {
          // Analysis is in progress: subscribe to SSE events
          const initialData = await res.json().catch(() => ({}));
          setIsAnalyzingVideo(true);
          setAnalysisPercent(initialData.percent || 0);

          const es = new EventSource(`/api/videos/${encodeURIComponent(videoId)}/events`);
          activeAnalysisEsRef.current = es;

          es.onmessage = (event) => {
            try {
              const data = JSON.parse(event.data);
              if (data.type === 'progress') {
                setAnalysisPercent(data.percent || 0);
              } else if (data.type === 'done') {
                es.close();
                activeAnalysisEsRef.current = null;
                // Fetch completed probe result
                fetch(`/api/videos/${encodeURIComponent(videoId)}`)
                  .then((r) => r.json())
                  .then((finalProbe: ProbeResult) => {
                    setProbeResult(finalProbe);
                    setIsAnalyzingVideo(false);
                    setIsLoadingProbe(false);
                    fetchVideos();
                  })
                  .catch((err) => {
                    setIsAnalyzingVideo(false);
                    setIsLoadingProbe(false);
                    addToast('error', err.message || 'Konnte Metadaten nicht laden.', 'Analysefehler');
                  });
              } else if (data.type === 'error') {
                es.close();
                activeAnalysisEsRef.current = null;
                setIsAnalyzingVideo(false);
                setIsLoadingProbe(false);
                addToast('error', data.error || 'Analysefehler', 'Fehler');
              }
            } catch {
              // ignore
            }
          };

          es.onerror = () => {
            // EventSource will retry or handle connection drops
          };
          return;
        }

        // 200 OK: already analyzed
        const probe = (await res.json()) as ProbeResult;
        setProbeResult(probe);
        setIsLoadingProbe(false);
      } catch (err: any) {
        addToast('error', err.message || 'Konnte Metadaten nicht lesen.', 'Analysefehler');
        setSelectedVideo(null);
        setProbeResult(null);
        setIsLoadingProbe(false);
      }
    },
    [addToast, fetchVideos]
  );

  // File Upload handler via XMLHttpRequest with real progress
  const startUpload = useCallback(
    (file: File) => {
      if (currentXhrRef.current) {
        currentXhrRef.current.abort();
      }

      setIsUploading(true);
      setIsAnalyzingUpload(false);
      setUploadFileName(file.name);
      setUploadPercent(0);
      setUploadLoaded(0);
      setUploadTotal(file.size);
      setUploadSpeed(0);
      setUploadRemainingSec(0);
      setResultData(null);

      const formData = new FormData();
      formData.append('video', file, file.name);

      const xhr = new XMLHttpRequest();
      currentXhrRef.current = xhr;
      const startTime = Date.now();

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) {
          const loaded = event.loaded;
          const total = event.total;
          const percent = Math.min(99, Math.round((loaded / total) * 100));

          const elapsedSec = (Date.now() - startTime) / 1000;
          const speed = elapsedSec > 0 ? loaded / elapsedSec : 0;
          const remaining = speed > 0 ? (total - loaded) / speed : 0;

          setUploadLoaded(loaded);
          setUploadTotal(total);
          setUploadPercent(percent);
          setUploadSpeed(speed);
          setUploadRemainingSec(Math.round(remaining));

          if (percent >= 99) {
            setIsAnalyzingUpload(true);
          }
        }
      };

      xhr.onload = () => {
        setIsUploading(false);
        setIsAnalyzingUpload(false);
        currentXhrRef.current = null;

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const data = JSON.parse(xhr.responseText);
            addToast('success', `${file.name} erfolgreich hochgeladen.`);
            fetchVideos();
            fetchHealth();

            // Auto-select uploaded video and trigger analysis via video ID
            setSelectedVideo({
              id: data.video.id,
              name: data.video.name,
              size: data.video.size,
              mtime: new Date().toISOString(),
              isAnalyzed: false,
            });
            loadProbeForVideo(data.video.id);
          } catch {
            addToast('error', 'Ungültige Serverantwort beim Upload.', 'Fehler');
          }
        } else {
          let errorMsg = 'Upload fehlgeschlagen';
          try {
            const err = JSON.parse(xhr.responseText);
            errorMsg = err.error || errorMsg;
          } catch {
            // ignore
          }
          addToast('error', errorMsg, 'Upload-Fehler');
        }
      };

      xhr.onerror = () => {
        setIsUploading(false);
        setIsAnalyzingUpload(false);
        currentXhrRef.current = null;
        addToast('error', 'Netzwerkfehler beim Upload des Videos.', 'Fehler');
      };

      xhr.onabort = () => {
        setIsUploading(false);
        setIsAnalyzingUpload(false);
        currentXhrRef.current = null;
        addToast('info', 'Upload wurde abgebrochen.');
      };

      xhr.open('POST', '/api/videos/upload');
      xhr.send(formData);
    },
    [addToast, fetchVideos, fetchHealth, loadProbeForVideo]
  );

  const cancelUpload = useCallback(() => {
    if (currentXhrRef.current) {
      currentXhrRef.current.abort();
    }
  }, []);

  // Global Drag & Drop over Window
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current++;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        setIsDraggingWindow(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current--;
      if (dragCounterRef.current <= 0) {
        setIsDraggingWindow(false);
        dragCounterRef.current = 0;
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingWindow(false);

      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        setCurrentTab('cut');
        startUpload(file);
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [startUpload]);

  // Start Split Job
  const handleStartSplit = useCallback(
    async (mode: SplitMode) => {
      if (!selectedVideo || !probeResult) return;
      setIsStartingSplit(true);

      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(selectedVideo.id)}/split`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode }),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Job konnte nicht gestartet werden.');
        }

        const data = await res.json();
        setActiveJob(data.job);
        fetchJobs();
      } catch (err: any) {
        addToast('error', err.message || 'Fehler beim Starten des Schnitts.', 'Fehler');
      } finally {
        setIsStartingSplit(false);
      }
    },
    [selectedVideo, probeResult, fetchJobs, addToast]
  );

  // Subscribe to SSE events for active cutting job
  useEffect(() => {
    if (!activeJob) return;

    const eventSource = new EventSource(`/api/jobs/${encodeURIComponent(activeJob.id)}/events`);

    eventSource.onmessage = (event) => {
      try {
        const updatedJob = JSON.parse(event.data) as Job;
        setActiveJob(updatedJob);

        if (updatedJob.status === 'done') {
          if (updatedJob.result) {
            setResultData({
              videoName: updatedJob.videoName,
              result: updatedJob.result,
            });
          }
          addToast('success', `${updatedJob.result?.files.length || 0} Teile erstellt!`, 'Schnitt fertig');
          setActiveJob(null);
          eventSource.close();
          fetchJobs();
          fetchHealth();
        } else if (updatedJob.status === 'error') {
          addToast('error', updatedJob.error || 'Fehler beim Schneiden aufgetreten.', 'Fehler');
          setActiveJob(null);
          eventSource.close();
          fetchJobs();
        } else if (updatedJob.status === 'cancelled') {
          addToast('info', 'Schnitt wurde abgebrochen.');
          setActiveJob(null);
          eventSource.close();
          fetchJobs();
        }
      } catch {
        // ignore
      }
    };

    eventSource.onerror = () => {
      // EventSource reconnects automatically or closes on completion
    };

    return () => {
      eventSource.close();
    };
  }, [activeJob?.id, addToast, fetchJobs, fetchHealth]);

  // Cancel Active Job
  const handleCancelActiveJob = useCallback(async () => {
    if (!activeJob) return;
    setIsCancellingJob(true);
    try {
      const res = await fetch(`/api/jobs/${encodeURIComponent(activeJob.id)}/cancel`, {
        method: 'POST',
      });
      if (res.ok) {
        addToast('info', 'Schnitt wird abgebrochen...');
      }
    } catch {
      // ignore
    } finally {
      setIsCancellingJob(false);
    }
  }, [activeJob, addToast]);

  // Cancel from History table
  const handleCancelJobFromHistory = useCallback(
    async (jobId: string) => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: 'POST',
        });
        if (res.ok) {
          addToast('info', 'Job abgebrochen.');
          fetchJobs();
        }
      } catch {
        // ignore
      }
    },
    [addToast, fetchJobs]
  );

  // Delete Video from Source (Inbox)
  const handleDeleteExistingVideo = useCallback(
    async (v: VideoItem) => {
      try {
        const res = await fetch(`/api/videos/${encodeURIComponent(v.id)}?confirm=1`, {
          method: 'DELETE',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error || 'Löschen fehlgeschlagen.');
        }
        addToast('info', `${v.name} gelöscht.`);
        fetchVideos();
        if (selectedVideo?.id === v.id) {
          setSelectedVideo(null);
          setProbeResult(null);
        }
      } catch (err: any) {
        addToast('error', err.message, 'Fehler');
      }
    },
    [selectedVideo, fetchVideos, addToast]
  );

  // Save Settings
  const handleSaveSettings = useCallback(
    async (newSettings: AppSettings): Promise<boolean> => {
      try {
        const res = await fetch('/api/settings', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(newSettings),
        });
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
          addToast('success', 'Einstellungen erfolgreich gespeichert.');
          return true;
        }
      } catch {
        // ignore
      }
      addToast('error', 'Konnte Einstellungen nicht speichern.', 'Fehler');
      return false;
    },
    [addToast]
  );

  // Count active/queued jobs for badge
  const activeJobsCount = jobs.filter(
    (j) => j.status === 'running' || j.status === 'queued'
  ).length;

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 font-sans antialiased">
      {/* Full-screen drag overlay */}
      <DragOverlay isDragging={isDraggingWindow} />

      {/* Toast notifications container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      {/* Left Sidebar */}
      <Sidebar
        currentTab={currentTab}
        onSelectTab={(tab) => {
          setCurrentTab(tab);
          if (tab === 'history') fetchJobs();
          if (tab === 'settings') fetchHealth();
        }}
        activeJobsCount={activeJobsCount}
        health={health}
      />

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="p-6 md:p-10 max-w-6xl w-full mx-auto">
          {/* TAB 1: SCHNEIDEN */}
          {currentTab === 'cut' && (
            <div className="space-y-6">
              {/* 1. Upload in progress */}
              {isUploading && (
                <UploadProgress
                  fileName={uploadFileName}
                  percent={uploadPercent}
                  loadedBytes={uploadLoaded}
                  totalBytes={uploadTotal}
                  speedBytesPerSec={uploadSpeed}
                  remainingSeconds={uploadRemainingSec}
                  isAnalyzing={isAnalyzingUpload}
                  onCancel={cancelUpload}
                />
              )}

              {/* 2. Cutting in progress */}
              {!isUploading && activeJob && (
                <CuttingProgress
                  job={activeJob}
                  onCancel={handleCancelActiveJob}
                  isCancelling={isCancellingJob}
                />
              )}

              {/* 3. Result after cut */}
              {!isUploading && !activeJob && resultData && (
                <ResultCard
                  videoName={resultData.videoName}
                  result={resultData.result}
                  onNextVideo={() => {
                    setResultData(null);
                    setSelectedVideo(null);
                    setProbeResult(null);
                    fetchVideos();
                  }}
                  onCutAgain={() => {
                    setResultData(null);
                  }}
                />
              )}

              {/* 4. Video Detail / Cut Configuration */}
              {!isUploading && !activeJob && !resultData && selectedVideo && probeResult && (
                <VideoDetail
                  videoId={selectedVideo.id}
                  probe={probeResult}
                  source={selectedVideo.source}
                  relPath={selectedVideo.relPath}
                  libraryHostPath={health?.paths.libraryHostPath}
                  eingangHostPath={health ? `${health.paths.splityHostPath}/Eingang` : undefined}
                  defaultParts={settings.defaultParts}
                  onBack={() => {
                    setSelectedVideo(null);
                    setProbeResult(null);
                    fetchVideos();
                  }}
                  onStartSplit={handleStartSplit}
                  isStartingSplit={isStartingSplit}
                />
              )}

              {/* 5. Loading probe / analyzing progress bar */}
              {!isUploading && !activeJob && !resultData && selectedVideo && !probeResult && (isLoadingProbe || isAnalyzingVideo) && (
                <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 text-center max-w-lg mx-auto my-12 shadow-sm space-y-5 animate-in fade-in">
                  <div className="w-14 h-14 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 flex items-center justify-center mx-auto">
                    <span className="w-7 h-7 border-3 border-blue-600 border-t-transparent rounded-full animate-spin" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-zinc-900 dark:text-zinc-100">
                      Video wird blitzschnell analysiert
                    </h3>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                      Keyframes und Metadaten werden ohne Neukodierung erfasst...
                    </p>
                  </div>

                  {/* Real progress bar during keyframe extraction */}
                  <div className="space-y-2 max-w-sm mx-auto pt-1">
                    <div className="flex justify-between text-xs font-semibold text-zinc-600 dark:text-zinc-400">
                      <span>Keyframe-Erfassung</span>
                      <span className="font-mono text-blue-600 dark:text-blue-400">{analysisPercent}%</span>
                    </div>
                    <div className="w-full h-2.5 bg-zinc-100 dark:bg-zinc-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-blue-600 rounded-full transition-all duration-150"
                        style={{ width: `${Math.max(4, analysisPercent)}%` }}
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* 6. Empty State: Library Browser or Dropzone */}
              {!isUploading && !activeJob && !resultData && !selectedVideo && (
                isBrowsingLibrary && health?.paths.libraryHostPath ? (
                  <LibraryBrowser
                    libraryHostPath={health.paths.libraryHostPath}
                    onClose={() => setIsBrowsingLibrary(false)}
                    onSelectVideo={(video) => {
                      setIsBrowsingLibrary(false);
                      setSelectedVideo(video);
                      loadProbeForVideo(video.id);
                    }}
                  />
                ) : (
                  <Dropzone
                    onFileSelected={startUpload}
                    existingVideos={existingVideos}
                    onSelectExistingVideo={(v) => {
                      setSelectedVideo(v);
                      loadProbeForVideo(v.id);
                    }}
                    onDeleteExistingVideo={handleDeleteExistingVideo}
                    eingangHostPath={
                      health
                        ? `${health.paths.splityHostPath}/Eingang`
                        : 'Lade...'
                    }
                    libraryHostPath={health?.paths.libraryHostPath}
                    onOpenLibrary={() => setIsBrowsingLibrary(true)}
                    isLoadingExisting={isLoadingExisting}
                  />
                )
              )}
            </div>
          )}

          {/* TAB 2: VERLAUF */}
          {currentTab === 'history' && (
            <HistoryView
              jobs={jobs}
              isLoading={isLoadingJobs}
              onRefresh={fetchJobs}
              onCancelJob={handleCancelJobFromHistory}
            />
          )}

          {/* TAB 3: EINSTELLUNGEN */}
          {currentTab === 'settings' && (
            <SettingsView
              settings={settings}
              health={health}
              onSaveSettings={handleSaveSettings}
            />
          )}
        </div>
      </main>
    </div>
  );
}
