import { Router } from 'express';
import { jobQueue } from '../jobs.js';

export const jobsRouter = Router();

// GET /api/jobs - List recent jobs
jobsRouter.get('/', (req, res) => {
  res.json(jobQueue.getJobs());
});

// GET /api/jobs/:id/events - SSE Stream for a job
jobsRouter.get('/:id/events', (req, res) => {
  const jobId = req.params.id;
  const initialJob = jobQueue.getJob(jobId);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const sendEvent = (data: any) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  if (initialJob) {
    sendEvent(initialJob);
  } else {
    sendEvent({ error: 'Job nicht gefunden' });
    return res.end();
  }

  const listener = (updatedJob: any) => {
    sendEvent(updatedJob);
    if (
      updatedJob.status === 'done' ||
      updatedJob.status === 'error' ||
      updatedJob.status === 'cancelled'
    ) {
      // Allow client a brief moment to process final event, then end
      setTimeout(() => {
        try {
          res.end();
        } catch {
          // ignore
        }
      }, 500);
    }
  };

  jobQueue.on(`job:${jobId}`, listener);

  // Keep-alive heartbeat ping every 15 seconds
  const pingInterval = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      // ignore
    }
  }, 15000);

  req.on('close', () => {
    clearInterval(pingInterval);
    jobQueue.off(`job:${jobId}`, listener);
  });
});

// POST /api/jobs/:id/cancel - Cancel a queued or running job
jobsRouter.post('/:id/cancel', (req, res) => {
  const success = jobQueue.cancelJob(req.params.id);
  if (!success) {
    return res.status(400).json({ error: 'Job konnte nicht abgebrochen werden (nicht gefunden oder bereits beendet).' });
  }
  res.json({ ok: true, message: 'Job erfolgreich abgebrochen.' });
});
