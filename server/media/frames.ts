import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { THUMBS_DIR } from '../config.js';
import { getCachedProbe, getFileCacheKey } from './probe.js';
import { bestPreviewFile } from './preview.js';
import type { ResolvedVideo } from '../types.js';

/**
 * Einzelbilder für Karten (320 px) und den Monitor (640 px).
 *
 * Zwei Wege:
 * - 'keyframe': das Bild am letzten Keyframe ≤ t. Kommt aus der Vorschau-Kopie (oder dem Original
 *   direkt am Keyframe) und ist deshalb schnell – beim Scrubben die einzig flüssige Variante.
 * - 'exact': das Bild genau bei t. Muss ab dem vorherigen Keyframe decodiert werden (bei 5K-HEVC
 *   mit 10-s-GOPs mehrere Sekunden) und läuft deshalb in einer eigenen, langsamen Warteschlange,
 *   damit es die Kartenbilder nicht blockiert. Abgebrochene Anfragen werden übersprungen.
 */
export type FrameSize = 'thumb' | 'monitor';
const WIDTH: Record<FrameSize, number> = { thumb: 320, monitor: 640 };

class SerialQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = false;
  enqueue<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await task());
        } catch (err) {
          reject(err);
        }
      });
      void this.runNext();
    });
  }
  private async runNext() {
    if (this.running || this.queue.length === 0) return;
    this.running = true;
    const task = this.queue.shift()!;
    try {
      await task();
    } finally {
      this.running = false;
      void this.runNext();
    }
  }
}

const fastQueue = new SerialQueue();
const slowQueue = new SerialQueue();

export function round2(t: number): number {
  return Math.max(0, Math.round(t * 100) / 100);
}

export function framePath(absPath: string, time: number, size: FrameSize): string {
  return path.join(THUMBS_DIR, `${getFileCacheKey(absPath)}_${size === 'monitor' ? 'm' : 't'}${round2(time).toFixed(2)}.jpg`);
}

/** Letzter Keyframe ≤ t (Anfang zählt als Keyframe) */
export function keyframeAtOrBefore(keyframes: number[], t: number): number {
  let best = 0;
  for (const k of keyframes) {
    if (k <= t + 0.0005) best = k;
    else break;
  }
  return best;
}

