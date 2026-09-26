import { spawn, type ChildProcess } from 'node:child_process';
import readline from 'node:readline';
import type { StreamVerification, VerificationResult } from '../types.js';

export interface VerifyOptions {
  onProgress?: (packetsProcessed: number, estimatedTotalPackets?: number) => void;
  isCancelled?: () => boolean;
  /** 'subsequence': Ausgabe muss ein zusammenhängender Ausschnitt des Originals sein (Trimmen) */
  mode?: 'exact' | 'subsequence';
}

interface StreamPacketsCollector {
  kinds: Map<number, 'video' | 'audio'>;
  streams: Map<number, string[]>;
}

function extractFramemd5(
  filePath: string,
  collector: StreamPacketsCollector,
  onPacket?: () => void,
  isCancelled?: () => boolean
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (isCancelled && isCancelled()) {
      return reject(new Error('Verifizierung abgebrochen'));
    }

    const args = [
      '-v',
      'error',
      '-i',
      filePath,
      '-map',
      '0:v',
      '-map',
      '0:a?',
      '-c',
      'copy',
      '-f',
      'framemd5',
      '-',
    ];

    const child: ChildProcess = spawn('ffmpeg', args);
    let stderr = '';

    child.stderr?.on('data', (d) => {
      stderr += d.toString();
    });

    if (!child.stdout) {
      return reject(new Error('Kein stdout-Stream für ffmpeg verfügbar.'));
    }

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    let killed = false;
    rl.on('line', (line) => {
      // Beim Abbruch den ffmpeg-Prozess beenden, sonst liest er die Datei still zu Ende
      if (!killed && isCancelled && isCancelled()) {
        killed = true;
        child.kill('SIGTERM');
        return;
      }
      const trimmed = line.trim();
      if (!trimmed) return;

      // Parse metadata comments: e.g. #media_type 0: video
      if (trimmed.startsWith('#')) {
        const mediaTypeMatch = trimmed.match(/^#media_type\s+(\d+):\s*(video|audio)/i);
        if (mediaTypeMatch) {
          const idx = parseInt(mediaTypeMatch[1], 10);
          const kind = mediaTypeMatch[2].toLowerCase() as 'video' | 'audio';
          collector.kinds.set(idx, kind);
        }
        return;
      }

      // Packet line: stream_index, dts, pts, duration, size, hash
      const parts = trimmed.split(',');
      if (parts.length >= 6) {
        const streamIdx = parseInt(parts[0].trim(), 10);
        const size = parts[4].trim();
        const hash = parts[5].trim();

        if (!Number.isNaN(streamIdx) && hash) {
          let list = collector.streams.get(streamIdx);
          if (!list) {
            list = [];
            collector.streams.set(streamIdx, list);
          }
          // Compact packet representation: size + hash
          list.push(`${size}:${hash}`);

          if (!collector.kinds.has(streamIdx)) {
            collector.kinds.set(streamIdx, streamIdx === 0 ? 'video' : 'audio');
          }

          if (onPacket) {
            onPacket();
          }
        }
      }
    });

    child.on('error', (err) => {
      reject(new Error(`Fehler beim Starten von ffmpeg framemd5: ${err.message}`));
    });

    child.on('close', (code) => {
      if (isCancelled && isCancelled()) {
        return reject(new Error('Verifizierung abgebrochen'));
      }
      if (code !== 0) {
        return reject(
          new Error(`ffmpeg framemd5 fehlgeschlagen (Code ${code}): ${stderr || 'Unbekannter Fehler'}`)
        );
      }
      resolve();
    });
  });
}

/**
 * Verifies that the sequence of packets across `outputs` matches `inputs` stream by stream.
 * Pure packet-level bit-identity verification without decoding video or audio.
 */
