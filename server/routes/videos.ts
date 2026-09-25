import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import busboy from 'busboy';
import { ALLOWED_EXTENSIONS, EINGANG_DIR } from '../config.js';
import { jobQueue } from '../jobs.js';
import { planSplit } from '../media/plan.js';
import {
  generateThumbnail,
  getAnalysisEmitter,
  getAnalysisProgress,
  getCachedProbe,
  isAnalyzingVideo,
  probeVideo,
  startVideoAnalysis,
} from '../media/probe.js';
import { sanitizeFileName } from '../media/split.js';
import { getCachedScenes, SENSITIVITY_THRESHOLDS } from '../media/scenes.js';
import { encodeVideoId, listVideos, resolveVideo } from '../sources.js';
import type { SceneParams, SplitMode } from '../types.js';

export const videosRouter = Router();

function parseSplitMode(raw: unknown): SplitMode | null {
  if (!raw || typeof raw !== 'object') return null;
  const mode = raw as Record<string, unknown>;
  if (mode.type === 'count') {
    const n = Number(mode.n);
    if (!Number.isInteger(n) || n < 2 || n > 200) return null;
    return { type: 'count', n };
  }
  if (mode.type === 'every') {
    const seconds = Number(mode.seconds);
    if (!Number.isFinite(seconds) || seconds < 10) return null;
    return { type: 'every', seconds };
  }
  if (mode.type === 'points') {
    if (!Array.isArray(mode.times)) return null;
    const times = mode.times.map(Number);
    if (times.some((t) => !Number.isFinite(t) || t < 0)) return null;
    const result: SplitMode = { type: 'points', times };
    if (mode.minPartSeconds !== undefined) {
      const minLen = Number(mode.minPartSeconds);
      if (!Number.isFinite(minLen) || minLen < 0 || minLen > 3600) return null;
      result.minPartSeconds = minLen;
    }
    if (mode.origin === 'scenes' || mode.origin === 'manual') {
      result.origin = mode.origin;
    }
    return result;
  }
  return null;
}

function findUniqueUploadFileName(baseName: string): string {
  const ext = path.extname(baseName);
  const nameWithoutExt = path.basename(baseName, ext);

  let candidate = baseName;
  let counter = 2;
  while (fs.existsSync(path.join(EINGANG_DIR, candidate))) {
    candidate = `${nameWithoutExt} (${counter})${ext}`;
    counter++;
  }
  return candidate;
}

// GET /api/videos - List all videos via sources
videosRouter.get('/', async (req, res, next) => {
  try {
    const videos = listVideos('inbox');

    const list = videos.map((v) => {
      const probeData = getCachedProbe(v);

      return {
        id: v.id,
        name: v.displayName,
        source: v.source,
        relPath: v.relPath,
        size: v.size,
        mtime: v.mtime,
        deletable: v.deletable,
        isAnalyzed: Boolean(probeData),
        duration: probeData?.duration,
        container: probeData?.container,
        resolution: probeData?.video ? `${probeData.video.width}x${probeData.video.height}` : undefined,
        codec: probeData?.video?.codec,
        fps: probeData?.video?.fps,
        keyframeIntervalAvg: probeData?.keyframeIntervalAvg,
        keyframeIntervalMax: probeData?.keyframeIntervalMax,
      };
    });

    res.json(list);
  } catch (err) {
    next(err);
  }
});

