import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CACHE_DIR } from '../config.js';
import { getVideoCacheKey } from './probe.js';
import type { ProbeResult, ResolvedVideo, Scene, SceneDetectionResult, SceneParams, SceneSensitivity } from '../types.js';

/** Empfindlichkeit -> scdet-Schwelle (niedrig = nur harte Schnitte, hoch = auch weiche Übergänge) */
export const SENSITIVITY_THRESHOLDS: Record<SceneSensitivity, number> = {
  low: 15,
  mid: 10,
  high: 6,
};

/** Zwei Grenzen, die näher beieinander liegen, gelten als dieselbe (Szene + Schwarzbild am selben Schnitt). */
const MERGE_WINDOW_SECONDS = 0.5;

export interface SceneDetectionHandle {
  promise: Promise<SceneDetectionResult>;
  cancel: () => void;
}

export interface RawBoundary {
  time: number;
  score: number;
  kind: 'scene' | 'black';
}

export function getSceneCachePath(resolved: ResolvedVideo, params: SceneParams): string {
  const stat = fs.statSync(resolved.absPath);
  const key = getVideoCacheKey(resolved.source, resolved.relPath, stat.size, stat.mtimeMs);
  return path.join(CACHE_DIR, `${key}_scenes_${params.threshold}_${params.black ? 'black' : 'plain'}.json`);
}

