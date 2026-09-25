import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import busboy from 'busboy';
import { ALLOWED_EXTENSIONS, CACHE_DIR, EINGANG_DIR } from '../config.js';
import { jobQueue } from '../jobs.js';
import { planSplit } from '../media/plan.js';
import { generateThumbnail, getFileCacheKey, probeVideo } from '../media/probe.js';
import { sanitizeFileName } from '../media/split.js';
import type { ProbeResult, SplitMode } from '../types.js';

export const videosRouter = Router();

function getSafeVideoPath(id: string): { baseName: string; fullPath: string } {
  const baseName = path.basename(id);
  const fullPath = path.join(EINGANG_DIR, baseName);
  return { baseName, fullPath };
}

// Schnittmodus aus dem Request-Body strikt prüfen: Ohne Prüfung wird z. B. n="abc" still zu
// einem einzigen Teil, statt mit 400 zu antworten.
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
    return { type: 'points', times };
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

// GET /api/videos - List all videos in Eingang/
videosRouter.get('/', async (req, res, next) => {
  try {
    const files = fs.readdirSync(EINGANG_DIR, { withFileTypes: true });
    const videoFiles = files.filter((f) => {
      if (!f.isFile()) return false;
      if (f.name.startsWith('.')) return false;
      const ext = path.extname(f.name).toLowerCase();
      return ALLOWED_EXTENSIONS.has(ext);
    });

    const list = videoFiles.map((f) => {
      const fullPath = path.join(EINGANG_DIR, f.name);
      const stat = fs.statSync(fullPath);

      // Check if probe cache already exists
      let probeData: Partial<ProbeResult> | null = null;
      try {
        const cacheKey = getFileCacheKey(fullPath);
        const cachePath = path.join(CACHE_DIR, `${cacheKey}.json`);
        if (fs.existsSync(cachePath)) {
          const cached = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
          probeData = cached;
        }
      } catch {
        // probe cache not available yet
      }

      return {
        id: f.name,
        name: f.name,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        isAnalyzed: Boolean(probeData),
        duration: probeData?.duration,
        container: probeData?.container,
        resolution: probeData?.video ? `${probeData.video.width}x${probeData.video.height}` : undefined,
        codec: probeData?.video?.codec,
        fps: probeData?.video?.fps,
      };
    });

    // Sort by mtime descending (newest first)
    list.sort((a, b) => new Date(b.mtime).getTime() - new Date(a.mtime).getTime());

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
  // Busboy meldet 'close', bevor der Schreib-Stream fertig ist. Ohne Warten antwortet der
  // Server "Keine Datei empfangen", obwohl die Datei gleich darauf korrekt auf der Platte liegt.
  let writeDone: Promise<void> = Promise.resolve();

  bb.on('file', (fieldname, file, info) => {
    let rawFilename = info.filename || 'video.mp4';
    // Fix potential double UTF-8 decoding if needed
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
            id: uniqueName,
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

// GET /api/videos/:id - Probe metadata and keyframes
videosRouter.get('/:id', async (req, res, next) => {
  try {
    const { fullPath } = getSafeVideoPath(req.params.id);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Video nicht im Eingangsordner gefunden.' });
    }

    const probe = await probeVideo(fullPath);
    res.json(probe);
  } catch (err: any) {
    next(err);
  }
});

// GET /api/videos/:id/thumb - Thumbnail image at time t
videosRouter.get('/:id/thumb', async (req, res, next) => {
  try {
    const { fullPath } = getSafeVideoPath(req.params.id);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    const t = req.query.t ? parseFloat(req.query.t as string) : 0;
    const thumbPath = await generateThumbnail(fullPath, Number.isNaN(t) ? 0 : t);

    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    fs.createReadStream(thumbPath).pipe(res);
  } catch (err: any) {
    next(err);
  }
});

// POST /api/videos/:id/plan - Calculate split plan without cutting
videosRouter.post('/:id/plan', async (req, res, next) => {
  try {
    const { fullPath } = getSafeVideoPath(req.params.id);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    const mode = parseSplitMode(req.body.mode);
    if (!mode) {
      return res.status(400).json({ error: 'Ungültiger Schnittmodus übergeben.' });
    }

    const probe = await probeVideo(fullPath);
    const plan = planSplit(probe.duration, probe.keyframes, mode);

    res.json(plan);
  } catch (err: any) {
    next(err);
  }
});

// POST /api/videos/:id/split - Enqueue split job
videosRouter.post('/:id/split', async (req, res, next) => {
  try {
    const { baseName, fullPath } = getSafeVideoPath(req.params.id);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }

    const mode = parseSplitMode(req.body.mode);
    if (!mode) {
      return res.status(400).json({ error: 'Ungültiger Schnittmodus übergeben.' });
    }

    const job = jobQueue.addJob(baseName, baseName, mode);
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

    const { baseName, fullPath } = getSafeVideoPath(req.params.id);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Video nicht gefunden.' });
    }
    if (jobQueue.isVideoBusy(baseName)) {
      return res.status(409).json({ error: 'Das Video wird gerade geschnitten und kann nicht gelöscht werden.' });
    }

    fs.rmSync(fullPath, { force: true });
    res.json({ ok: true, message: 'Video erfolgreich gelöscht.' });
  } catch (err: any) {
    next(err);
  }
});
