import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { PREVIEW_DIR } from '../config.js';
import { getFileCacheKey } from './probe.js';
import { pregenerateKeyframeFrames } from './frames.js';
import type { PreviewKind, PreviewStatus, ProbeResult, ResolvedVideo } from '../types.js';

/**
 * Vorschau-Kopie: kleine H.264/AAC-Datei (max. 854 px breit) für Browser, die den Codec des
 * Originals nicht abspielen (HEVC/MKV/…). Läuft NEBEN der Job-Warteschlange, weil sie CPU
 * statt Platte braucht und einen Schnitt nicht blockieren soll. Die Quelle bleibt unverändert.
 *
 * Zwei Arten:
 * - 'keyframes' (Standard): `-skip_frame nokey` decodiert nur die I-Frames – genau die Bilder, an denen
 *   verlustfrei geschnitten werden kann. Bei 5K-HEVC mit 10-s-GOPs sind das 300 statt 180.000 Bilder,
 *   also Sekunden statt Stunden. Ergebnis ist eine „Diashow“ mit Originalzeitstempeln.
 * - 'full': alle Bilder, flüssig, aber das Original wird komplett decodiert.
 */
interface PreviewBuild {
  emitter: EventEmitter;
  kind: PreviewKind;
  percent: number;
  child: ChildProcess | null;
  cancelled: boolean;
  error?: string;
}

const builds = new Map<string, PreviewBuild>(); // key = Basis-Cache-Key

function baseKey(absPath: string): string {
  return getFileCacheKey(absPath);
}

export function previewPathFor(absPath: string, kind: PreviewKind): string {
  return path.join(PREVIEW_DIR, `${baseKey(absPath)}${kind === 'keyframes' ? '_kf' : ''}.mp4`);
}

/** Beste vorhandene Kopie: vollständig vor Keyframes */
export function bestPreviewFile(absPath: string): { file: string; kind: PreviewKind } | null {
  for (const kind of ['full', 'keyframes'] as PreviewKind[]) {
    const file = previewPathFor(absPath, kind);
    if (fs.existsSync(file)) return { file, kind };
  }
  return null;
}

export function getPreviewStatus(absPath: string): PreviewStatus {
  const build = builds.get(baseKey(absPath));
  const best = bestPreviewFile(absPath);
  const status: PreviewStatus = best
    ? { available: true, kind: best.kind, building: false, percent: 100, size: fs.statSync(best.file).size }
    : { available: false, building: false, percent: 0 };
  if (build) {
    status.building = true;
    status.buildingKind = build.kind;
    status.percent = build.percent;
    status.error = build.error;
  }
  return status;
}

export function getPreviewEmitter(absPath: string): EventEmitter | null {
  return builds.get(baseKey(absPath))?.emitter || null;
}

export function cancelPreviewBuild(absPath: string): boolean {
  const build = builds.get(baseKey(absPath));
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
  if (builds.has(baseKey(absPath))) return cancelPreviewBuild(absPath);
  try {
    for (const kind of ['full', 'keyframes'] as PreviewKind[]) fs.rmSync(previewPathFor(absPath, kind), { force: true });
    return true;
  } catch {
    return false;
  }
}

export function startPreviewBuild(resolved: ResolvedVideo, probe: ProbeResult, kind: PreviewKind): PreviewStatus {
  const key = baseKey(resolved.absPath);
  const file = previewPathFor(resolved.absPath, kind);
  if (builds.has(key) || fs.existsSync(file)) return getPreviewStatus(resolved.absPath);

  const build: PreviewBuild = { emitter: new EventEmitter(), kind, percent: 0, child: null, cancelled: false };
  builds.set(key, build);
  const tmp = file.replace(/\.mp4$/, '.tmp.mp4');
  const hasAudio = (probe.audio || []).length > 0 || probe.audioTrackCount > 0;

  const args = ['-hide_banner', '-nostdin', '-y'];
  if (kind === 'keyframes') args.push('-skip_frame', 'nokey');
  args.push('-i', resolved.absPath);
  if (kind === 'keyframes' && !hasAudio) {
    // Ohne Ton endet die Diashow sonst beim letzten Keyframe; eine stille Spur trägt die volle Länge.
    args.push('-f', 'lavfi', '-t', probe.duration.toFixed(3), '-i', 'anullsrc=r=48000:cl=mono');
  }
  args.push('-map', '0:v:0');
  if (hasAudio) args.push('-map', '0:a:0?');
  else if (kind === 'keyframes') args.push('-map', '1:a:0');
  args.push('-sn', '-dn');
  if (kind === 'keyframes') args.push('-fps_mode', 'passthrough');
  args.push(
    // Nicht hochskalieren, Breite auf 854 begrenzen, gerade Kantenlänge
    '-vf',
    "scale=w='min(854,iw)':h=-2",
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    kind === 'keyframes' ? '23' : '26',
    '-pix_fmt',
    'yuv420p',
    // Keyframes-Kopie: jedes Bild ein I-Frame (exaktes Springen); volle Kopie: kurze GOPs
    '-g',
    kind === 'keyframes' ? '1' : '30',
    '-c:a',
    'aac',
    '-b:a',
    kind === 'keyframes' && !hasAudio ? '32k' : '96k',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    '-progress',
    'pipe:1',
    '-nostats',
    tmp
  );

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
    builds.delete(key);
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
      if (kind === 'keyframes') {
        pregenerateKeyframeFrames(resolved, file).catch(() => undefined);
      }
    } catch (err: any) {
      finish(`Vorschau-Kopie konnte nicht gespeichert werden: ${err.message}`);
    }
  });

  return getPreviewStatus(resolved.absPath);
}
