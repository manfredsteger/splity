import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { CACHE_DIR, THUMBS_DIR } from '../config.js';
import type { ProbeResult, VideoStreamInfo } from '../types.js';

export function getFileCacheKey(filePath: string): string {
  const stat = fs.statSync(filePath);
  const baseName = path.basename(filePath);
  const data = `${baseName}_${stat.size}_${stat.mtimeMs}`;
  return crypto.createHash('sha1').update(data).digest('hex');
}

export async function probeVideo(filePath: string): Promise<ProbeResult> {
  const cacheKey = getFileCacheKey(filePath);
  const cacheFilePath = path.join(CACHE_DIR, `${cacheKey}.json`);

  if (fs.existsSync(cacheFilePath)) {
    try {
      const content = fs.readFileSync(cacheFilePath, 'utf-8');
      return JSON.parse(content) as ProbeResult;
    } catch {
      // ignore invalid cache and re-probe
    }
  }

  // 1. ffprobe format and streams metadata
  const metadata = await runFfprobeMetadata(filePath);
  const stat = fs.statSync(filePath);
  const baseName = path.basename(filePath);

  const duration = parseFloat(metadata.format?.duration || '0');
  const startTime = parseFloat(metadata.format?.start_time || '0');
  const container = metadata.format?.format_name || path.extname(filePath).replace('.', '');

  let videoStream: VideoStreamInfo | null = null;
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
      };
    } else if (stream.codec_type === 'audio') {
      audioTrackCount++;
    } else if (stream.codec_type === 'subtitle') {
      subtitleTrackCount++;
    } else if (stream.codec_type === 'data') {
      hasDataStreams = true;
    }
  }

  // 2. Extract keyframes without decoding
  const rawKeyframes = await runFfprobeKeyframes(filePath);

  // Subtract format.start_time from each keyframe and normalize
  const relativeKeyframesSet = new Set<number>();
  for (const kf of rawKeyframes) {
    const rel = kf - startTime;
    if (rel >= -0.01) {
      const rounded = Math.round(Math.max(0, rel) * 1000) / 1000;
      relativeKeyframesSet.add(rounded);
    }
  }

  let keyframes = Array.from(relativeKeyframesSet).sort((a, b) => a - b);
  // Ensure keyframe at 0 exists if first keyframe is within 0.1s
  if (keyframes.length === 0 || keyframes[0] > 0.1) {
    keyframes.unshift(0);
  }

  // Calculate average keyframe interval
  let keyframeIntervalAvg = 2.0;
  if (keyframes.length > 1) {
    let sumGaps = 0;
    for (let i = 1; i < keyframes.length; i++) {
      sumGaps += keyframes[i] - keyframes[i - 1];
    }
    keyframeIntervalAvg = Math.round((sumGaps / (keyframes.length - 1)) * 10) / 10;
  } else if (duration > 0) {
    keyframeIntervalAvg = duration;
  }

  const result: ProbeResult = {
    filename: baseName,
    filesize: stat.size,
    container,
    duration,
    startTime,
    video: videoStream,
    audioTrackCount,
    subtitleTrackCount,
    hasDataStreams,
    keyframes,
    keyframeIntervalAvg,
    analyzedAt: new Date().toISOString(),
  };

  try {
    fs.writeFileSync(cacheFilePath, JSON.stringify(result), 'utf-8');
  } catch {
    // ignore cache write error
  }

  return result;
}

interface FfprobeRawOutput {
  format?: {
    duration?: string;
    start_time?: string;
    format_name?: string;
    size?: string;
  };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    r_frame_rate?: string;
    duration?: string;
    bit_rate?: string;
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

function runFfprobeKeyframes(filePath: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    const args = [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'packet=pts_time,dts_time,flags',
      '-of',
      'csv=p=0',
      filePath,
    ];

    const child = spawn('ffprobe', args);
    const keyframes: number[] = [];
    let stderr = '';

    child.stderr.on('data', (d) => {
      stderr += d.toString();
    });

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      // Line format: "pts_time,dts_time,flags", e.g. "0.000000,0.000000,K__"
      // pts_time kann bei MKV "N/A" sein, dann dts_time nehmen.
      const parts = line.split(',');
      if (parts.length >= 3) {
        const ptsStr = parts[0].trim();
        const dtsStr = parts[1].trim();
        const flags = parts[2].trim();
        const timeStr = ptsStr && ptsStr !== 'N/A' ? ptsStr : dtsStr;

        if (timeStr && timeStr !== 'N/A' && flags.includes('K')) {
          const t = parseFloat(timeStr);
          if (!Number.isNaN(t)) {
            keyframes.push(t);
          }
        }
      }
    });

    child.on('error', (err) => {
      reject(new Error(`ffprobe-Keyframe-Extraktion fehlgeschlagen: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`ffprobe Keyframe-Fehler (Code ${code}): ${stderr}`));
      }
      resolve(keyframes);
    });
  });
}

export async function generateThumbnail(filePath: string, timeInSeconds: number): Promise<string> {
  const cacheKey = getFileCacheKey(filePath);
  const safeTime = Math.max(0, Math.round(timeInSeconds * 100) / 100);
  const thumbFileName = `${cacheKey}_t${safeTime.toFixed(2)}.jpg`;
  const thumbPath = path.join(THUMBS_DIR, thumbFileName);

  if (fs.existsSync(thumbPath)) {
    return thumbPath;
  }

  // Fast single-frame extraction:
  // ffmpeg -ss <t> -i <filePath> -frames:v 1 -vf scale=320:-2 -q:v 4 <thumbPath>
  return new Promise((resolve, reject) => {
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
}