export async function verifySequence(
  inputs: string[],
  outputs: string[],
  options?: VerifyOptions
): Promise<VerificationResult> {
  const startTime = Date.now();

  const inputCollector: StreamPacketsCollector = {
    kinds: new Map(),
    streams: new Map(),
  };

  const outputCollector: StreamPacketsCollector = {
    kinds: new Map(),
    streams: new Map(),
  };

  let totalPacketsProcessed = 0;

  // 1. Process inputs in order
  for (const inputPath of inputs) {
    if (options?.isCancelled && options.isCancelled()) {
      throw new Error('Verifizierung abgebrochen');
    }
    await extractFramemd5(
      inputPath,
      inputCollector,
      () => {
        totalPacketsProcessed++;
        if (options?.onProgress) {
          options.onProgress(totalPacketsProcessed);
        }
      },
      options?.isCancelled
    );
  }

  const estimatedTotal = totalPacketsProcessed * 2;

  // 2. Process outputs in order
  for (const outputPath of outputs) {
    if (options?.isCancelled && options.isCancelled()) {
      throw new Error('Verifizierung abgebrochen');
    }
    await extractFramemd5(
      outputPath,
      outputCollector,
      () => {
        totalPacketsProcessed++;
        if (options?.onProgress) {
          options.onProgress(totalPacketsProcessed, estimatedTotal);
        }
      },
      options?.isCancelled
    );
  }

  // 3. Compare stream by stream
  const allStreamIndices = Array.from(
    new Set([...inputCollector.streams.keys(), ...outputCollector.streams.keys()])
  ).sort((a, b) => a - b);

  const streams: StreamVerification[] = [];
  let overallOk = true;
  let firstErrorMessage: string | undefined;

  for (const streamIdx of allStreamIndices) {
    const kind =
      inputCollector.kinds.get(streamIdx) ||
      outputCollector.kinds.get(streamIdx) ||
      (streamIdx === 0 ? 'video' : 'audio');

    const inPackets = inputCollector.streams.get(streamIdx) || [];
    const outPackets = outputCollector.streams.get(streamIdx) || [];

    let mismatchAt: number | undefined;

    if (options?.mode === 'subsequence') {
      // Ausschnitt: die Ausgabe muss irgendwo im Original als zusammenhängende Folge vorkommen
      let found = outPackets.length === 0;
      for (let start = 0; !found && start + outPackets.length <= inPackets.length; start++) {
        if (inPackets[start] !== outPackets[0]) continue;
        let ok = true;
        for (let j = 1; j < outPackets.length; j++) {
          if (inPackets[start + j] !== outPackets[j]) {
            ok = false;
            break;
          }
        }
        found = ok;
      }
      if (!found) mismatchAt = 1;
    } else {
      const minLen = Math.min(inPackets.length, outPackets.length);
      for (let i = 0; i < minLen; i++) {
        if (inPackets[i] !== outPackets[i]) {
          mismatchAt = i + 1; // 1-indexed packet position
          break;
        }
      }

      if (mismatchAt === undefined && inPackets.length !== outPackets.length) {
        mismatchAt = minLen + 1;
      }
    }

    if (mismatchAt !== undefined) {
      overallOk = false;
      if (!firstErrorMessage) {
        firstErrorMessage =
          options?.mode === 'subsequence'
            ? `${kind === 'video' ? 'Videospur' : 'Audiospur'} ${streamIdx}: Der Ausschnitt (${outPackets.length} Pakete) ist keine zusammenhängende Folge des Originals (${inPackets.length} Pakete).`
            : `${kind === 'video' ? 'Videospur' : 'Audiospur'} ${streamIdx} weicht ab Paket ${mismatchAt} ab (Original: ${inPackets.length} Pakete, Teile: ${outPackets.length} Pakete).`;
      }
    }

    streams.push({
      kind,
      index: streamIdx,
      packetsOriginal: inPackets.length,
      packetsParts: outPackets.length,
      firstMismatchAt: mismatchAt,
    });
  }

  const durationMs = Date.now() - startTime;

  return {
    ok: overallOk,
    streams,
    durationMs,
    errorMessage: firstErrorMessage,
  };
}

/**
 * Convenience wrapper to verify that parts[] match original bit-for-bit per stream.
 */
export async function verifyParts(
  originalPath: string,
  partPaths: string[],
  options?: VerifyOptions
): Promise<VerificationResult> {
  return verifySequence([originalPath], partPaths, options);
}