// POST /api/videos/upload - Streaming upload directly to Eingang/
videosRouter.post('/upload', (req, res, next) => {
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    return res.status(400).json({ error: 'Ungültiger Content-Type. Erwartet wird multipart/form-data.' });
  }

  let bb: busboy.Busboy;
  try {
    bb = busboy({ headers: req.headers, defParamCharset: 'utf8' });
  } catch (err: any) {
    return res.status(400).json({ error: `Fehler beim Initialisieren des Uploads: ${err.message}` });
  }

  let uploadedFileResult: { id: string; name: string; size: number } | null = null;
  let currentPartPath: string | null = null;
  let currentTargetPath: string | null = null;
  let fileError: string | null = null;
  let bytesWritten = 0;
  let writeDone: Promise<void> = Promise.resolve();

  bb.on('file', (fieldname, file, info) => {
    let rawFilename = info.filename || 'video.mp4';
    try {
      const latin1Decoded = Buffer.from(rawFilename, 'latin1').toString('utf8');
      if (!latin1Decoded.includes('') && latin1Decoded !== rawFilename) {
        rawFilename = latin1Decoded;
      }
    } catch {
      // ignore
    }

    const safeName = sanitizeFileName(rawFilename) || 'video.mp4';
    const ext = path.extname(safeName).toLowerCase();

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      fileError = `Dateiformat "${ext}" wird nicht unterstützt. Erlaubt sind: mp4, mov, m4v, mkv, webm, avi, ts, mts, m2ts.`;
      file.resume();
      return;
    }

    const uniqueName = findUniqueUploadFileName(safeName);
    currentTargetPath = path.join(EINGANG_DIR, uniqueName);
    currentPartPath = path.join(EINGANG_DIR, `.${uniqueName}.part`);

    const writeStream = fs.createWriteStream(currentPartPath);
    writeDone = new Promise<void>((resolve) => {
      writeStream.on('finish', () => resolve());
      writeStream.on('error', () => resolve());
    });

    file.on('data', (data) => {
      bytesWritten += data.length;
    });

    file.pipe(writeStream);

    writeStream.on('error', (err) => {
      fileError = `Schreibfehler beim Speichern: ${err.message}`;
      if (currentPartPath && fs.existsSync(currentPartPath)) {
        try {
          fs.rmSync(currentPartPath, { force: true });
        } catch {
          // ignore
        }
      }
    });

    writeStream.on('finish', () => {
      if (!fileError && currentPartPath && currentTargetPath) {
        try {
          fs.renameSync(currentPartPath, currentTargetPath);
          uploadedFileResult = {
            id: encodeVideoId('inbox', uniqueName),
            name: uniqueName,
            size: bytesWritten,
          };
          currentPartPath = null;
        } catch (renameErr: any) {
          fileError = `Fehler beim Fertigstellen der Datei: ${renameErr.message}`;
        }
      }
    });
  });

  // Handle client abort / connection close
  req.on('aborted', () => {
    if (currentPartPath && fs.existsSync(currentPartPath)) {
      try {
        fs.rmSync(currentPartPath, { force: true });
      } catch {
        // ignore
      }
    }
  });

  bb.on('error', (err: any) => {
    if (currentPartPath && fs.existsSync(currentPartPath)) {
      try {
        fs.rmSync(currentPartPath, { force: true });
      } catch {
        // ignore
      }
    }
    return res.status(500).json({ error: `Upload abgebrochen: ${err.message}` });
  });

  bb.on('close', async () => {
    await writeDone;
    if (fileError) {
      if (currentPartPath && fs.existsSync(currentPartPath)) {
        try {
          fs.rmSync(currentPartPath, { force: true });
        } catch {
          // ignore
        }
      }
      return res.status(415).json({ error: fileError });
    }

    if (!uploadedFileResult) {
      return res.status(400).json({ error: 'Keine Datei empfangen.' });
    }

    return res.json({ ok: true, video: uploadedFileResult });
  });

  req.pipe(bb);
});

// GET /api/videos/:id - Probe metadata and keyframes (202 if analyzing)
videosRouter.get('/:id', async (req, res, next) => {
  try {
    const resolved = resolveVideo(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    const cached = getCachedProbe(resolved);
    if (cached) {
      return res.json(cached);
    }

    if (isAnalyzingVideo(req.params.id)) {
      return res.status(202).json({
        analyzing: true,
        percent: getAnalysisProgress(req.params.id),
      });
    }

    // Start analysis in background and return 202
    startVideoAnalysis(resolved, req.params.id).catch((err) => {
      console.error('Analysefehler:', err);
    });

    res.status(202).json({ analyzing: true, percent: 0 });
  } catch (err: any) {
    next(err);
  }
});

// GET /api/videos/:id/events - SSE Stream for analysis progress
videosRouter.get('/:id/events', async (req, res, next) => {
  try {
    const resolved = resolveVideo(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const sendEvent = (data: any) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const cached = getCachedProbe(resolved);
    if (cached) {
      sendEvent({ type: 'done' });
      return res.end();
    }

    // Ensure analysis is initiated
    startVideoAnalysis(resolved, req.params.id).catch(() => {});

    const emitter = getAnalysisEmitter(req.params.id);
    if (!emitter) {
      sendEvent({ type: 'done' });
      return res.end();
    }

    // Send initial progress if any
    sendEvent({ type: 'progress', percent: getAnalysisProgress(req.params.id) });

    const onProgress = (percent: number) => {
      sendEvent({ type: 'progress', percent });
    };

    const onDone = () => {
      sendEvent({ type: 'done' });
      setTimeout(() => {
        try {
          res.end();
        } catch {
          // ignore
        }
      }, 200);
    };

    const onError = (err: any) => {
      sendEvent({ type: 'error', error: err.message || 'Analysefehler' });
      setTimeout(() => {
        try {
          res.end();
        } catch {
          // ignore
        }
      }, 200);
    };

    emitter.on('progress', onProgress);
    emitter.once('done', onDone);
    emitter.once('error', onError);

    // Keep-alive heartbeat
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        // ignore
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(ping);
      emitter.off('progress', onProgress);
      emitter.off('done', onDone);
      emitter.off('error', onError);
    });
  } catch (err: any) {
    next(err);
  }
});

