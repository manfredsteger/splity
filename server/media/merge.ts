import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { DATA_DIR, FERTIG_DIR, SPLITY_DIR, SPLITY_HOST_PATH, getFreeDiskBytes } from '../config.js';
import { findUniqueDirectoryName, getMediaDuration, getTargetExtension, sanitizeFileName } from './split.js';
import type { MergeCheckItem, MergeProblem, ProbeResult, ResolvedVideo, SplitResult } from '../types.js';

export interface MergeInput {
  resolved: ResolvedVideo;
  probe: ProbeResult;
  id: string;
}

/**
 * Vorprüfung (reine Funktion): Verlustfreies Zusammenfügen geht nur bei gleichen
 * Codec-Parametern. Verglichen wird gegen die erste Datei.
 */
export function checkMergeCompatibility(inputs: Array<{ name: string; probe: ProbeResult }>): MergeProblem[] {
  const problems: MergeProblem[] = [];
  if (inputs.length < 2) return problems;
  const ref = inputs[0];
  const refAudio = ref.probe.audio || [];

  const add = (file: string, field: string, value: unknown, expected: unknown) =>
    problems.push({ file, field, value: String(value ?? '–'), expected: String(expected ?? '–') });

  for (const item of inputs.slice(1)) {
    const v = item.probe.video;
    const rv = ref.probe.video;
    if (!!v !== !!rv) {
      add(item.name, 'Videospur', v ? 'vorhanden' : 'fehlt', rv ? 'vorhanden' : 'fehlt');
      continue;
    }
    if (v && rv) {
      if (v.codec !== rv.codec) add(item.name, 'Video-Codec', v.codec, rv.codec);
      if (v.width !== rv.width || v.height !== rv.height) add(item.name, 'Auflösung', `${v.width}×${v.height}`, `${rv.width}×${rv.height}`);
      if (v.pixFmt && rv.pixFmt && v.pixFmt !== rv.pixFmt) add(item.name, 'Pixelformat', v.pixFmt, rv.pixFmt);
      if (v.profile && rv.profile && v.profile !== rv.profile) add(item.name, 'Profil', v.profile, rv.profile);
      if (Math.abs(v.fps - rv.fps) > 0.01) add(item.name, 'Bildrate', `${v.fps} fps`, `${rv.fps} fps`);
    }
    const audio = item.probe.audio || [];
    if (audio.length !== refAudio.length) {
      add(item.name, 'Tonspuren', audio.length, refAudio.length);
      continue;
    }
    audio.forEach((a, i) => {
      const r = refAudio[i];
      if (a.codec !== r.codec) add(item.name, `Ton ${i + 1} Codec`, a.codec, r.codec);
      if (a.sampleRate !== r.sampleRate) add(item.name, `Ton ${i + 1} Abtastrate`, `${a.sampleRate} Hz`, `${r.sampleRate} Hz`);
      if (a.channels !== r.channels) add(item.name, `Ton ${i + 1} Kanäle`, a.channels, r.channels);
    });
  }
  return problems;
}

export function describeItem(id: string, resolved: ResolvedVideo, probe: ProbeResult): MergeCheckItem {
  const audio = probe.audio || [];
  return {
    id,
    name: resolved.displayName,
    size: probe.filesize,
    duration: probe.duration,
    container: probe.container,
    videoCodec: probe.video?.codec || '–',
    resolution: probe.video ? `${probe.video.width}×${probe.video.height}` : '–',
    audioSummary: audio.length ? audio.map((a) => `${a.codec} ${a.channels}ch`).join(', ') : 'kein Ton',
  };
}

/** Name der Ausgabe: Ordnername der Teile bzw. erste Datei ohne " - Teil …" */
export function deriveMergeName(firstName: string): string {
  const base = firstName.replace(/\.[^.]+$/, '');
  return (
    base
      .replace(/\s*-\s*Teil\s+\d+\s+von\s+\d+.*$/i, '')
      .replace(/\s*\(\d+\)\s*$/, '')
      .trim() || 'video'
  );
}

/** concat-Listendatei: Apostrophe im Pfad als '\'' schreiben */
export function formatConcatList(paths: string[]): string {
  return paths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n') + '\n';
}

export interface MergeHandle {
  promise: Promise<SplitResult>;
  cancel: () => void;
}

