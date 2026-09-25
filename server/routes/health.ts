import { Router } from 'express';
import fs from 'node:fs';
import {
  DATA_DIR,
  EINGANG_DIR,
  FERTIG_DIR,
  LIBRARY_DIR,
  SPLITY_DIR,
  SPLITY_HOST_PATH,
  SPLITY_LIBRARY_HOST_PATH,
  getCachedToolVersions,
  getFreeDiskBytes,
} from '../config.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res, next) => {
  try {
    const { ffmpeg, ffprobe } = getCachedToolVersions();
    const freeBytes = await getFreeDiskBytes(SPLITY_DIR);

    const hasLib = Boolean(LIBRARY_DIR && fs.existsSync(LIBRARY_DIR));

    res.json({
      ok: true,
      version: '1.0.0',
      ffmpeg,
      ffprobe,
      freeBytes,
      paths: {
        splityDir: SPLITY_DIR,
        splityHostPath: SPLITY_HOST_PATH,
        libraryDir: hasLib ? LIBRARY_DIR : null,
        libraryHostPath: hasLib ? SPLITY_LIBRARY_HOST_PATH : null,
        dataDir: DATA_DIR,
        eingang: EINGANG_DIR,
        fertig: FERTIG_DIR,
      },
    });
  } catch (err) {
    next(err);
  }
});
