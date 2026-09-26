import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CACHE_DIR, THUMBS_DIR } from '../config.js';
import type { AudioStreamInfo, ProbeResult, ResolvedVideo, VideoStreamInfo } from '../types.js';

/** Cache-Format der Analyse; ältere Einträge werden neu analysiert (v2: Tonspur-Details für Merge) */
export const PROBE_VERSION = 3;

export function getVideoCacheKey(source: string, relPath: string, size: number, mtimeMs: number): string {
  const data = `${source}_${relPath}_${size}_${mtimeMs}`;
  return crypto.createHash('sha1').update(data).digest('hex');
}

export function getFileCacheKey(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    const baseName = path.basename(filePath);
    const data = `inbox_${baseName}_${stat.size}_${stat.mtimeMs}`;
    return crypto.createHash('sha1').update(data).digest('hex');
  } catch {
    return crypto.createHash('sha1').update(filePath).digest('hex');
  }
}

export function getShortContainerName(formatName: string, filename: string): string {
  const ext = path.extname(filename).toLowerCase().replace('.', '');
  const fmt = (formatName || '').toLowerCase();

  if (fmt.includes('mp4') || fmt.includes('mov') || fmt.includes('m4a') || fmt.includes('m4v')) {
    if (ext === 'mov') return 'MOV';
    if (ext === 'm4v') return 'M4V';
    return 'MP4';
  }
  if (fmt.includes('matroska') || fmt.includes('webm')) {
    if (ext === 'webm') return 'WEBM';
    return 'MKV';
  }
  if (fmt.includes('mpegts') || fmt.includes('ts') || ext === 'ts' || ext === 'mts' || ext === 'm2ts') {
    return 'TS';
  }
  if (fmt.includes('avi') || ext === 'avi') {
    return 'AVI';
  }
  if (ext) {
    return ext.toUpperCase();
  }
  return formatName.split(',')[0].toUpperCase();
}

export function getCachedProbe(resolved: ResolvedVideo): ProbeResult | null {
  try {
    const stat = fs.statSync(resolved.absPath);
    const cacheKey = getVideoCacheKey(resolved.source, resolved.relPath, stat.size, stat.mtimeMs);
    const cacheFilePath = path.join(CACHE_DIR, `${cacheKey}.json`);
    if (fs.existsSync(cacheFilePath)) {
      const content = fs.readFileSync(cacheFilePath, 'utf-8');
      const parsed = JSON.parse(content) as ProbeResult;
      if (parsed.probeVersion === PROBE_VERSION) return parsed;
    }
  } catch {
    // ignore
  }
  return null;
}

interface ActiveAnalysis {
  emitter: EventEmitter;
  percent: number;
  promise: Promise<ProbeResult>;
}

const activeAnalyses = new Map<string, ActiveAnalysis>();

export function isAnalyzingVideo(videoId: string): boolean {
  return activeAnalyses.has(videoId);
}

export function getAnalysisProgress(videoId: string): number {
  return activeAnalyses.get(videoId)?.percent ?? 0;
}

export function getAnalysisEmitter(videoId: string): EventEmitter | null {
  return activeAnalyses.get(videoId)?.emitter ?? null;
}

