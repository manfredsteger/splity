import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { EINGANG_DIR, JOBS_FILE, loadSettings } from './config.js';
import { planSplit } from './media/plan.js';
import { probeVideo } from './media/probe.js';
import { executeSplit, type SplitExecutionHandle } from './media/split.js';
import type { Job, SplitMode } from './types.js';

class JobQueue extends EventEmitter {
  private jobs: Job[] = [];
  private activeJob: Job | null = null;
  private activeHandle: SplitExecutionHandle | null = null;
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
            // Mark any running or queued jobs from previous session as error
            if (j.status === 'running' || j.status === 'queued') {
              return {
                ...j,
                status: 'error' as const,
                error: 'Server-Neustart',
              };
            }
            return j;
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
    return this.jobs.some(
      (j) => j.videoId === videoId && (j.status === 'queued' || j.status === 'running')
    );
  }

  public addJob(videoId: string, videoName: string, mode: SplitMode): Job {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const job: Job = {
      id,
      videoId,
      videoName,
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
    nextJob.progress = 0;
    this.saveJobs();
    this.emit(`job:${nextJob.id}`, nextJob);
    this.emit('queue:update', this.jobs);

    const sourcePath = path.join(EINGANG_DIR, path.basename(nextJob.videoId));

    try {
      if (!fs.existsSync(sourcePath)) {
        throw new Error(`Quelldatei nicht gefunden: ${nextJob.videoId}`);
      }

      // Analyze source video
      const probe = await probeVideo(sourcePath);
      // Calculate split plan
      const plan = planSplit(probe.duration, probe.keyframes, nextJob.mode);
      if ((nextJob.status as string) === 'cancelled') {
        return; // während der Analyse abgebrochen
      }
      nextJob.totalParts = plan.parts.length;
      this.emit(`job:${nextJob.id}`, nextJob);

      // Execute split with progress updates
      const handle = executeSplit(sourcePath, probe, plan, (prog) => {
        nextJob.progress = prog.percent;
        nextJob.currentPart = prog.currentPart;
        nextJob.totalParts = prog.totalParts;
        this.emit(`job:${nextJob.id}`, nextJob);
      });

      this.activeHandle = handle;
      const result = await handle.promise;

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
