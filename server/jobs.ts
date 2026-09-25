import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { JOBS_FILE, loadSettings } from './config.js';
import { planSplit } from './media/plan.js';
import { probeVideo } from './media/probe.js';
import { detectScenes } from './media/scenes.js';
import { executeSplit } from './media/split.js';
import { verifyParts } from './media/verify.js';
import { decodeVideoId, resolveVideo } from './sources.js';
import type { Job, SceneParams, SplitMode } from './types.js';

class JobQueue extends EventEmitter {
  private jobs: Job[] = [];
  private activeJob: Job | null = null;
  private activeHandle: { cancel: () => void } | null = null;
  private isProcessing = false;

  constructor() {
    super();
    this.loadPersistedJobs();
  }

  private loadPersistedJobs(): void {
    try {
      if (fs.existsSync(JOBS_FILE)) {
        const data = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf-8'));
        if (Array.isArray(data)) {
          this.jobs = data.map((j: Job) => {
            const decoded = decodeVideoId(j.videoId);
            const source = j.source || decoded?.source || (j.videoId?.startsWith('lib:') ? 'lib' : 'inbox');
            // Mark any running or queued jobs from previous session as error
            if (j.status === 'running' || j.status === 'queued') {
              return {
                ...j,
                source,
                status: 'error' as const,
                error: 'Server-Neustart',
              };
            }
            return {
              ...j,
              source,
            };
          });
          this.saveJobs();
        }
      }
    } catch {
      this.jobs = [];
    }
  }