// GET /api/videos/:id/thumb - Thumbnail image at time t (sequentially queued)
videosRouter.get('/:id/thumb', async (req, res, next) => {
  try {
    const resolved = resolveVideo(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    const t = req.query.t ? parseFloat(req.query.t as string) : 0;
    const thumbPath = await generateThumbnail(resolved.absPath, Number.isNaN(t) ? 0 : t);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err: any) {
    next(err);
  }
});

// Szenen-Parameter prüfen: threshold als Zahl (3–40) oder Stufe low/mid/high, black als Boolean
function parseSceneParams(raw: unknown): SceneParams | null {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  let threshold: number;
  if (typeof obj.threshold === 'string' && obj.threshold in SENSITIVITY_THRESHOLDS) {
    threshold = SENSITIVITY_THRESHOLDS[obj.threshold as keyof typeof SENSITIVITY_THRESHOLDS];
  } else if (obj.threshold === undefined) {
    threshold = SENSITIVITY_THRESHOLDS.mid;
  } else {
    threshold = Number(obj.threshold);
    if (!Number.isFinite(threshold) || threshold < 3 || threshold > 40) return null;
  }
  const black = obj.black === true || obj.black === 'true' || obj.black === '1';
  return { threshold, black };
}

// GET /api/videos/:id/scenes?threshold=&black= - Ergebnis aus dem Cache oder 404
videosRouter.get('/:id/scenes', (req, res, next) => {
  try {
    const resolved = resolveVideo(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }
    const params = parseSceneParams(req.query);
    if (!params) {
      return res.status(400).json({ error: 'Ungültige Szenen-Parameter.' });
    }
    const cached = getCachedScenes(resolved, params);
    if (!cached) {
      return res.status(404).json({ error: 'Noch keine Szenenerkennung für diese Einstellung.' });
    }
    res.json(cached);
  } catch (err: any) {
    next(err);
  }
});

// POST /api/videos/:id/scenes { threshold, black } - Szenenerkennung als Job starten
videosRouter.post('/:id/scenes', (req, res, next) => {
  try {
    const resolved = resolveVideo(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }
    const params = parseSceneParams(req.body);
    if (!params) {
      return res.status(400).json({ error: 'Ungültige Szenen-Parameter.' });
    }
    const cached = getCachedScenes(resolved, params);
    if (cached) {
      return res.json({ ok: true, cached: true, scenes: cached });
    }
    const job = jobQueue.addSceneJob(req.params.id, resolved.displayName, params);
    res.json({ ok: true, cached: false, jobId: job.id, job });
  } catch (err: any) {
    next(err);
  }
});

// POST /api/videos/:id/plan - Calculate split plan without cutting
videosRouter.post('/:id/plan', async (req, res, next) => {
  try {
    const resolved = resolveVideo(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    const mode = parseSplitMode(req.body.mode);
    if (!mode) {
      return res.status(400).json({ error: 'Ungültiger Schnittmodus übergeben.' });
    }

    const probe = await probeVideo(resolved, req.params.id);
    const plan = planSplit(probe.duration, probe.keyframes, mode);

    res.json(plan);
  } catch (err: any) {
    next(err);
  }
});

// POST /api/videos/:id/split - Enqueue split job
videosRouter.post('/:id/split', async (req, res, next) => {
  try {
    const resolved = resolveVideo(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    const mode = parseSplitMode(req.body.mode);
    if (!mode) {
      return res.status(400).json({ error: 'Ungültiger Schnittmodus übergeben.' });
    }

    const job = jobQueue.addJob(req.params.id, resolved.displayName, mode);
    res.json({ ok: true, jobId: job.id, job });
  } catch (err: any) {
    next(err);
  }
});

// DELETE /api/videos/:id?confirm=1 - Delete source video
videosRouter.delete('/:id', (req, res, next) => {
  try {
    if (req.query.confirm !== '1') {
      return res.status(400).json({ error: 'Löschen erfordert Bestätigung (?confirm=1).' });
    }

    const resolved = resolveVideo(req.params.id);
    if (!resolved) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }
    if (!resolved.deletable) {
      return res.status(403).json({ error: 'Diese Videoquelle ist schreibgeschützt und kann nicht gelöscht werden.' });
    }
    if (jobQueue.isVideoBusy(req.params.id)) {
      return res.status(409).json({ error: 'Das Video wird gerade geschnitten und kann nicht gelöscht werden.' });
    }

    fs.rmSync(resolved.absPath, { force: true });
    res.json({ ok: true, message: 'Video erfolgreich gelöscht.' });
  } catch (err: any) {
    next(err);
  }
});
