import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { JOBS_FILE, loadSettings } from './config.js';
import { exportChapters } from './media/chapters.js';
import { concatCopy, executeMerge, type MergeInput } from './media/merge.js';
import { planSplit } from './media/plan.js';
import { probeVideo } from './media/probe.js';
import { detectScenes } from './media/scenes.js';
import { checkRemux, extractAudio, remux, type RemuxTarget } from './media/tools.js';
import { executeSplit, formatHms, getMediaDuration, sanitizeFileName, type SplitOptions } from './media/split.js';
import { verifySequence } from './media/verify.js';
import { decodeVideoId, resolveVideo } from './sources.js';
import type { Job, JobPhase, JobType, Part, ProbeResult, SceneParams, SplitMode, SplitResult, VerificationResult } from './types.js';

type NewJobFields = Pick<Job, 'type' | 'videoId' | 'videoName' | 'mode'> &
  Partial<Pick<Job, 'sceneParams' | 'chapterTimes' | 'chapterTitles' | 'inputIds' | 'inputNames' | 'outputName' | 'remuxTarget' | 'audioTrack'>>;

const START_PHASE: Record<JobType, JobPhase> = {
  split: 'split',
  scenes: 'scenes',
  chapters: 'chapters',
  merge: 'merge',
  remux: 'remux',
  audio: 'audio',
};

