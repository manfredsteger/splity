import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DATA_DIR, FERTIG_DIR, SPLITY_DIR, SPLITY_HOST_PATH, getFreeDiskBytes } from '../config.js';
import {
  findUniqueDirectoryName,
  getMediaDuration,
  getTargetExtension,
  sanitizeFileName,
} from './split.js';
import type { ProbeResult, ResolvedVideo, SplitResult } from '../types.js';

/** Kapitel gehen nur in Container, die sie kennen */
export const CHAPTER_CONTAINERS = new Set(['.mp4', '.mov', '.mkv']);

export interface ChapterExportHandle {
  promise: Promise<SplitResult>;
  cancel: () => void;
}

export interface ChapterDef {
  start: number;
  end: number;
  title: string;
}

/** Aus Grenzen (Sekunden) Kapitel bauen: [0..t1], [t1..t2], …, [tn..duration] */
export function buildChapters(duration: number, times: number[], titles?: string[]): ChapterDef[] {
  const bounds = Array.from(new Set(times.filter((t) => t > 0.05 && t < duration - 0.05))).sort((a, b) => a - b);
  const chapters: ChapterDef[] = [];
  let start = 0;
  let i = 0;
  for (const t of bounds) {
    chapters.push({ start, end: t, title: titles?.[i]?.trim() || `Szene ${i + 1}` });
    start = t;
    i++;
  }
  chapters.push({ start, end: duration, title: titles?.[i]?.trim() || `Szene ${i + 1}` });
  return chapters;
}