export function getCachedScenes(resolved: ResolvedVideo, params: SceneParams): SceneDetectionResult | null {
  try {
    const p = getSceneCachePath(resolved, params);
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf-8')) as SceneDetectionResult;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Eine stderr-Zeile von ffmpeg auswerten. Formate (ffmpeg 5.1 bis 8.0 identisch):
 *   [scdet @ 0x…] lavfi.scd.score: 28.330, lavfi.scd.time: 10
 *   [blackdetect @ 0x…] black_start:10 black_end:10.5 black_duration:0.5
 * Die Zeiten sind bereits relativ zum Dateianfang – anders als bei ffprobe-Paketen muss
 * start_time hier NICHT abgezogen werden (getestet mit einer TS-Datei mit 101 s Offset).
 */
export function parseSceneLine(line: string): RawBoundary | null {
  const scd = line.match(/lavfi\.scd\.score:\s*([\d.]+),\s*lavfi\.scd\.time:\s*([\d.]+)/);
  if (scd) {
    const score = parseFloat(scd[1]);
    const time = parseFloat(scd[2]);
    if (Number.isFinite(time) && Number.isFinite(score)) {
      return { time, score, kind: 'scene' };
    }
    return null;
  }
  const black = line.match(/black_start:\s*([\d.]+)\s+black_end:\s*([\d.]+)\s+black_duration:\s*([\d.]+)/);
  if (black) {
    const start = parseFloat(black[1]);
    const dur = parseFloat(black[3]);
    if (Number.isFinite(start) && Number.isFinite(dur)) {
      // Schnitt am Beginn des Schwarzbilds: Die Blende gehört zum folgenden Teil.
      return { time: start, score: dur, kind: 'black' };
    }
  }
  return null;
}

/** Grenzen sortieren, zu nahe beieinanderliegende zusammenlegen, Szenenliste bauen. */
export function buildScenes(duration: number, raw: RawBoundary[]): Scene[] {
  const sorted = raw
    .filter((b) => b.time > MERGE_WINDOW_SECONDS && b.time < duration - MERGE_WINDOW_SECONDS)
    .sort((a, b) => a.time - b.time);

  const boundaries: RawBoundary[] = [];
  for (const b of sorted) {
    const last = boundaries[boundaries.length - 1];
    if (last && b.time - last.time < MERGE_WINDOW_SECONDS) {
      // Szenenwechsel schlägt Schwarzbild, sonst den höheren Score behalten
      if (last.kind === 'black' && b.kind === 'scene') {
        boundaries[boundaries.length - 1] = b;
      } else if (last.kind === b.kind && b.score > last.score) {
        boundaries[boundaries.length - 1] = b;
      }
      continue;
    }
    boundaries.push(b);
  }

  const scenes: Scene[] = [];
  let start = 0;
  let index = 1;
  let kind: Scene['kind'] = 'start';
  let score = 0;
  for (const b of boundaries) {
    scenes.push({ index, start, end: b.time, duration: round3(b.time - start), score, kind });
    start = b.time;
    kind = b.kind;
    score = b.score;
    index++;
  }
  scenes.push({ index, start, end: round3(duration), duration: round3(duration - start), score, kind });
  return scenes.map((s) => ({ ...s, start: round3(s.start), end: round3(s.end), score: Math.round(s.score * 100) / 100 }));
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/**
 * Szenen erkennen. Das ist die einzige Stelle in Splity, die decodiert – die Quelle wird
 * dabei nicht verändert. Verkleinerung auf 320 px macht es um ein Vielfaches schneller.
 */
export function detectScenes(
  resolved: ResolvedVideo,
  probe: ProbeResult,
  params: SceneParams,
  onProgress: (percent: number) => void
): SceneDetectionHandle {
  let child: ChildProcess | null = null;
  let cancelled = false;

  const cancel = () => {
    cancelled = true;
    if (child) {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
  };

  const promise = new Promise<SceneDetectionResult>((resolve, reject) => {
    const started = Date.now();
    const filters = [`scale=320:-2`, `scdet=threshold=${params.threshold}`];
    if (params.black) {
      filters.push('blackdetect=d=0.3:pic_th=0.98');
    }

    const args = [
      '-hide_banner',
      '-nostdin',
      '-progress',
      'pipe:1',
      '-nostats',
      '-i',
      resolved.absPath,
      '-an',
      '-sn',
      '-dn',
      '-vf',
      filters.join(','),
      '-f',
      'null',
      '-',
    ];

    child = spawn('ffmpeg', args);
    const raw: RawBoundary[] = [];
    const stderrTail: string[] = [];

    const rlErr = readline.createInterface({ input: child.stderr!, crlfDelay: Infinity });
    rlErr.on('line', (line) => {
      const b = parseSceneLine(line);
      if (b) {
        raw.push(b);
        return;
      }
      stderrTail.push(line.trim());
      if (stderrTail.length > 20) stderrTail.shift();
    });

    let lastPercent = -1;
    const rlOut = readline.createInterface({ input: child.stdout!, crlfDelay: Infinity });
    rlOut.on('line', (line) => {
      if (line.startsWith('out_time_us=') && probe.duration > 0) {
        const us = parseInt(line.slice('out_time_us='.length), 10);
        if (!Number.isNaN(us)) {
          const pct = Math.min(99, Math.max(0, Math.round((us / 1_000_000 / probe.duration) * 100)));
          if (pct !== lastPercent) {
            lastPercent = pct;
            onProgress(pct);
          }
        }
      }
    });

    child.on('error', (err) => {
      reject(new Error(`ffmpeg konnte nicht gestartet werden: ${err.message}`));
    });

    child.on('close', (code) => {
      child = null;
      if (cancelled) {
        return reject(new Error('Szenenerkennung abgebrochen'));
      }
      if (code !== 0) {
        return reject(
          new Error(`Szenenerkennung fehlgeschlagen (Code ${code}): ${stderrTail.filter(Boolean).slice(-5).join('\n') || 'Unbekannter Fehler'}`)
        );
      }

      const result: SceneDetectionResult = {
        threshold: params.threshold,
        black: params.black,
        scenes: buildScenes(probe.duration, raw),
        durationMs: Date.now() - started,
        analyzedAt: new Date().toISOString(),
      };

      try {
        fs.writeFileSync(getSceneCachePath(resolved, params), JSON.stringify(result), 'utf-8');
      } catch {
        // Cache ist optional
      }
      onProgress(100);
      resolve(result);
    });
  });

  return { promise, cancel };
}