  private saveJobs(): void {
    try {
      // Keep only last 50 jobs
      const toSave = this.jobs.slice(0, 50);
      fs.writeFileSync(JOBS_FILE, JSON.stringify(toSave, null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  public getJobs(): Job[] {
    return [...this.jobs];
  }

  public getJob(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  public isVideoBusy(videoId: string): boolean {
    const resolved = resolveVideo(videoId);
    const targetPath = resolved?.absPath;

    return this.jobs.some((j) => {
      if (j.status !== 'queued' && j.status !== 'running') return false;
      if (j.videoId === videoId) return true;
      if (targetPath) {
        const jResolved = resolveVideo(j.videoId);
        return jResolved?.absPath === targetPath;
      }
      return false;
    });
  }

  public addJob(videoId: string, videoName: string, mode: SplitMode): Job {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const decoded = decodeVideoId(videoId);
    const source = decoded?.source || (videoId.startsWith('lib:') ? 'lib' : 'inbox');
    const job: Job = {
      id,
      type: 'split',
      videoId,
      videoName,
      source,
      mode,
      status: 'queued',
      progress: 0,
      currentPart: 1,
      totalParts: mode.type === 'count' ? mode.n : 1,
      createdAt: new Date().toISOString(),
    };

    // Prepend new job to the list
    this.jobs.unshift(job);
    this.saveJobs();
    this.emit(`job:${id}`, job);
    this.emit('queue:update', this.jobs);

    this.processNext();
    return job;
  }

  /** Szenenerkennung als eigener Job-Typ – läuft in derselben Warteschlange (ein ffmpeg zurzeit). */
  public addSceneJob(videoId: string, videoName: string, params: SceneParams): Job {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const decoded = decodeVideoId(videoId);
    const source = decoded?.source || (videoId.startsWith('lib:') ? 'lib' : 'inbox');
    const job: Job = {
      id,
      type: 'scenes',
      videoId,
      videoName,
      source,
      mode: { type: 'points', times: [], origin: 'scenes' },
      sceneParams: params,
      status: 'queued',
      progress: 0,
      currentPart: 0,
      totalParts: 0,
      createdAt: new Date().toISOString(),
    };
    this.jobs.unshift(job);
    this.saveJobs();
    this.emit(`job:${id}`, job);
    this.emit('queue:update', this.jobs);
    this.processNext();
    return job;
  }

  public cancelJob(id: string): boolean {
    const job = this.getJob(id);
    if (!job) return false;

    if (job.status === 'queued') {
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      job.error = 'Vom Benutzer abgebrochen';
      this.saveJobs();
      this.emit(`job:${id}`, job);
      this.emit('queue:update', this.jobs);
      return true;
    }

    if (job.status === 'running' && this.activeJob?.id === id) {
      // Während der Analyse (vor executeSplit) gibt es noch keinen ffmpeg-Prozess: Dann nur den
      // Status setzen, processNext bricht nach der Analyse ab. Sonst ffmpeg beenden.
      job.status = 'cancelled';
      job.finishedAt = new Date().toISOString();
      job.error = 'Vom Benutzer abgebrochen';
      if (this.activeHandle) {
        this.activeHandle.cancel();
      }
      this.saveJobs();
      this.emit(`job:${id}`, job);
      this.emit('queue:update', this.jobs);
      return true;
    }

    return false;
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;

    const nextJob = this.jobs.find((j) => j.status === 'queued');
    if (!nextJob) return;

    this.isProcessing = true;
    this.activeJob = nextJob;
    nextJob.status = 'running';
    nextJob.phase = nextJob.type === 'scenes' ? 'scenes' : 'split';
    nextJob.progress = 0;
    this.saveJobs();
    this.emit(`job:${nextJob.id}`, nextJob);
    this.emit('queue:update', this.jobs);

    try {
      const resolved = resolveVideo(nextJob.videoId);
      if (!resolved) {
        throw new Error(`Quelldatei nicht gefunden: ${nextJob.videoId}`);
      }

      // Analyze source video
      const probe = await probeVideo(resolved, nextJob.videoId);
      if ((nextJob.status as string) === 'cancelled') {
        return;
      }

      if (nextJob.type === 'scenes' && nextJob.sceneParams) {
        nextJob.phase = 'scenes';
        this.emit(`job:${nextJob.id}`, nextJob);
        const handle = detectScenes(resolved, probe, nextJob.sceneParams, (pct) => {
          if (pct !== nextJob.progress) {
            nextJob.progress = pct;
            this.emit(`job:${nextJob.id}`, nextJob);
          }
        });
        this.activeHandle = handle;
        const scenes = await handle.promise;
        this.activeHandle = null;
        if ((nextJob.status as string) === 'cancelled') {
          return;
        }
        nextJob.status = 'done';
        nextJob.progress = 100;
        nextJob.scenes = scenes;
        nextJob.totalParts = scenes.scenes.length;
        nextJob.finishedAt = new Date().toISOString();
        nextJob.durationSeconds = Math.round(scenes.durationMs / 100) / 10;
        this.saveJobs();
        this.emit(`job:${nextJob.id}`, nextJob);
        this.emit('queue:update', this.jobs);
        return;
      }

      // Calculate split plan
      const plan = planSplit(probe.duration, probe.keyframes, nextJob.mode);
      if ((nextJob.status as string) === 'cancelled') {
        return; // während der Analyse abgebrochen
      }
      nextJob.totalParts = plan.parts.length;
      this.emit(`job:${nextJob.id}`, nextJob);

      // Execute split with progress updates
      const handle = executeSplit(resolved.absPath, probe, plan, (prog) => {
        nextJob.progress = prog.percent;
        nextJob.currentPart = prog.currentPart;
        nextJob.totalParts = prog.totalParts;
        this.emit(`job:${nextJob.id}`, nextJob);
      });

      this.activeHandle = handle;
      const result = await handle.promise;
      this.activeHandle = null;

      if ((nextJob.status as string) === 'cancelled') {
        return;
      }

      // Verification phase
      const currentSettings = loadSettings();
      if (currentSettings.verifyAfterSplit) {
        nextJob.phase = 'verify';
        nextJob.progress = 0;
        this.saveJobs();
        this.emit(`job:${nextJob.id}`, nextJob);
        this.emit('queue:update', this.jobs);

        const partPaths = result.files.map((f) => path.join(result.outputDir, f.name));
        const estimatedPackets = Math.max(
          100,
          Math.round(probe.duration * (probe.video?.fps || 30) * 2)
        );

        const verification = await verifyParts(resolved.absPath, partPaths, {
          onProgress: (packetsProcessed, estTotal) => {
            if ((nextJob.status as string) !== 'running') return;
            const targetTotal = estTotal || estimatedPackets;
            const pct = Math.min(99, Math.round((packetsProcessed / targetTotal) * 100));
            if (pct !== nextJob.progress) {
              nextJob.progress = pct;
              this.emit(`job:${nextJob.id}`, nextJob);
            }
          },
          isCancelled: () => (nextJob.status as string) === 'cancelled',
        });

        result.verification = verification;

        if (!verification.ok && verification.errorMessage) {
          result.warnings.push(`Prüfung fehlgeschlagen: ${verification.errorMessage}`);
        }
      } else {
        result.verification = {
          ok: true,
          skipped: true,
          streams: [],
          durationMs: 0,
        };
      }

      if (nextJob.status === 'running') {
        nextJob.status = 'done';
        nextJob.progress = 100;
        nextJob.currentPart = plan.parts.length;
        nextJob.finishedAt = new Date().toISOString();
        nextJob.durationSeconds = result.durationSeconds;
        nextJob.result = result;
        this.saveJobs();
        this.emit(`job:${nextJob.id}`, nextJob);
        this.emit('queue:update', this.jobs);
      }
    } catch (err: any) {
      const currentStatus: string = nextJob.status;
      if (currentStatus !== 'cancelled') {
        nextJob.status = 'error';
        nextJob.finishedAt = new Date().toISOString();
        nextJob.error = err.message || 'Unbekannter Fehler beim Schneiden';
        this.saveJobs();
        this.emit(`job:${nextJob.id}`, nextJob);
        this.emit('queue:update', this.jobs);
      }
    } finally {
      this.activeJob = null;
      this.activeHandle = null;
      this.isProcessing = false;
      this.saveJobs();
      // Continue with remaining queue
      setTimeout(() => this.processNext(), 100);
    }
  }
}

export const jobQueue = new JobQueue();
