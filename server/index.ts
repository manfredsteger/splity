import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import { PORT, ensureDirectories, initToolVersions } from './config.js';
import { healthRouter } from './routes/health.js';
import { jobsRouter } from './routes/jobs.js';
import { settingsRouter } from './routes/settings.js';
import { videosRouter } from './routes/videos.js';

// Initialize directories and tool versions on boot
ensureDirectories();
await initToolVersions();

const app = express();

app.use(express.json());

// API routes
app.use('/api/health', healthRouter);
app.use('/api/videos', videosRouter);
app.use('/api/jobs', jobsRouter);
app.use('/api/settings', settingsRouter);

// Unknown /api routes return 404 JSON
app.all('/api/*', (req: Request, res: Response) => {
  res.status(404).json({ error: `API-Endpunkt nicht gefunden: ${req.method} ${req.path}` });
});

// JSON Error Middleware for all API errors
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(err);
  }
  // Bei kaputtem JSON-Body 400 { error: "Ungültiges JSON" } statt der rohen SyntaxError-Meldung
  if (err instanceof SyntaxError && 'body' in err && (err as any).status === 400) {
    return res.status(400).json({ error: 'Ungültiges JSON' });
  }

  console.error('[Splity Fehler]', err);
  const status = typeof err.status === 'number' && err.status >= 400 && err.status < 600 ? err.status : 500;
  const message = err.message || 'Ein unerwarteter Fehler ist aufgetreten.';
  res.status(status).json({ error: message });
});

// Frontend delivery: Vite middleware in development, static dist in production
if (process.env.NODE_ENV === 'production') {
  const distDir = path.resolve('dist');
  app.use(express.static(distDir));
  app.get('*', (req: Request, res: Response) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  // Dynamic import of Vite in development (no top-level import in server)
  const { createServer } = await import('vite');
  const vite = await createServer({
    server: { middlewareMode: true },
    appType: 'spa',
  });
  app.use(vite.middlewares);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Splity] Server läuft auf http://0.0.0.0:${PORT} (Modus: ${process.env.NODE_ENV || 'development'})`);
});
