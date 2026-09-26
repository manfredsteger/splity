import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { FERTIG_DIR, SPLITY_DIR, SPLITY_HOST_PATH, getFreeDiskBytes } from '../config.js';
import { findUniqueDirectoryName, getMediaDuration, sanitizeFileName } from './split.js';
import type { ProbeResult, ResolvedVideo, SplitResult } from '../types.js';

/** Ziel-Container für „neu verpacken“ */
export const REMUX_TARGETS = ['mp4', 'mov', 'mkv'] as const;
export type RemuxTarget = (typeof REMUX_TARGETS)[number];

/** Welche Codecs ein Container aufnehmen kann (Stream-Copy). MKV nimmt praktisch alles. */
const VIDEO_CODECS: Record<RemuxTarget, Set<string> | null> = {
  mp4: new Set(['h264', 'hevc', 'av1', 'mpeg4', 'vp9', 'mjpeg', 'mpeg2video', 'h263']),
  mov: new Set(['h264', 'hevc', 'av1', 'mpeg4', 'vp9', 'mjpeg', 'mpeg2video', 'prores', 'dnxhd', 'rawvideo', 'qtrle']),
  mkv: null,
};
const AUDIO_CODECS: Record<RemuxTarget, Set<string> | null> = {
  mp4: new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'opus', 'flac', 'mp2', 'dts']),
  mov: new Set(['aac', 'mp3', 'ac3', 'eac3', 'alac', 'pcm_s16le', 'pcm_s16be', 'pcm_s24le', 'pcm_s24be', 'pcm_s32le', 'flac', 'opus', 'mp2']),
  mkv: null,
};
/** Untertitel, die in MP4/MOV passen; alles andere (srt, ass, pgs …) wird weggelassen */
const MP4_SUBTITLES = new Set(['mov_text', 'tx3g']);

export interface RemuxCheck {
  ok: boolean;
  problems: string[];
  /** Untertitel, die im Ziel nicht möglich sind und weggelassen würden */
  dropSubtitles: boolean;
  /** Quelle ist MPEG-TS: Bitstream-Umwandlung, Pakete danach nicht bitweise gleich */
  annexB: boolean;
}

export function checkRemux(probe: ProbeResult, sourceExt: string, target: RemuxTarget): RemuxCheck {
  const problems: string[] = [];
  const v = probe.video?.codec?.toLowerCase();
  const allowedV = VIDEO_CODECS[target];
  if (v && allowedV && !allowedV.has(v)) {
    problems.push(`Video-Codec ${v.toUpperCase()} passt nicht in ${target.toUpperCase()}.`);
  }
  const allowedA = AUDIO_CODECS[target];
  for (const a of probe.audio || []) {
    if (allowedA && !allowedA.has(a.codec.toLowerCase())) {
      problems.push(`Ton-Codec ${a.codec.toUpperCase()} (Spur ${a.index + 1}) passt nicht in ${target.toUpperCase()}.`);
    }
  }
  const srcExt = sourceExt.toLowerCase().replace('.', '');
  if (srcExt === target || (srcExt === 'm4v' && target === 'mp4')) {
    problems.push(`Das Video ist schon ${target.toUpperCase()}.`);
  }
  return {
    ok: problems.length === 0,
    problems,
    dropSubtitles: target !== 'mkv' && probe.subtitleTrackCount > 0,
    annexB: ['ts', 'mts', 'm2ts'].includes(srcExt),
  };
}

/** Dateiendung für eine extrahierte Tonspur nach Codec */
export function audioExtensionFor(codec: string): string {
  const c = codec.toLowerCase();
  if (c === 'aac' || c === 'alac') return '.m4a';
  if (c === 'mp3') return '.mp3';
  if (c === 'flac') return '.flac';
  if (c === 'opus') return '.opus';
  if (c === 'vorbis') return '.ogg';
  if (c === 'ac3') return '.ac3';
  if (c === 'eac3') return '.eac3';
  if (c === 'mp2') return '.mp2';
  if (c.startsWith('pcm_')) return '.wav';
  return '.mka';
}

export interface ToolHandle {
  promise: Promise<SplitResult>;
  cancel: () => void;
}

interface RunOptions {
  resolved: ResolvedVideo;
  probe: ProbeResult;
  outName: string;
  /** Argumente zwischen -i <quelle> und der Ausgabedatei */
  buildArgs: (withData: boolean) => string[];
  onProgress: (percent: number) => void;
  warnings: string[];
  durationForProgress: number;
}

