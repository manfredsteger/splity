import { Router } from 'express';
import { jobQueue } from '../jobs.js';
import { checkMergeCompatibility, deriveMergeName, describeItem } from '../media/merge.js';
import { probeVideo } from '../media/probe.js';
import { getTargetExtension } from '../media/split.js';
import { listOutputFolders, resolveVideo } from '../sources.js';
import type { MergeCheckResult } from '../types.js';
import path from 'node:path';

export const mergeRouter = Router();

function parseIds(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 200) return null;
  if (raw.some((x) => typeof x !== 'string' || !x)) return null;
  return raw as string[];
}

// GET /api/merge/outputs - Fertig-Ordner mit ihren Teilen
mergeRouter.get('/outputs', (req, res, next) => {
  try {
    res.json(listOutputFolders());
  } catch (err) {
    next(err);
  }
});

// POST /api/merge/check { ids } - Vorprüfung (analysiert bei Bedarf, wartet darauf)
mergeRouter.post('/check', async (req, res, next) => {
  try {
    const ids = parseIds(req.body?.ids);
    if (!ids) return res.status(400).json({ error: 'Liste der Video-IDs fehlt oder ist ungültig.' });

    const inputs = [];
    for (const id of ids) {
      const resolved = resolveVideo(id);
      if (!resolved) return res.status(404).json({ error: `Video nicht gefunden: ${id}` });
      const probe = await probeVideo(resolved, id);
      inputs.push({ id, resolved, probe });
    }

    const problems = checkMergeCompatibility(inputs.map((i) => ({ name: i.resolved.displayName, probe: i.probe })));
    const result: MergeCheckResult = {
      ok: problems.length === 0 && inputs.length >= 2,
      problems,
      items: inputs.map((i) => describeItem(i.id, i.resolved, i.probe)),
      totalDuration: inputs.reduce((s, i) => s + i.probe.duration, 0),
      totalSize: inputs.reduce((s, i) => s + i.probe.filesize, 0),
      outputExt: getTargetExtension(path.extname(inputs[0].resolved.absPath)),
    };
    res.json({ ...result, suggestedName: deriveMergeName(inputs[0].resolved.displayName) });
  } catch (err) {
    next(err);
  }
});

// POST /api/merge { ids, name? } - Job anlegen
mergeRouter.post('/', (req, res, next) => {
  try {
    const ids = parseIds(req.body?.ids);
    if (!ids || ids.length < 2) return res.status(400).json({ error: 'Zum Zusammenfügen sind mindestens zwei Videos nötig.' });
    const names: string[] = [];
    for (const id of ids) {
      const resolved = resolveVideo(id);
      if (!resolved) return res.status(404).json({ error: `Video nicht gefunden: ${id}` });
      names.push(resolved.displayName);
    }
    const name = typeof req.body?.name === 'string' ? req.body.name.slice(0, 120) : undefined;
    const job = jobQueue.addMergeJob(ids, names, name);
    res.json({ ok: true, jobId: job.id, job });
  } catch (err) {
    next(err);
  }
});