export function executeMerge(
  inputs: MergeInput[],
  outputName: string | undefined,
  onProgress: (percent: number) => void
): MergeHandle {
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
    if (inputs.length < 2) throw new Error('Zum Zusammenfügen sind mindestens zwei Videos nötig.');

    const problems = checkMergeCompatibility(inputs.map((i) => ({ name: i.resolved.displayName, probe: i.probe })));
    if (problems.length > 0) {
      const first = problems[0];
      throw new Error(
        `Verlustfreies Zusammenfügen geht nur bei gleichen Codec-Parametern: ${first.file} – ${first.field} ${first.value} statt ${first.expected}${problems.length > 1 ? ` (+${problems.length - 1} weitere)` : ''}.`
      );
    }

    const totalDuration = inputs.reduce((s, i) => s + i.probe.duration, 0);
    const totalSize = inputs.reduce((s, i) => s + i.probe.filesize, 0);
    const freeBytes = await getFreeDiskBytes(SPLITY_DIR);
    if (freeBytes < 50 * 1024 ** 4 && freeBytes < totalSize * 1.05) {
      throw new Error(`Nicht genug Speicherplatz (frei: ${(freeBytes / 1024 ** 3).toFixed(1)} GB, benötigt: ${((totalSize * 1.05) / 1024 ** 3).toFixed(1)} GB)`);
    }

    const first = inputs[0];
    const targetExt = getTargetExtension(path.extname(first.resolved.absPath));
    const baseName = sanitizeFileName(outputName?.trim() || deriveMergeName(first.resolved.displayName)) || 'video';
    const finalDirName = findUniqueDirectoryName(FERTIG_DIR, `${baseName} (zusammengefügt)`);
    const finalDir = path.join(FERTIG_DIR, finalDirName);
    tmpDir = path.join(FERTIG_DIR, `.${finalDirName}.tmp`);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.mkdirSync(tmpDir, { recursive: true });

    const listDir = path.join(DATA_DIR, 'tmp');
    fs.mkdirSync(listDir, { recursive: true });
    const listPath = path.join(listDir, `merge_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`);
    fs.writeFileSync(listPath, formatConcatList(inputs.map((i) => i.resolved.absPath)), 'utf-8');

    const outName = `${baseName} (zusammengefügt)${targetExt}`;
    const outPath = path.join(tmpDir, outName);
    const isHevc = (first.probe.video?.codec || '').toLowerCase().includes('hevc');
    const hasData = inputs.some((i) => i.probe.hasDataStreams);

    const buildArgs = (withData: boolean) => {
      // -auto_convert 0 ist Pflicht: Sonst schleust der concat-Demuxer SPS/PPS (h264_mp4toannexb
      // hin und zurück) in das erste Paket jeder Datei ein – semantisch harmlos, aber nicht mehr
      // bit-identisch zum Original (getestet: 12 von 3932 Paketen anders, mit der Option 0).
      const args = ['-hide_banner', '-nostdin', '-y', '-progress', 'pipe:1', '-nostats', '-f', 'concat', '-safe', '0', '-auto_convert', '0', '-i', listPath];
      if (withData) args.push('-map', '0', '-ignore_unknown');
      else args.push('-map', '0:v', '-map', '0:a?', '-map', '0:s?', '-dn');
      args.push('-map_metadata', '0', '-c', 'copy', '-avoid_negative_ts', 'make_zero');
      if (targetExt === '.mp4' || targetExt === '.mov') args.push('-movflags', '+faststart', '-strict', 'experimental');
      if (isHevc) args.push('-tag:v', 'hvc1');
      args.push(outPath);
      return args;
    };

    const run = (args: string[]) =>
      new Promise<{ code: number; stderr: string[] }>((resolve, reject) => {
        if (cancelled) return reject(new Error('Zusammenfügen abgebrochen'));
        child = spawn('ffmpeg', args);
        const stderr: string[] = [];
        readline.createInterface({ input: child.stderr!, crlfDelay: Infinity }).on('line', (l) => {
          stderr.push(l.trim());
          if (stderr.length > 30) stderr.shift();
        });
        readline.createInterface({ input: child.stdout!, crlfDelay: Infinity }).on('line', (l) => {
          if (l.startsWith('out_time_us=') && totalDuration > 0) {
            const us = parseInt(l.slice(12), 10);
            if (!Number.isNaN(us)) onProgress(Math.min(99, Math.max(0, Math.round((us / 1e6 / totalDuration) * 100))));
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
      if (res.code !== 0 && !cancelled && hasData) {
        fs.rmSync(outPath, { force: true });
        res = await run(buildArgs(false));
        if (res.code === 0) warnings.push('Datenspuren (z. B. Timecode) wurden weggelassen, Bild und Ton sind vollständig.');
      }
      if (cancelled) throw new Error('Zusammenfügen abgebrochen');
      if (res.code !== 0) {
        throw new Error(`ffmpeg-Fehler beim Zusammenfügen (Code ${res.code}): ${res.stderr.filter(Boolean).slice(-5).join('\n')}`);
      }

      fs.renameSync(tmpDir, finalDir);
      tmpDir = '';
      const outFinal = path.join(finalDir, outName);
      const duration = await getMediaDuration(outFinal);
      const tolerance = 1 + inputs.length * 0.1;
      if (Math.abs(duration - totalDuration) > tolerance) {
        warnings.push(`Dauer-Abweichung: Summe der Eingaben ${totalDuration.toFixed(1)} s, Ausgabe ${duration.toFixed(1)} s.`);
      }
      return {
        outputDir: finalDir,
        hostOutputDir: path.join(SPLITY_HOST_PATH, 'Fertig', finalDirName),
        files: [{ name: outName, size: fs.statSync(outFinal).size, duration: Math.round(duration * 100) / 100 }],
        warnings,
        durationSeconds: Math.round(((Date.now() - started) / 1000) * 10) / 10,
      };
    } finally {
      fs.rmSync(listPath, { force: true });
      if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })();

  return { promise, cancel };
}