/** FFMETADATA-Datei (Zeitbasis 1/1000 = Millisekunden, bildgenau, kein Keyframe-Zwang) */
export function formatFfmetadata(chapters: ChapterDef[]): string {
  const esc = (s: string) => s.replace(/([=;#\\\n])/g, '\\$1');
  const lines = [';FFMETADATA1'];
  for (const c of chapters) {
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.start * 1000)}`, `END=${Math.round(c.end * 1000)}`, `title=${esc(c.title)}`);
  }
  return lines.join('\n') + '\n';
}

export function formatChapterCsv(chapters: ChapterDef[]): string {
  const rows = ['Start;Ende;Titel'];
  for (const c of chapters) {
    rows.push(`${c.start.toFixed(3)};${c.end.toFixed(3)};${c.title.replace(/;/g, ',')}`);
  }
  return rows.join('\n') + '\n';
}

/**
 * Kopie des Videos mit Kapiteln schreiben – verlustfrei (-c copy, -map_metadata 0, -map_chapters 1).
 * Die Kapitel dürfen bildgenau sein, weil nichts geschnitten wird.
 */
export function exportChapters(
  resolved: ResolvedVideo,
  probe: ProbeResult,
  times: number[],
  titles: string[] | undefined,
  onProgress: (percent: number) => void
): ChapterExportHandle {
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
    const sourceExt = path.extname(resolved.absPath);
    const targetExt = getTargetExtension(sourceExt);
    if (!CHAPTER_CONTAINERS.has(targetExt)) {
      throw new Error(`Kapitel sind nur bei MP4, MOV und MKV möglich (Container: ${targetExt.replace('.', '').toUpperCase()}).`);
    }

    const sourceSize = fs.statSync(resolved.absPath).size;
    const freeBytes = await getFreeDiskBytes(SPLITY_DIR);
    if (freeBytes < 50 * 1024 ** 4 && freeBytes < sourceSize * 1.05) {
      throw new Error(`Nicht genug Speicherplatz (frei: ${(freeBytes / 1024 ** 3).toFixed(1)} GB, benötigt: ${((sourceSize * 1.05) / 1024 ** 3).toFixed(1)} GB)`);
    }

    const chapters = buildChapters(probe.duration, times, titles);
    if (chapters.length < 2) {
      throw new Error('Mindestens eine Kapitelgrenze innerhalb des Videos ist nötig.');
    }

    const cleanBase = sanitizeFileName(path.basename(resolved.absPath, sourceExt)) || 'video';
    const finalDirName = findUniqueDirectoryName(FERTIG_DIR, cleanBase);
    const finalDir = path.join(FERTIG_DIR, finalDirName);
    tmpDir = path.join(FERTIG_DIR, `.${finalDirName}.tmp`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const metaDir = path.join(DATA_DIR, 'tmp');
    fs.mkdirSync(metaDir, { recursive: true });
    const metaPath = path.join(metaDir, `chapters_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);
    fs.writeFileSync(metaPath, formatFfmetadata(chapters), 'utf-8');

    const outName = `${cleanBase} (Kapitel)${targetExt}`;
    const outPath = path.join(tmpDir, outName);
    const csvName = `${cleanBase} (Kapitel).csv`;
    const isHevc = (probe.video?.codec || '').toLowerCase().includes('hevc');

    const buildArgs = (withData: boolean) => {
      const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-i', resolved.absPath, '-i', metaPath];
      if (withData) args.push('-map', '0', '-ignore_unknown');
      else args.push('-map', '0:v', '-map', '0:a?', '-map', '0:s?', '-dn');
      args.push('-map_metadata', '0', '-map_chapters', '1', '-c', 'copy');
      if (targetExt === '.mp4' || targetExt === '.mov') args.push('-movflags', '+faststart', '-strict', 'experimental');
      if (isHevc) args.push('-tag:v', 'hvc1');
      args.push(outPath);
      return args;
    };

    const run = (args: string[]) =>
      new Promise<{ code: number; stderr: string[] }>((resolve, reject) => {
        if (cancelled) return reject(new Error('Kapitel-Export abgebrochen'));
        child = spawn('ffmpeg', args);
        const stderr: string[] = [];
        readline.createInterface({ input: child.stderr!, crlfDelay: Infinity }).on('line', (l) => {
          stderr.push(l.trim());
          if (stderr.length > 30) stderr.shift();
        });
        readline.createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (l) => {
          if (l.startsWith('out_time_us=') && probe.duration > 0) {
            const us = parseInt(l.slice(12), 10);
            if (!Number.isNaN(us)) onProgress(Math.min(99, Math.max(0, Math.round((us / 1e6 / probe.duration) * 100))));
          }
        });
        child.on('error', (e) => reject(e));
        child.on('close', (code) => {
          child = null;
          resolve({ code: code ?? 1, stderr });
        });
      });

    try {
      const warnings: string[] = [];
      let res = await run(buildArgs(true));
      if (res.code !== 0 && !cancelled && probe.hasDataStreams) {
        fs.rmSync(outPath, { force: true });
        res = await run(buildArgs(false));
        if (res.code === 0) warnings.push('Datenspuren (z. B. Timecode) wurden weggelassen, Bild und Ton sind vollständig.');
      }
      if (cancelled) throw new Error('Kapitel-Export abgebrochen');
      if (res.code !== 0) {
        throw new Error(`ffmpeg-Fehler beim Kapitel-Export (Code ${res.code}): ${res.stderr.filter(Boolean).slice(-5).join('\n')}`);
      }

      fs.writeFileSync(path.join(tmpDir, csvName), formatChapterCsv(chapters), 'utf-8');
      fs.renameSync(tmpDir, finalDir);
      tmpDir = '';

      const outFinal = path.join(finalDir, outName);
      const duration = await getMediaDuration(outFinal);
      if (Math.abs(duration - probe.duration) > 1) {
        warnings.push(`Dauer-Abweichung: Original ${probe.duration.toFixed(1)} s, Ausgabe ${duration.toFixed(1)} s.`);
      }
      return {
        outputDir: finalDir,
        hostOutputDir: path.join(SPLITY_HOST_PATH, 'Fertig', finalDirName),
        files: [
          { name: outName, size: fs.statSync(outFinal).size, duration: Math.round(duration * 100) / 100 },
          { name: csvName, size: fs.statSync(path.join(finalDir, csvName)).size, duration: 0 },
        ],
        warnings,
        durationSeconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
      };
    } finally {
      fs.rmSync(metaPath, { force: true });
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })();

  return { promise, cancel };
}