/**
 * Warteschlange für alle ffmpeg-Arbeiten (Schnitt, Szenen, Kapitel, Merge).
 * Immer nur EIN Job gleichzeitig – die Platte ist der Flaschenhals.
 */
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
            // Laufende/wartende Jobs aus einer früheren Sitzung als Fehler markieren
            if (j.status === 'running' || j.status === 'queued') {
              return { ...j, source, status: 'error' as const, error: 'Server-Neustart' };
            }
            return { ...j, source };
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
      fs.writeFileSync(JOBS_FILE, JSON.stringify(this.jobs.slice(0, 50), null, 2), 'utf-8');
    } catch {
      // ignore
    }
  }

  private emitJob(job: Job): void {
    this.emit(`job:${job.id}`, job);
    this.emit('queue:update', this.jobs);
  }

  public getJobs(): Job[] {
    return [...this.jobs];
  }

  public getJob(id: string): Job | undefined {
    return this.jobs.find((j) => j.id === id);
  }

  public isVideoBusy(videoId: string): boolean {
    const targetPath = resolveVideo(videoId)?.absPath;
    return this.jobs.some((j) => {
      if (j.status !== 'queued' && j.status !== 'running') return false;
      if (j.videoId === videoId) return true;
      if (!targetPath) return false;
      return [j.videoId, ...(j.inputIds || [])].some((id) => resolveVideo(id)?.absPath === targetPath);
    });
  }

  private newJob(fields: NewJobFields): Job {
    const id = `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const decoded = decodeVideoId(fields.videoId);
    const source = decoded?.source || (fields.videoId.startsWith('lib:') ? 'lib' : 'inbox');
    const job: Job = {
      ...fields,
      id,
      source,
      status: 'queued',
      progress: 0,
      currentPart: 0,
      totalParts: 0,
      createdAt: new Date().toISOString(),
    };
    this.jobs.unshift(job);
    this.saveJobs();
    this.emitJob(job);
    this.processNext();
    return job;
  }

  public addJob(videoId: string, videoName: string, mode: SplitMode): Job {
    const job = this.newJob({ type: 'split', videoId, videoName, mode });
    job.currentPart = 1;
    job.totalParts = mode.type === 'count' ? mode.n : 1;
    return job;
  }

  /** Szenenerkennung als eigener Job-Typ – läuft in derselben Warteschlange. */
  public addSceneJob(videoId: string, videoName: string, params: SceneParams): Job {
    return this.newJob({
      type: 'scenes',
      videoId,
      videoName,
      mode: { type: 'points', times: [], origin: 'scenes' },
      sceneParams: params,
    });
  }

  /** Kapitel-Export: Kopie mit Kapiteln, ohne Schnitt. */
  public addChapterJob(videoId: string, videoName: string, times: number[], titles?: string[]): Job {
    return this.newJob({
      type: 'chapters',
      videoId,
      videoName,
      mode: { type: 'points', times, origin: 'manual' },
      chapterTimes: times,
      chapterTitles: titles,
    });
  }

  /** Zusammenfügen mehrerer Videos (concat-Demuxer). */
  public addMergeJob(inputIds: string[], inputNames: string[], outputName?: string): Job {
    return this.newJob({
      type: 'merge',
      videoId: inputIds[0],
      videoName: outputName?.trim() || `${inputNames.length} Videos`,
      mode: { type: 'points', times: [], origin: 'manual' },
      inputIds,
      inputNames,
      outputName,
    });
  }

  /** Container wechseln ohne Neucodierung. */
  public addRemuxJob(videoId: string, videoName: string, target: RemuxTarget): Job {
    return this.newJob({
      type: 'remux',
      videoId,
      videoName,
      mode: { type: 'points', times: [], origin: 'manual' },
      remuxTarget: target,
    });
  }

  /** Eine Tonspur herausziehen. */
  public addAudioJob(videoId: string, videoName: string, track: number): Job {
    return this.newJob({
      type: 'audio',
      videoId,
      videoName,
      mode: { type: 'points', times: [], origin: 'manual' },
      audioTrack: track,
    });
  }

  public cancelJob(id: string): boolean {
    const job = this.getJob(id);
    if (!job) return false;
    const isActive = job.status === 'running' && this.activeJob?.id === id;
    if (job.status !== 'queued' && !isActive) return false;

    // Während der Analyse gibt es noch keinen ffmpeg-Prozess: dann nur den Status setzen,
    // processNext bricht danach ab. Sonst den laufenden Prozess beenden.
    job.status = 'cancelled';
    job.finishedAt = new Date().toISOString();
    job.error = 'Vom Benutzer abgebrochen';
    if (isActive && this.activeHandle) {
      this.activeHandle.cancel();
    }
    this.saveJobs();
    this.emitJob(job);
    return true;
  }

  private isCancelled(job: Job): boolean {
    return (job.status as string) === 'cancelled';
  }

  /** Bit-Prüfung Original(e) vs. Ausgabe(n) als Phase 'verify', abschaltbar per Einstellung. */
  private async runVerification(
    job: Job,
    inputs: string[],
    outputs: string[],
    packetEstimate: number,
    result: SplitResult,
    mode: 'exact' | 'subsequence' | 'segments' = 'exact',
    maps?: { inputMap?: string[]; outputMap?: string[] }
  ): Promise<void> {
    if (!loadSettings().verifyAfterSplit) {
      result.verification = { ok: true, skipped: true, streams: [], durationMs: 0 };
      return;
    }
    job.phase = 'verify';
    job.progress = 0;
    this.saveJobs();
    this.emitJob(job);

    const verification = await verifySequence(inputs, outputs, {
      onProgress: (packetsProcessed, estTotal) => {
        if (this.isCancelled(job)) return;
        const pct = Math.min(99, Math.round((packetsProcessed / (estTotal || packetEstimate)) * 100));
        if (pct !== job.progress) {
          job.progress = pct;
          this.emit(`job:${job.id}`, job);
        }
      },
      isCancelled: () => this.isCancelled(job),
      mode,
      inputMap: maps?.inputMap,
      outputMap: maps?.outputMap,
    });
    result.verification = verification;
    if (!verification.ok && verification.errorMessage) {
      result.warnings.push(`Prüfung fehlgeschlagen: ${verification.errorMessage}`);
    }
  }

  private finishJob(job: Job, result: SplitResult): void {
    job.status = 'done';
    job.progress = 100;
    job.finishedAt = new Date().toISOString();
    job.durationSeconds = result.durationSeconds;
    job.result = result;
    this.saveJobs();
    this.emitJob(job);
  }

  private packetEstimate(probes: ProbeResult[]): number {
    return Math.max(100, Math.round(probes.reduce((s, p) => s + p.duration * (p.video?.fps || 30) * 2, 0)));
  }

  private async processNext(): Promise<void> {
    if (this.isProcessing) return;
    const nextJob = this.jobs.find((j) => j.status === 'queued');
    if (!nextJob) return;

    this.isProcessing = true;
    this.activeJob = nextJob;
    nextJob.status = 'running';
    nextJob.phase = START_PHASE[nextJob.type || 'split'];
    nextJob.progress = 0;
    this.saveJobs();
    this.emitJob(nextJob);

    const onProgress = (pct: number) => {
      if (this.isCancelled(nextJob)) return;
      if (pct !== nextJob.progress) {
        nextJob.progress = pct;
        this.emit(`job:${nextJob.id}`, nextJob);
      }
    };

    try {
      if (nextJob.type === 'merge') {
        await this.runMerge(nextJob, onProgress);
        return;
      }

      const resolved = resolveVideo(nextJob.videoId);
      if (!resolved) {
        throw new Error(`Quelldatei nicht gefunden: ${nextJob.videoId}`);
      }
      const probe = await probeVideo(resolved, nextJob.videoId);
      if (this.isCancelled(nextJob)) return;

      if (nextJob.type === 'scenes' && nextJob.sceneParams) {
        const handle = detectScenes(resolved, probe, nextJob.sceneParams, onProgress);
        this.activeHandle = handle;
        const scenes = await handle.promise;
        this.activeHandle = null;
        if (this.isCancelled(nextJob)) return;
        nextJob.status = 'done';
        nextJob.progress = 100;
        nextJob.scenes = scenes;
        nextJob.totalParts = scenes.scenes.length;
        nextJob.finishedAt = new Date().toISOString();
        nextJob.durationSeconds = Math.round(scenes.durationMs / 100) / 10;
        this.saveJobs();
        this.emitJob(nextJob);
        return;
      }

      if (nextJob.type === 'chapters' && nextJob.chapterTimes) {
        const handle = exportChapters(resolved, probe, nextJob.chapterTimes, nextJob.chapterTitles, onProgress);
        this.activeHandle = handle;
        const result = await handle.promise;
        this.activeHandle = null;
        if (this.isCancelled(nextJob)) return;
        const outVideo = path.join(result.outputDir, result.files[0].name);
        await this.runVerification(nextJob, [resolved.absPath], [outVideo], this.packetEstimate([probe]), result);
        if (this.isCancelled(nextJob)) return;
        this.finishJob(nextJob, result);
        return;
      }

      if (nextJob.type === 'remux' && nextJob.remuxTarget) {
        const target = nextJob.remuxTarget as RemuxTarget;
        const check = checkRemux(probe, path.extname(resolved.absPath), target);
        const handle = remux(resolved, probe, target, onProgress);
        this.activeHandle = handle;
        const result = await handle.promise;
        this.activeHandle = null;
        if (this.isCancelled(nextJob)) return;
        const outVideo = path.join(result.outputDir, result.files[0].name);
        if (check.annexB) {
          // MPEG-TS speichert H.264/HEVC als Annex B; MP4/MOV/MKV brauchen AVCC/HVCC. ffmpeg wandelt
          // die Paket-Hülle um (Bitstream-Filter), der Inhalt bleibt gleich – bitweise vergleichbar
          // sind die Pakete danach aber nicht mehr.
          result.verification = {
            ok: true,
            skipped: true,
            streams: [],
            durationMs: 0,
            note: 'TS-Quelle: Pakete werden von Annex B nach AVCC umgehüllt (kein Neucodieren), bitweiser Vergleich deshalb nicht möglich.',
          };
        } else {
          await this.runVerification(nextJob, [resolved.absPath], [outVideo], this.packetEstimate([probe]), result);
        }
        if (this.isCancelled(nextJob)) return;
        this.finishJob(nextJob, result);
        return;
      }

      if (nextJob.type === 'audio' && typeof nextJob.audioTrack === 'number') {
        const track = nextJob.audioTrack;
        const handle = extractAudio(resolved, probe, track, onProgress);
        this.activeHandle = handle;
        const result = await handle.promise;
        this.activeHandle = null;
        if (this.isCancelled(nextJob)) return;
        const outAudio = path.join(result.outputDir, result.files[0].name);
        const codec = probe.audio?.[track]?.codec || '';
        const srcExt = path.extname(resolved.absPath).toLowerCase();
        const adts = ['.ts', '.mts', '.m2ts'].includes(srcExt) && codec === 'aac';
        if (adts) {
          result.verification = {
            ok: true,
            skipped: true,
            streams: [],
            durationMs: 0,
            note: 'TS-Quelle: AAC-Pakete verlieren beim Verpacken in M4A ihren ADTS-Kopf (kein Neucodieren), bitweiser Vergleich deshalb nicht möglich.',
          };
        } else {
          await this.runVerification(nextJob, [resolved.absPath], [outAudio], this.packetEstimate([probe]), result, 'exact', {
            inputMap: ['-map', `0:a:${track}`],
            outputMap: ['-map', '0:a:0'],
          });
        }
        if (this.isCancelled(nextJob)) return;
        this.finishJob(nextJob, result);
        return;
      }

      // Standard: Schnitt
      const plan = planSplit(probe.duration, probe.keyframes, nextJob.mode, probe.gopBytes);
      nextJob.totalParts = plan.parts.length;
      this.emit(`job:${nextJob.id}`, nextJob);

      const isSegments = nextJob.mode.type === 'segments';
      const splitOptions: SplitOptions = isSegments
        ? {
            dirSuffix: ' (Segmente)',
            fileNameFor: (part, _keptIndex, keptTotal, ext, base) => {
              const nr = String(part.segment ?? 0).padStart(keptTotal >= 100 ? 3 : 2, '0');
              const label = part.name?.trim() ? part.name.trim() : `Segment ${part.segment ?? 0}`;
              return `${base} - ${nr} ${label} (${formatHms(part.start)} bis ${formatHms(part.end)})${ext}`;
            },
          }
        : {};

      const handle = executeSplit(
        resolved.absPath,
        probe,
        plan,
        (prog) => {
          if (this.isCancelled(nextJob)) return;
          nextJob.progress = prog.percent;
          nextJob.currentPart = prog.currentPart;
          nextJob.totalParts = prog.totalParts;
          this.emit(`job:${nextJob.id}`, nextJob);
        },
        splitOptions
      );
      this.activeHandle = handle;
      const result = await handle.promise;
      this.activeHandle = null;
      if (this.isCancelled(nextJob)) return;

      const partPaths = result.files.map((f) => path.join(result.outputDir, f.name));
      await this.runVerification(
        nextJob,
        [resolved.absPath],
        partPaths,
        this.packetEstimate([probe]),
        result,
        nextJob.mode.type === 'trim' ? 'subsequence' : isSegments ? 'segments' : 'exact'
      );
      if (this.isCancelled(nextJob)) return;

      if (isSegments && nextJob.mode.type === 'segments' && nextJob.mode.join) {
        await this.joinSegments(nextJob, resolved.absPath, probe, plan.parts, result);
        if (this.isCancelled(nextJob)) return;
      }

      nextJob.currentPart = plan.parts.length;
      this.finishJob(nextJob, result);
    } catch (err: any) {
      if (!this.isCancelled(nextJob)) {
        nextJob.status = 'error';
        nextJob.finishedAt = new Date().toISOString();
        nextJob.error = err.message || 'Unbekannter Fehler';
        this.saveJobs();
        this.emitJob(nextJob);
      }
    } finally {
      this.activeJob = null;
      this.activeHandle = null;
      this.isProcessing = false;
      this.saveJobs();
      setTimeout(() => this.processNext(), 100);
    }
  }

  /**
   * Segment-Modus mit „eine Datei“: die geschnittenen Teile in Segment-Reihenfolge verlustfrei
   * aneinanderhängen (concat-Demuxer), Ergebnis gegen die Teile prüfen, Teile danach löschen.
   */
  private async joinSegments(job: Job, sourcePath: string, probe: ProbeResult, parts: Part[], result: SplitResult): Promise<void> {
    const kept = parts.filter((p) => p.keep !== false);
    if (kept.length !== result.files.length) {
      result.warnings.push('Zusammenfügen übersprungen: Anzahl der Teile passt nicht zum Plan.');
      return;
    }
    const ext = path.extname(result.files[0].name);
    const baseName = sanitizeFileName(job.videoName.replace(/\.[^.]+$/, '')) || 'video';
    const outName = `${baseName} (geschnitten)${ext}`;
    const outPath = path.join(result.outputDir, outName);
    // Reihenfolge: Segment-Nummer (= Nutzerreihenfolge), innerhalb eines Segments nach Zeit
    const order = kept
      .map((p, i) => ({ p, i }))
      .sort((a, b) => (a.p.segment ?? 0) - (b.p.segment ?? 0) || a.p.start - b.p.start)
      .map((x) => x.i);
    const inputPaths = order.map((i) => path.join(result.outputDir, result.files[i].name));
    const totalDuration = kept.reduce((s, p) => s + p.duration, 0);

    job.phase = 'merge';
    job.progress = 0;
    this.saveJobs();
    this.emitJob(job);

    const partsVerification = result.verification;
    if (inputPaths.length === 1) {
      fs.renameSync(inputPaths[0], outPath);
    } else {
      let child: import('node:child_process').ChildProcess | null = null;
      this.activeHandle = {
        cancel: () => {
          try {
            child?.kill('SIGTERM');
          } catch {
            // ignore
          }
        },
      };
      const { warnings } = await concatCopy(
        inputPaths,
        sourcePath,
        probe,
        outPath,
        totalDuration,
        probe.hasDataStreams,
        (pct) => {
          if (this.isCancelled(job)) return;
          if (pct !== job.progress) {
            job.progress = pct;
            this.emit(`job:${job.id}`, job);
          }
        },
        { isCancelled: () => this.isCancelled(job), setChild: (c) => (child = c) }
      );
      this.activeHandle = null;
      if (this.isCancelled(job)) {
        fs.rmSync(result.outputDir, { recursive: true, force: true });
        return;
      }
      result.warnings.push(...warnings);

      // Zweite Prüfung: die zusammengefügte Datei muss exakt die Teile in dieser Reihenfolge sein
      await this.runVerification(job, inputPaths, [outPath], this.packetEstimate([probe]), result, 'exact');
      if (this.isCancelled(job)) return;
      const joinVerification = result.verification;
      if (partsVerification && joinVerification) {
        const merged: VerificationResult = {
          ok: partsVerification.ok && joinVerification.ok,
          skipped: partsVerification.skipped && joinVerification.skipped,
          streams: joinVerification.streams.map((st) => ({
            ...st,
            packetsOriginal: partsVerification.streams.find((o) => o.index === st.index)?.packetsOriginal ?? st.packetsOriginal,
          })),
          durationMs: partsVerification.durationMs + joinVerification.durationMs,
          errorMessage: partsVerification.errorMessage || joinVerification.errorMessage,
        };
        result.verification = merged;
      }
      for (const p of inputPaths) fs.rmSync(p, { force: true });
    }

    const duration = await getMediaDuration(outPath);
    if (Math.abs(duration - totalDuration) > 1 + inputPaths.length * 0.1) {
      result.warnings.push(`Dauer-Abweichung: Segmente zusammen ${totalDuration.toFixed(1)} s, Ausgabe ${duration.toFixed(1)} s.`);
    }
    result.files = [{ name: outName, size: fs.statSync(outPath).size, duration: Math.round(duration * 100) / 100 }];
  }

  private async runMerge(job: Job, onProgress: (pct: number) => void): Promise<void> {
    const inputs: MergeInput[] = [];
    for (const id of job.inputIds || []) {
      const resolved = resolveVideo(id);
      if (!resolved) throw new Error(`Quelldatei nicht gefunden: ${id}`);
      const probe = await probeVideo(resolved, id);
      if (this.isCancelled(job)) return;
      inputs.push({ id, resolved, probe });
    }
    const handle = executeMerge(inputs, job.outputName, onProgress);
    this.activeHandle = handle;
    const result = await handle.promise;
    this.activeHandle = null;
    if (this.isCancelled(job)) return;

    const outVideo = path.join(result.outputDir, result.files[0].name);
    await this.runVerification(
      job,
      inputs.map((i) => i.resolved.absPath),
      [outVideo],
      this.packetEstimate(inputs.map((i) => i.probe)),
      result
    );
    if (this.isCancelled(job)) return;
    job.totalParts = inputs.length;
    this.finishJob(job, result);
  }
}

export const jobQueue = new JobQueue();
