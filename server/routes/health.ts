import { Router } from 'express';
import {
  DATA_DIR,
  EINGANG_DIR,
  FERTIG_DIR,
  SPLITY_DIR,
  SPLITY_HOST_PATH,
  getCachedToolVersions,
  getFreeDiskBytes,
} from '../config.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res, next) => {
  try {
    const { ffmpeg, ffprobe } = getCachedToolVersions();
    const freeBytes = await getFreeDiskBytes(SPLITY_DIR);

    res.json({
      ok: true,
      version: '1.0.0',
      ffmpeg,
      ffprobe,
      freeBytes,
      paths: {
        splityDir: SPLITY_DIR,
        splityHostPath: SPLITY_HOST_PATH,
        dataDir: DATA_DIR,
        eingang: EINGANG_DIR,
        fertig: FERTIG_DIR,
      },
    });
  } catch (err) {
    next(err);
  }
});