export function startVideoAnalysis(resolved: ResolvedVideo, videoId: string): Promise<ProbeResult> {
  const existing = activeAnalyses.get(videoId);
  if (existing) {
    return existing.promise;
  }

  const cached = getCachedProbe(resolved);
  if (cached) {
    return Promise.resolve(cached);
  }

  const emitter = new EventEmitter();
  let currentPercent = 0;

  const promise = (async (): Promise<ProbeResult> => {
    try {
      const stat = fs.statSync(resolved.absPath);
      const cacheKey = getVideoCacheKey(resolved.source, resolved.relPath, stat.size, stat.mtimeMs);
      const cacheFilePath = path.join(CACHE_DIR, `${cacheKey}.json`);

      // 1. ffprobe format and streams metadata (fast)
      const metadata = await runFfprobeMetadata(resolved.absPath);
      const duration = parseFloat(metadata.format?.duration || '0');
      const startTime = parseFloat(metadata.format?.start_time || '0');
      const container = getShortContainerName(metadata.format?.format_name || '', resolved.displayName);

      let videoStream: VideoStreamInfo | null = null;
      const audioStreams: AudioStreamInfo[] = [];
      let audioTrackCount = 0;
      let subtitleTrackCount = 0;
      let hasDataStreams = false;

      for (const stream of metadata.streams || []) {
        if (stream.codec_type === 'video' && !videoStream) {
          let fps = 0;
          if (stream.r_frame_rate) {
            const [num, den] = stream.r_frame_rate.split('/').map(Number);
            if (den && den > 0 && num) {
              fps = Math.round((num / den) * 100) / 100;
            }
          }
          videoStream = {
            codec: stream.codec_name || 'unknown',
            width: stream.width || 0,
            height: stream.height || 0,
            fps,
            duration: stream.duration ? parseFloat(stream.duration) : duration,
            bitrate: stream.bit_rate ? parseInt(stream.bit_rate, 10) : undefined,
            pixFmt: stream.pix_fmt || undefined,
            profile: stream.profile || undefined,
          };
        } else if (stream.codec_type === 'audio') {
          audioStreams.push({
            index: audioTrackCount,
            codec: stream.codec_name || 'unknown',
            sampleRate: stream.sample_rate ? parseInt(stream.sample_rate, 10) : 0,
            channels: stream.channels || 0,
            language: stream.tags?.language || undefined,
          });
          audioTrackCount++;
        } else if (stream.codec_type === 'subtitle') {
          subtitleTrackCount++;
        } else if (stream.codec_type === 'data') {
          hasDataStreams = true;
        }
      }

      // 2. Extract keyframes (+ Bytes je Keyframe-Abschnitt) with live progress
      const videoStreamIndex = (metadata.streams || []).find((st) => st.codec_type === 'video')?.index ?? 0;
      const rawGops = await runFfprobeKeyframes(resolved.absPath, videoStreamIndex, (latestTime) => {
        if (duration > 0) {
          // Paketzeiten sind absolut (bei .ts oft ab 100 s+): start_time abziehen, sonst
          // springt der Fortschritt sofort auf 99 %.
          const pct = Math.min(99, Math.max(0, Math.round(((latestTime - startTime) / duration) * 100)));
          if (pct > currentPercent) {
            currentPercent = pct;
            const entry = activeAnalyses.get(videoId);
            if (entry) entry.percent = pct;
            emitter.emit('progress', pct);
          }
        }
      });

      // Normalize keyframes: subtract startTime, Duplikate zusammenlegen (Bytes addieren)
      const gopMap = new Map<number, number>();
      for (const g of rawGops) {
        const rel = g.time - startTime;
        if (rel < -0.01) continue;
        const rounded = Math.round(Math.max(0, rel) * 1000) / 1000;
        gopMap.set(rounded, (gopMap.get(rounded) || 0) + g.bytes);
      }
      const gops = Array.from(gopMap.entries()).sort((a, b) => a[0] - b[0]);
      if (gops.length === 0 || gops[0][0] > 0.1) {
        gops.unshift([0, 0]);
      }
      const keyframes = gops.map((g) => g[0]);
      const gopBytes = gops.map((g) => g[1]);

      // Average and maximum keyframe intervals
      let keyframeIntervalAvg = 2.0;
      let keyframeIntervalMax = 2.0;
      if (keyframes.length > 1) {
        let sumGaps = 0;
        let maxGap = 0;
        for (let i = 1; i < keyframes.length; i++) {
          const gap = keyframes[i] - keyframes[i - 1];
          sumGaps += gap;
          if (gap > maxGap) {
            maxGap = gap;
          }
        }
        keyframeIntervalAvg = Math.round((sumGaps / (keyframes.length - 1)) * 10) / 10;
        keyframeIntervalMax = Math.round(maxGap * 10) / 10;
      } else if (duration > 0) {
        keyframeIntervalAvg = Math.round(duration * 10) / 10;
        keyframeIntervalMax = Math.round(duration * 10) / 10;
      }

      const result: ProbeResult = {
        filename: resolved.displayName,
        filesize: stat.size,
        container,
        duration,
        startTime,
        video: videoStream,
        audio: audioStreams,
        audioTrackCount,
        subtitleTrackCount,
        hasDataStreams,
        keyframes,
        gopBytes,
        keyframeIntervalAvg,
        keyframeIntervalMax,
        analyzedAt: new Date().toISOString(),
        probeVersion: PROBE_VERSION,
      };

      try {
        fs.writeFileSync(cacheFilePath, JSON.stringify(result), 'utf-8');
      } catch {
        // ignore cache write error
      }

      emitter.emit('progress', 100);
      emitter.emit('done', result);
      return result;
    } catch (err) {
      emitter.emit('error', err);
      throw err;
    } finally {
      activeAnalyses.delete(videoId);
    }
  })();

  activeAnalyses.set(videoId, {
    emitter,
    percent: 0,
    promise,
  });

  return promise;
}

export async function probeVideo(resolved: ResolvedVideo, videoId?: string): Promise<ProbeResult> {
  const cached = getCachedProbe(resolved);
  if (cached) return cached;
  const id = videoId || `${resolved.source}:${Buffer.from(resolved.relPath).toString('base64url')}`;
  return startVideoAnalysis(resolved, id);
}

interface FfprobeRawOutput {
  format?: {
    duration?: string;
    start_time?: string;
    format_name?: string;
    size?: string;
  };
  streams?: Array<{
    index?: number;
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    duration?: string;
    bit_rate?: string;
    pix_fmt?: string;
    profile?: string;
    sample_rate?: string;
    channels?: number;
    tags?: { language?: string };
  }>;
}

