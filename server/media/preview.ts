import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { PREVIEW_DIR } from '../config.js';
import { getFileCacheKey } from './probe.js';
import type { PreviewStatus, ProbeResult, ResolvedVideo } from '../types.js';

/**
 * Vorschau-Kopie: kleine H.264/AAC-Datei (max. 854 px breit) für Browser, die den Codec des
 * Originals nicht abspielen (HEVC/MKV/…). Läuft NEBEN der Job-Warteschlange, weil sie CPU
 * statt Platte braucht und einen Schnitt nicht blockieren soll. Die Quelle bleibt unverändert.
 */
interface PreviewBuild {
  emitter: EventEmitter;
  percent: number;
  child: ChildProcess | null;
  cancelled: boolean;
  error?: string;
}

const builds = new Map<string, PreviewBuild>();

export function previewPathFor(absPath: string): string {
  return path.join(PREVIEW_DIR, `${getFileCacheKey(absPath)}.mp4`);
}

export function getPreviewStatus(absPath: string): PreviewStatus {
  const file = previewPathFor(absPath);
  const build = builds.get(file);
  if (build) {
    return { available: false, building: true, percent: build.percent, error: build.error };
  }
  try {
    const stat = fs.statSync(file);
    return { available: true, building: false, percent: 100, size: stat.size };
  } catch {
    return { available: false, building: false, percent: 0 };
  }
}

export function getPreviewEmitter(absPath: string): EventEmitter | null {
  return builds.get(previewPathFor(absPath))?.emitter || null;
}

export function cancelPreviewBuild(absPath: string): boolean {
  const build = builds.get(previewPathFor(absPath));
  if (!build) return false;
  build.cancelled = true;
  try {
    build.child?.kill('SIGTERM');
  } catch {
    // ignore
  }
  return true;
}

export function deletePreview(absPath: string): boolean {
  const file = previewPathFor(absPath);
  if (builds.has(file)) return cancelPreviewBuild(absPath);
  try {
    fs.rmSync(file, { force: true });
    return true;
  } catch {
    return false;
  }
}

export function startPreviewBuild(resolved: ResolvedVideo, probe: ProbeResult): PreviewStatus {
  const file = previewPathFor(resolved.absPath);
  if (builds.has(file) || fs.existsSync(file)) return getPreviewStatus(resolved.absPath);

  const build: PreviewBuild = { emitter: new EventEmitter(), percent: 0, child: null, cancelled: false };
  builds.set(file, build);
  const tmp = file.replace(/\.mp4$/, '.tmp.mp4');

  const args = [
    '-hide_banner',
    '-nostdin',
    '-y',
    '-i',
    resolved.absPath,
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    '-sn',
    '-dn',
    // Nicht hochskalieren, Breite auf 854 begrenzen, gerade Kantenlänge
    '-vf',
    "scale=w='min(854,iw)':h=-2",
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '26',
    '-pix_fmt',
    'yuv420p',
    // Kurze GOPs, damit der Player flott springt
    '-g',
    '30',
    '-c:a',
    'aac',
    '-b:a',
    '96k',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    tmp,
  ];

  const child = spawn('ffmpeg', args);
  build.child = child;
  const stderr: string[] = [];
  readline.createInterface({ input: child.stderr!, crlfDelay: Infinity }).on('line', (l) => {
    stderr.push(l.trim());
    if (stderr.length > 20) stderr.shift();
  });
  readline.createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (l) => {
    if (l.startsWith('out_time_us=') && probe.duration > 0) {
      const us = parseInt(l.slice(12), 10);
      if (Number.isNaN(us)) return;
      const pct = Math.min(99, Math.max(0, Math.round((us / 1e6 / probe.duration) * 100)));
      if (pct !== build.percent) {
        build.percent = pct;
        build.emitter.emit('progress', pct);
      }
    }
  });

  const finish = (error?: string) => {
    builds.delete(file);
    if (error) {
      fs.rmSync(tmp, { force: true });
      build.error = error;
      build.emitter.emit('error', new Error(error));
    } else {
      build.emitter.emit('done');
    }
  };

  child.on('error', (err) => finish(`Vorschau-Kopie konnte nicht erzeugt werden: ${err.message}`));
  child.on('close', (code) => {
    build.child = null;
    if (build.cancelled) return finish('Abgebrochen');
    if (code !== 0) return finish(`ffmpeg-Fehler (Code ${code}): ${stderr.filter(Boolean).slice(-3).join(' | ') || 'unbekannt'}`);
    try {
      fs.renameSync(tmp, file);
      finish();
    } catch (err: any) {
      finish(`Vorschau-Kopie konnte nicht gespeichert werden: ${err.message}`);
    }
  });

  return getPreviewStatus(resolved.absPath);
}
