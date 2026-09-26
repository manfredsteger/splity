import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { FERTIG_DIR, SPLITY_DIR, SPLITY_HOST_PATH, getFreeDiskBytes, loadSettings } from '../config.js';
import type { ProbeResult, SplitPlan, SplitResult, SplitResultFile } from '../types.js';

export interface SplitProgressCallback {
  (progress: { percent: number; currentPart: number; totalParts: number }): void;
}

export interface SplitExecutionHandle {
  promise: Promise<SplitResult>;
  cancel: () => void;
}

export function sanitizeFileName(name: string): string {
  // Remove control characters and characters forbidden in Windows/macOS/Linux paths
  return name
    .replace(/[/\\[\]?*:"<>|]/g, '_')
    .replace(/[\x00-\x1F\x7F]/g, '')
    .trim();
}

export function getTargetExtension(sourceExt: string): string {
  const ext = sourceExt.toLowerCase();
  switch (ext) {
    case '.mp4':
    case '.m4v':
      return '.mp4';
    case '.mov':
      return '.mov';
    case '.mkv':
      return '.mkv';
    case '.webm':
      return '.webm';
    case '.avi':
      return '.avi';
    case '.ts':
    case '.mts':
    case '.m2ts':
      return '.ts';
    default:
      return ext.length > 1 ? ext : '.mp4';
  }
}

export function findUniqueDirectoryName(baseDir: string, desiredName: string): string {
  let candidate = desiredName;
  let counter = 2;
  while (fs.existsSync(path.join(baseDir, candidate))) {
    candidate = `${desiredName} (${counter})`;
    counter++;
  }
  return candidate;
}

export function formatHms(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${String(h).padStart(2, '0')}-${String(m).padStart(2, '0')}-${String(s).padStart(2, '0')}`;
}

export function formatPartFileName(
  pattern: string,
  baseName: string,
  partIndex: number,
  totalParts: number,
  ext: string,
  startSeconds = 0,
  endSeconds = 0
): string {
  const padLength = totalParts >= 100 ? 3 : 2;
  const nrStr = String(partIndex).padStart(padLength, '0');
  const totalStr = String(totalParts).padStart(padLength, '0');
  const startStr = formatHms(startSeconds);
  const endeStr = formatHms(endSeconds);

  let name = pattern
    .replace(/\{name\}/g, baseName)
    .replace(/\{nr\}/g, nrStr)
    .replace(/\{gesamt\}/g, totalStr)
    .replace(/\{start\}/g, startStr)
    .replace(/\{ende\}/g, endeStr);

  name = sanitizeFileName(name);
  if (!name.endsWith(ext)) {
    name += ext;
  }
  return name;
}

export async function getMediaDuration(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      filePath,
    ]);
    let output = '';
    child.stdout.on('data', (d) => {
      output += d.toString();
    });
    child.on('close', (code) => {
      if (code === 0 && output) {
        const dur = parseFloat(output.trim());
        resolve(Number.isNaN(dur) ? 0 : dur);
      } else {
        resolve(0);
      }
    });
    child.on('error', () => resolve(0));
  });
}

export function executeSplit(
  sourceFilePath: string,
  probe: ProbeResult,
  plan: SplitPlan,
  onProgress: SplitProgressCallback
): SplitExecutionHandle {
  let activeChild: ChildProcess | null = null;
  let isCancelled = false;
  let tmpDirPath = '';

  const cancel = () => {
    isCancelled = true;
    if (activeChild) {
      try {
        activeChild.kill('SIGTERM');
      } catch {
        // ignore
      }
    }
    if (tmpDirPath && fs.existsSync(tmpDirPath)) {
      try {
        fs.rmSync(tmpDirPath, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  };

  const promise = (async (): Promise<SplitResult> => {
    const startTime = Date.now();
    const sourceStat = fs.statSync(sourceFilePath);
    const sourceSize = sourceStat.size;

    // 1. Check free disk space: free < size * 1.05 -> error
    // Werte über 50 TB sind ein Docker-Desktop-Artefakt (Bind-Mount) -> Prüfung überspringen
    const MAX_REALISTIC_FREE_BYTES = 50 * 1024 * 1024 * 1024 * 1024; // 50 TB
    const freeBytes = await getFreeDiskBytes(SPLITY_DIR);
    const requiredBytes = sourceSize * 1.05;
    if (freeBytes < MAX_REALISTIC_FREE_BYTES && freeBytes < requiredBytes) {
      const freeGb = (freeBytes / (1024 * 1024 * 1024)).toFixed(1);
      const reqGb = (requiredBytes / (1024 * 1024 * 1024)).toFixed(1);
      throw new Error(`Nicht genug Speicherplatz (frei: ${freeGb} GB, benötigt: ${reqGb} GB)`);
    }

    if (plan.parts.length <= 1 && plan.cuts.length === 0) {
      throw new Error('Keine Schnittpunkte im Schnittplan vorhanden.');
    }

    const sourceExt = path.extname(sourceFilePath);
    const rawBaseName = path.basename(sourceFilePath, sourceExt);
    const cleanBaseName = sanitizeFileName(rawBaseName) || 'video';
    const targetExt = getTargetExtension(sourceExt);

    const finalDirName = findUniqueDirectoryName(FERTIG_DIR, cleanBaseName);
    const finalDirPath = path.join(FERTIG_DIR, finalDirName);
    const hostOutputDir = path.join(SPLITY_HOST_PATH, 'Fertig', finalDirName);

    // Temporary folder in Fertig: .<name>.tmp
    tmpDirPath = path.join(FERTIG_DIR, `.${finalDirName}.tmp`);
    if (fs.existsSync(tmpDirPath)) {
      fs.rmSync(tmpDirPath, { recursive: true, force: true });
    }
    fs.mkdirSync(tmpDirPath, { recursive: true });

    // Segment times: cut.actualTime - 0.001
    const segmentTimes = plan.cuts.map((cut) => {
      const t = Math.max(0.001, cut.actualTime - 0.001);
      return t.toFixed(3);
    });
    const segmentTimesStr = segmentTimes.join(',');

    const totalParts = plan.parts.length;
    const numDigits = totalParts >= 100 ? 3 : 2;
    const isHevc =
      probe.video?.codec?.toLowerCase().includes('hevc') ||
      probe.video?.codec?.toLowerCase().includes('h265');

    // Build ffmpeg arguments helper
    const buildArgs = (includeDataStreams: boolean) => {
      const args: string[] = [
        '-hide_banner',
        '-nostdin',
        '-y',
        '-i',
        sourceFilePath,
      ];

      if (includeDataStreams) {
        args.push('-map', '0', '-ignore_unknown');
      } else {
        // Fallback omitting data streams
        args.push('-map', '0:v', '-map', '0:a?', '-map', '0:s?', '-dn');
      }

      // -map_metadata 0 ist Pflicht: Ohne das Flag verliert der Segment-Muxer das
      // Aufnahmedatum (creation_time) der Quelle.
      args.push(
        '-map_metadata',
        '0',
        '-c',
        'copy',
        '-f',
        'segment',
        '-segment_times',
        segmentTimesStr,
        '-reset_timestamps',
        '1',
        '-avoid_negative_ts',
        'make_zero',
        '-progress',
        'pipe:1',
        '-nostats'
      );

      if (targetExt === '.mp4' || targetExt === '.mov') {
        // strict=experimental: FLAC-Ton in MP4 verweigert der Muxer sonst komplett. Die Option
        // muss an den inneren MP4-Muxer gehen, ein globales -strict wirkt beim Segment-Muxer nicht.
        // use_metadata_tags: Sonst verlieren die Teile die Apple-Tags (Gerätemodell, Software,
        // Aufnahmeort) – nur creation_time überlebt. Getestet mit einer iPhone-13-mini-Aufnahme.
        args.push('-segment_format_options', 'movflags=+faststart+use_metadata_tags:strict=experimental');
      }

      if (isHevc) {
        args.push('-tag:v', 'hvc1');
      }

      const outPattern = path.join(tmpDirPath, `part_%0${numDigits}d${targetExt}`);
      args.push(outPattern);

      return args;
    };

    const runFfmpeg = (args: string[]): Promise<{ code: number; stderr: string }> => {
      return new Promise((resolve, reject) => {
        if (isCancelled) {
          return reject(new Error('Schnitt abgebrochen'));
        }

        const child = spawn('ffmpeg', args);
        activeChild = child;
        let stderr = '';

        child.stderr.on('data', (d) => {
          stderr += d.toString();
        });

        const rl = readline.createInterface({
          input: child.stdout,
          crlfDelay: Infinity,
        });

        rl.on('line', (line) => {
          // Parse out_time_us=...
          if (line.startsWith('out_time_us=')) {
            const val = line.substring('out_time_us='.length).trim();
            const us = parseInt(val, 10);
            if (!Number.isNaN(us) && probe.duration > 0) {
              const currentSecs = us / 1_000_000;
              const percent = Math.min(99, Math.round((currentSecs / probe.duration) * 100));

              // Determine current part based on currentSecs
              let currentPart = 1;
              for (const part of plan.parts) {
                if (currentSecs >= part.start) {
                  currentPart = part.index;
                }
              }

              onProgress({
                percent,
                currentPart: Math.min(totalParts, currentPart),
                totalParts,
              });
            }
          }
        });

        child.on('error', (err) => {
          activeChild = null;
          reject(err);
        });

        child.on('close', (code) => {
          activeChild = null;
          resolve({ code: code ?? 1, stderr });
        });
      });
    };

    const warnings: string[] = [...plan.warnings];
    let usedDataStreamFallback = false;

    // First attempt: with full stream mapping (-map 0)
    let runResult = await runFfmpeg(buildArgs(true));

    if (runResult.code !== 0 && !isCancelled && probe.hasDataStreams) {
      // Automatic second attempt omitting data streams (Timecode, GPS, etc.)
      // Clean tmp folder before retry
      try {
        const files = fs.readdirSync(tmpDirPath);
        for (const f of files) {
          fs.rmSync(path.join(tmpDirPath, f), { force: true });
        }
      } catch {
        // ignore
      }

      runResult = await runFfmpeg(buildArgs(false));
      if (runResult.code === 0) {
        usedDataStreamFallback = true;
        warnings.push('Datenspuren (z. B. Timecode) wurden weggelassen.');
      }
    }

    if (isCancelled) {
      if (fs.existsSync(tmpDirPath)) {
        fs.rmSync(tmpDirPath, { recursive: true, force: true });
      }
      throw new Error('Schnitt wurde abgebrochen');
    }

    if (runResult.code !== 0) {
      if (fs.existsSync(tmpDirPath)) {
        fs.rmSync(tmpDirPath, { recursive: true, force: true });
      }
      // Ganze Zeilen statt der letzten 400 Zeichen, sonst beginnt die Meldung mitten im Wort
      const stderrTail = runResult.stderr
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !l.startsWith('Stream mapping') && !l.startsWith('Stream #'))
        .slice(-6)
        .join('\n');
      throw new Error(
        `ffmpeg-Fehler beim Schneiden (Code ${runResult.code}): ${stderrTail || 'Unbekannter Fehler'}`
      );
    }

    // Process output files in tmp directory
    const generatedRawFiles = fs
      .readdirSync(tmpDirPath)
      .filter((name) => name.startsWith('part_') && name.endsWith(targetExt))
      .sort();

    if (generatedRawFiles.length === 0) {
      if (fs.existsSync(tmpDirPath)) {
        fs.rmSync(tmpDirPath, { recursive: true, force: true });
      }
      throw new Error('ffmpeg hat keine Teildateien erzeugt.');
    }

    // Rename files in tmpDirPath according to user settings naming pattern
    const settings = loadSettings();
    const resultFiles: SplitResultFile[] = [];
    let sumDurations = 0;
    const isTrim = plan.parts.some((p) => p.keep === false);
    const expectedParts = plan.parts.filter((p) => p.keep !== false);

    for (let i = 0; i < generatedRawFiles.length; i++) {
      const rawName = generatedRawFiles[i];
      const rawPath = path.join(tmpDirPath, rawName);
      const partIndex = i + 1;

      const part = plan.parts[i];
      if (isTrim && part && part.keep === false) {
        // Trimmen: Teile außerhalb des Bereichs verwerfen
        fs.rmSync(rawPath, { force: true });
        continue;
      }
      const finalPartName = isTrim
        ? sanitizeFileName(
            `${cleanBaseName} (Ausschnitt ${formatHms(part?.start ?? 0)} bis ${formatHms(part?.end ?? 0)})`
          ) + targetExt
        : formatPartFileName(
            settings.namePattern,
            cleanBaseName,
            partIndex,
            generatedRawFiles.length,
            targetExt,
            part?.start ?? 0,
            part?.end ?? 0
          );

      const newPath = path.join(tmpDirPath, finalPartName);
      fs.renameSync(rawPath, newPath);

      const fileStat = fs.statSync(newPath);
      const partDuration = await getMediaDuration(newPath);
      sumDurations += partDuration;

      resultFiles.push({
        name: finalPartName,
        size: fileStat.size,
        duration: Math.round(partDuration * 100) / 100,
      });
    }

    // Move tmp directory to final directory name
    fs.renameSync(tmpDirPath, finalDirPath);

    // Post-cut verification:
    // Check file count
    if (resultFiles.length !== expectedParts.length) {
      warnings.push(
        `Anzahl erzeugter Dateien (${resultFiles.length}) weicht vom Plan (${expectedParts.length}) ab.`
      );
    }

    // Check sum of durations ≈ expected duration (tolerance: 1s + 1 GOP approx 3s)
    const expectedDuration = isTrim ? expectedParts.reduce((s, p) => s + p.duration, 0) : probe.duration;
    const tolerance = 1.0 + Math.max(1.0, probe.keyframeIntervalAvg);
    if (Math.abs(sumDurations - expectedDuration) > tolerance) {
      warnings.push(
        `Dauer-Abweichung: erwartet ${expectedDuration.toFixed(1)} s, Summe der Teile ${sumDurations.toFixed(1)} s.`
      );
    }

    const elapsedSeconds = Math.round(((Date.now() - startTime) / 1000) * 10) / 10;

    onProgress({ percent: 100, currentPart: totalParts, totalParts });

    return {
      outputDir: finalDirPath,
      hostOutputDir,
      files: resultFiles,
      warnings,
      durationSeconds: elapsedSeconds,
    };
  })();

  return { promise, cancel };
}