/** Gemeinsamer Ablauf: tmp-Ordner, ffmpeg mit Fortschritt, Datenspur-Fallback, Umbenennen */
function runTool(opts: RunOptions): ToolHandle {
  let child: ChildProcess | null = null;
  let cancelled = false;
  let tmpDir = '';

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

  const promise = (async (): Promise<SplitResult> => {
    const started = Date.now();
    const sourceSize = fs.statSync(opts.resolved.absPath).size;
    const freeBytes = await getFreeDiskBytes(SPLITY_DIR);
    if (freeBytes < 50 * 1024 ** 4 && freeBytes < sourceSize * 1.05) {
      throw new Error(`Nicht genug Speicherplatz (frei: ${(freeBytes / 1024 ** 3).toFixed(1)} GB, benötigt: ${((sourceSize * 1.05) / 1024 ** 3).toFixed(1)} GB)`);
    }

    const sourceExt = path.extname(opts.resolved.absPath);
    const cleanBase = sanitizeFileName(path.basename(opts.resolved.absPath, sourceExt)) || 'video';
    const finalDirName = findUniqueDirectoryName(FERTIG_DIR, cleanBase);
    const finalDir = path.join(FERTIG_DIR, finalDirName);
    tmpDir = path.join(FERTIG_DIR, `.${finalDirName}.tmp`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });
    const outPath = path.join(tmpDir, opts.outName);

    const run = (args: string[]) =>
      new Promise<{ code: number; stderr: string[] }>((resolve, reject) => {
        if (cancelled) return reject(new Error('Abgebrochen'));
        child = spawn('ffmpeg', ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-i', opts.resolved.absPath, ...args, outPath]);
        const stderr: string[] = [];
        readline.createInterface({ input: child.stderr!, crlfDelay: Infinity }).on('line', (l) => {
          stderr.push(l.trim());
          if (stderr.length > 30) stderr.shift();
        });
        readline.createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (l) => {
          if (l.startsWith('out_time_us=') && opts.durationForProgress > 0) {
            const us = parseInt(l.slice(12), 10);
            if (!Number.isNaN(us)) opts.onProgress(Math.min(99, Math.max(0, Math.round((us / 1e6 / opts.durationForProgress) * 100))));
          }
        });
        child.on('error', (e) => reject(e));
        child.on('close', (code) => {
          child = null;
          resolve({ code: code ?? 1, stderr });
        });
      });

    try {
      let res = await run(opts.buildArgs(true));
      if (res.code !== 0 && !cancelled && opts.probe.hasDataStreams) {
        fs.rmSync(outPath, { force: true });
        res = await run(opts.buildArgs(false));
        if (res.code === 0) opts.warnings.push('Datenspuren (z. B. Timecode) wurden weggelassen, Bild und Ton sind vollständig.');
      }
      if (cancelled) throw new Error('Abgebrochen');
      if (res.code !== 0) {
        throw new Error(`ffmpeg-Fehler (Code ${res.code}): ${res.stderr.filter(Boolean).slice(-5).join('\n')}`);
      }
      fs.renameSync(tmpDir, finalDir);
      tmpDir = '';
      const outFinal = path.join(finalDir, opts.outName);
      const duration = await getMediaDuration(outFinal);
      return {
        outputDir: finalDir,
        hostOutputDir: path.join(SPLITY_HOST_PATH, 'Fertig', finalDirName),
        files: [{ name: opts.outName, size: fs.statSync(outFinal).size, duration: Math.round(duration * 100) / 100 }],
        warnings: opts.warnings,
        durationSeconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
      };
    } finally {
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })();

  return { promise, cancel };
}

/** Container wechseln ohne Neucodierung (Remux). */
export function remux(resolved: ResolvedVideo, probe: ProbeResult, target: RemuxTarget, onProgress: (pct: number) => void): ToolHandle {
  const check = checkRemux(probe, path.extname(resolved.absPath), target);
  if (!check.ok) {
    return {
      promise: Promise.reject(new Error(check.problems.join(' '))),
      cancel: () => undefined,
    };
  }
  const warnings: string[] = [];
  if (check.dropSubtitles) warnings.push(`Untertitelspuren passen nicht in ${target.toUpperCase()} und wurden weggelassen.`);
  const isHevc = (probe.video?.codec || '').toLowerCase().includes('hevc');
  const cleanBase = sanitizeFileName(path.basename(resolved.absPath, path.extname(resolved.absPath))) || 'video';

  return runTool({
    resolved,
    probe,
    outName: `${cleanBase}.${target}`,
    durationForProgress: probe.duration,
    onProgress,
    warnings,
    buildArgs: (withData) => {
      const args: string[] = [];
      if (withData && !check.dropSubtitles) args.push('-map', '0', '-ignore_unknown');
      else {
        args.push('-map', '0:v', '-map', '0:a?');
        if (!check.dropSubtitles) args.push('-map', '0:s?');
        else args.push('-sn');
        if (!withData) args.push('-dn');
        else args.push('-map', '0:d?', '-ignore_unknown');
      }
      args.push('-map_metadata', '0', '-c', 'copy');
      if (target === 'mp4' || target === 'mov') args.push('-movflags', '+faststart', '-strict', 'experimental');
      if (isHevc && target !== 'mkv') args.push('-tag:v', 'hvc1');
      return args;
    },
  });
}

/** Eine Tonspur ohne Neucodierung herausziehen. */
export function extractAudio(resolved: ResolvedVideo, probe: ProbeResult, track: number, onProgress: (pct: number) => void): ToolHandle {
  const audio = probe.audio || [];
  const a = audio[track];
  if (!a) {
    return { promise: Promise.reject(new Error(`Tonspur ${track + 1} gibt es nicht.`)), cancel: () => undefined };
  }
  const ext = audioExtensionFor(a.codec);
  const cleanBase = sanitizeFileName(path.basename(resolved.absPath, path.extname(resolved.absPath))) || 'video';
  const suffix = audio.length > 1 ? ` (Ton ${track + 1}${a.language ? ` ${a.language}` : ''})` : ' (Ton)';

  return runTool({
    resolved,
    probe,
    outName: `${cleanBase}${suffix}${ext}`,
    durationForProgress: probe.duration,
    onProgress,
    warnings: [],
    buildArgs: () => {
      const args = ['-vn', '-sn', '-dn', '-map', `0:a:${track}`, '-map_metadata', '0', '-c', 'copy'];
      if (ext === '.m4a') args.push('-movflags', '+faststart');
      return args;
    },
  });
}