function runFfprobeMetadata(filePath: string): Promise<FfprobeRawOutput> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      filePath,
    ];

    const child = spawn('ffprobe', args);
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => {
      stdout += d.toString();
    });

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    child.on('error', (err) => {
      reject(new Error(`ffprobe konnte nicht gestartet werden: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe fehlgeschlagen (Code ${code}): ${stderr || 'Unbekannter Fehler'}`));
      }
      try {
        const parsed = JSON.parse(stdout) as FfprobeRawOutput;
        resolve(parsed);
      } catch (e: any) {
        reject(new Error(`Fehler beim Parsen der ffprobe-Metadaten: ${e.message}`));
      }
    });
  });
}

export interface RawGop {
  time: number;
  bytes: number;
}

/**
 * Alle Pakete ohne Decodieren lesen: Keyframes der Videospur + Bytes ALLER Streams je
 * Keyframe-Abschnitt (für den Größen-Modus). ffprobe gibt die Felder in seiner internen
 * Reihenfolge aus: stream_index, pts_time, dts_time, size, flags.
 */
function runFfprobeKeyframes(
  filePath: string,
  videoStreamIndex: number,
  onPacketTime?: (time: number) => void
): Promise<RawGop[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-show_entries',
      'packet=stream_index,pts_time,dts_time,size,flags',
      '-of',
      'csv=p=0',
      filePath,
    ];

    const child = spawn('ffprobe', args);
    const gops: RawGop[] = [];
    let current: RawGop | null = null;
    let stderr = '';

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      const parts = line.split(',');
      if (parts.length < 5) return;
      const streamIdx = parseInt(parts[0], 10);
      const ptsStr = parts[1].trim();
      const dtsStr = parts[2].trim();
      const size = parseInt(parts[3], 10) || 0;
      const flags = parts[4].trim();
      // pts_time kann bei MKV "N/A" sein, dann dts_time nehmen.
      const timeStr = ptsStr && ptsStr !== 'N/A' ? ptsStr : dtsStr;
      const t = timeStr && timeStr !== 'N/A' ? parseFloat(timeStr) : NaN;

      if (streamIdx === videoStreamIndex && flags.includes('K') && !Number.isNaN(t)) {
        current = { time: t, bytes: 0 };
        gops.push(current);
        if (onPacketTime) onPacketTime(t);
      }
      if (!current) {
        // Pakete vor dem ersten Keyframe (z. B. Audio) zählen zum ersten Abschnitt
        current = { time: Number.isNaN(t) ? 0 : t, bytes: 0 };
        gops.push(current);
      }
      current.bytes += size;
    });

    child.on('error', (err) => {
      reject(new Error(`ffprobe-Keyframe-Extraktion fehlgeschlagen: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe Keyframe-Fehler (Code ${code}): ${stderr}`));
      }
      resolve(gops);
    });
  });
}

// Queue for Thumbnail generation: only 1 ffmpeg thumbnail process at a time
class ThumbnailQueue {
  private queue: Array<() => Promise<void>> = [];
  private isProcessing = false;

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          const res = await task();
          resolve(res);
        } catch (err) {
          reject(err);
        }
      });
      this.runNext();
    });
  }

  private async runNext() {
    if (this.isProcessing || this.queue.length === 0) return;
    this.isProcessing = true;
    const task = this.queue.shift()!;
    try {
      await task();
    } finally {
      this.isProcessing = false;
      this.runNext();
    }
  }
}

const thumbQueue = new ThumbnailQueue();

export async function generateThumbnail(filePath: string, timeInSeconds: number): Promise<string> {
  const cacheKey = getFileCacheKey(filePath);
  const safeTime = Math.max(0, Math.round(timeInSeconds * 100) / 100);
  const thumbFileName = `${cacheKey}_t${safeTime.toFixed(2)}.jpg`;
  const thumbPath = path.join(THUMBS_DIR, thumbFileName);

  // If already exists on disk, return immediately without queueing
  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  // Queue thumbnail ffmpeg execution to prevent CPU/IO spikes
  return thumbQueue.enqueue(() => {
    return new Promise((resolve, reject) => {
      if (fs.existsSync(thumbPath)) {
        return resolve(thumbPath);
      }

      const args = [
        '-ss',
        safeTime.toString(),
        '-i',
        filePath,
        '-frames:v',
        '1',
        '-vf',
        'scale=320:-2',
        '-q:v',
        '4',
        '-y',
        thumbPath,
      ];

      const child = spawn('ffmpeg', args);
      let stderr = '';

      child.stderr.on('data', (d) => {
        stderr += d.toString();
      });

      child.on('error', (err) => {
        reject(new Error(`Thumbnail-Generierung fehlgeschlagen: ${err.message}`));
      });

      child.on('close', (code) => {
        if (code === 0 && fs.existsSync(thumbPath)) {
          resolve(thumbPath);
        } else {
          reject(new Error(`Fehler bei Thumbnail-Erstellung (Code ${code}): ${stderr}`));
        }
      });
    });
  });
}