function runFfmpegFrame(source: string, seekTime: number, width: number, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = `${outPath}.${process.pid}.${Date.now()}.tmp.jpg`;
    const child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-ss', seekTime.toFixed(3), '-i', source, '-frames:v', '1', '-vf', `scale=${width}:-2`, '-q:v', '4', '-f', 'image2', tmp]);
    let stderr = '';
    child.stderr.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => reject(new Error(`ffmpeg konnte nicht gestartet werden: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(tmp)) {
        try {
          fs.renameSync(tmp, outPath);
          resolve();
        } catch (err: any) {
          reject(err);
        }
      } else {
        fs.rmSync(tmp, { force: true });
        reject(new Error(`Einzelbild fehlgeschlagen (Code ${code}): ${stderr.split('\n').filter(Boolean).slice(-2).join(' | ')}`));
      }
    });
  });
}

export interface FrameResult {
  path: string;
  /** Zeit des gezeigten Bilds (bei 'keyframe' der Keyframe, sonst t) */
  time: number;
  exact: boolean;
  source: 'copy' | 'original';
}

export interface FrameOptions {
  exact?: boolean;
  size?: FrameSize;
  /** true, wenn der Aufrufer nicht mehr wartet – dann wird nichts mehr decodiert */
  isCancelled?: () => boolean;
}

export async function getFrame(resolved: ResolvedVideo, time: number, options: FrameOptions = {}): Promise<FrameResult> {
  const size = options.size || 'thumb';
  const probe = getCachedProbe(resolved);
  const keyframes = probe?.keyframes || [];
  const duration = probe?.duration || Infinity;
  const t = Math.min(Math.max(0, time), Math.max(0, duration - 0.001));
  const best = bestPreviewFile(resolved.absPath);
  const onKeyframe = keyframes.some((k) => Math.abs(k - t) < 0.02);
  const exact = !!options.exact && !onKeyframe;

  let shownTime = t;
  let source: string;
  let seekOffset = 0;
  let fromCopy = false;
  if (exact) {
    // Genau dieses Bild: nur die vollständige Kopie oder das Original haben es
    if (best?.kind === 'full') {
      source = best.file;
      fromCopy = true;
    } else source = resolved.absPath;
  } else {
    shownTime = onKeyframe ? t : keyframeAtOrBefore(keyframes, t);
    if (best) {
      source = best.file;
      fromCopy = true;
      // Keyframe-Kopie: Bilder liegen exakt auf den Keyframe-Zeiten – minimal davor suchen,
      // sonst erwischt -ss durch Rundung das NÄCHSTE Bild (10 s später).
      if (best.kind === 'keyframes') seekOffset = 0.05;
    } else source = resolved.absPath;
  }

  const outPath = framePath(resolved.absPath, shownTime, size);
  const result: FrameResult = { path: outPath, time: round2(shownTime), exact, source: fromCopy ? 'copy' : 'original' };
  if (fs.existsSync(outPath)) return result;

  const slow = !fromCopy && exact;
  const queue = slow ? slowQueue : fastQueue;
  await queue.enqueue(async () => {
    if (fs.existsSync(outPath)) return;
    if (options.isCancelled?.()) throw new Error('abgebrochen');
    await runFfmpegFrame(source, Math.max(0, round2(shownTime) - seekOffset), WIDTH[size], outPath);
  });
  return result;
}

/**
 * Nach dem Bau der Keyframe-Kopie: alle Keyframe-Bilder in beiden Größen in EINEM ffmpeg-Lauf
 * vorbereiten, damit das Scrubben sofort flüssig ist (302 Bilder ≈ 2–3 s).
 */
export async function pregenerateKeyframeFrames(resolved: ResolvedVideo, copyPath: string): Promise<number> {
  const key = getFileCacheKey(resolved.absPath);
  const pts: number[] = await new Promise((resolve) => {
    const child = spawn('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', copyPath]);
    let out = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.on('close', () => resolve(out.split('\n').map((l) => parseFloat(l.trim().replace(/,$/, ''))).filter((n) => Number.isFinite(n))));
    child.on('error', () => resolve([]));
  });
  if (pts.length === 0) return 0;

  const tmpDir = fs.mkdtempSync(path.join(THUMBS_DIR, '.strip-'));
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('ffmpeg', [
        '-hide_banner', '-nostdin', '-y', '-i', copyPath,
        '-filter_complex', '[0:v]split=2[a][b];[a]scale=320:-2[t];[b]scale=640:-2[m]',
        '-map', '[t]', '-fps_mode', 'passthrough', '-q:v', '4', '-f', 'image2', path.join(tmpDir, 't%06d.jpg'),
        '-map', '[m]', '-fps_mode', 'passthrough', '-q:v', '4', '-f', 'image2', path.join(tmpDir, 'm%06d.jpg'),
      ]);
      child.on('error', reject);
      child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`Filmstreifen fehlgeschlagen (Code ${code})`))));
    });
    let count = 0;
    pts.forEach((p, i) => {
      const n = String(i + 1).padStart(6, '0');
      for (const [prefix, size] of [['t', 'thumb'], ['m', 'monitor']] as Array<[string, FrameSize]>) {
        const src = path.join(tmpDir, `${prefix}${n}.jpg`);
        if (!fs.existsSync(src)) continue;
        const dst = path.join(THUMBS_DIR, `${key}_${size === 'monitor' ? 'm' : 't'}${round2(p).toFixed(2)}.jpg`);
        try {
          fs.renameSync(src, dst);
          count++;
        } catch {
          // ignore
        }
      }
    });
    return count;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
