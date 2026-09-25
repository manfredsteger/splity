import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_EXTENSIONS, LIBRARY_DIR, SPLITY_LIBRARY_HOST_PATH } from '../config.js';
import { encodeVideoId } from '../sources.js';
import type { LibraryBrowseResult, LibraryFolder, LibraryParent, LibraryVideo } from '../types.js';

export const libraryRouter = Router();

libraryRouter.get('/', (req, res, next) => {
  try {
    if (!LIBRARY_DIR || !fs.existsSync(LIBRARY_DIR)) {
      return res.status(404).json({
        error: 'Bibliothek ist nicht eingebunden oder der Pfad existiert nicht.',
      });
    }

    let realLibDir: string;
    try {
      realLibDir = fs.realpathSync(LIBRARY_DIR);
    } catch {
      return res.status(500).json({ error: 'Bibliotheksverzeichnis konnte nicht aufgelöst werden.' });
    }

    const rawPath = typeof req.query.path === 'string' ? req.query.path.trim() : '';
    // Strip leading and trailing slashes
    const cleanPath = rawPath.replace(/^[/\\]+/, '').replace(/[/\\]+$/, '');

    // Path traversal check
    if (cleanPath) {
      const normalized = path.normalize(cleanPath);
      if (
        normalized.startsWith('..') ||
        normalized.includes(`..${path.sep}`) ||
        normalized.includes(`${path.sep}..`) ||
        normalized === '..'
      ) {
        return res.status(400).json({ error: 'Ungültiger Pfad.' });
      }

      // Check for hidden directory segments
      const segments = normalized.split(/[/\\]/);
      if (segments.some((s) => s.startsWith('.'))) {
        return res.status(403).json({ error: 'Versteckte Ordner dürfen nicht aufgerufen werden.' });
      }
    }

    const normalizedPath = cleanPath ? path.normalize(cleanPath).replace(/\\/g, '/') : '';
    const currentAbsDir = normalizedPath ? path.resolve(LIBRARY_DIR, normalizedPath) : LIBRARY_DIR;

    if (!currentAbsDir.startsWith(LIBRARY_DIR + path.sep) && currentAbsDir !== LIBRARY_DIR) {
      return res.status(400).json({ error: 'Ungültiger Pfad außerhalb der Bibliothek.' });
    }

    if (!fs.existsSync(currentAbsDir)) {
      return res.status(404).json({ error: 'Ordner nicht gefunden.' });
    }

    // Verify realpath against realpath of LIBRARY_DIR
    try {
      const realCurrent = fs.realpathSync(currentAbsDir);
      if (!realCurrent.startsWith(realLibDir + path.sep) && realCurrent !== realLibDir) {
        return res.status(403).json({ error: 'Ungültiger Pfad (zeigt außerhalb der Bibliothek).' });
      }
      const stat = fs.statSync(currentAbsDir);
      if (!stat.isDirectory()) {
        return res.status(400).json({ error: 'Angegebener Pfad ist kein Ordner.' });
      }
    } catch {
      return res.status(404).json({ error: 'Ordner konnte nicht geöffnet werden.' });
    }

    // Host path
    const baseHost = SPLITY_LIBRARY_HOST_PATH || LIBRARY_DIR;
    const hostPath = normalizedPath
      ? `${baseHost.replace(/\/+$/, '')}/${normalizedPath}`
      : baseHost;

    // Breadcrumb parents
    const parents: LibraryParent[] = [];
    if (normalizedPath) {
      parents.push({ name: 'Bibliothek', path: '' });
      const segments = normalizedPath.split('/');
      let accum = '';
      for (let i = 0; i < segments.length - 1; i++) {
        accum = accum ? `${accum}/${segments[i]}` : segments[i];
        parents.push({ name: segments[i], path: accum });
      }
    }

    // Read directory entries
    const entries = fs.readdirSync(currentAbsDir, { withFileTypes: true });
    const rawFolders: LibraryFolder[] = [];
    const rawVideos: Array<{ name: string; absPath: string; relPath: string }> = [];

    for (const entry of entries) {
      // Versteckte Dateien/Ordner (beginnend mit ".") nie anzeigen
      if (entry.name.startsWith('.')) continue;

      const entryAbsPath = path.join(currentAbsDir, entry.name);
      const entryRelPath = normalizedPath ? `${normalizedPath}/${entry.name}` : entry.name;

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();

      if (entry.isSymbolicLink()) {
        try {
          const realEntry = fs.realpathSync(entryAbsPath);
          if (realEntry.startsWith(realLibDir + path.sep) || realEntry === realLibDir) {
            const stat = fs.statSync(entryAbsPath);
            isDir = stat.isDirectory();
            isFile = stat.isFile();
          } else {
            // Symlink points outside library - ignore
            continue;
          }
        } catch {
          continue;
        }
      }

      if (isDir) {
        rawFolders.push({ name: entry.name, path: entryRelPath });
      } else if (isFile) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ALLOWED_EXTENSIONS.has(ext)) {
          rawVideos.push({
            name: entry.name,
            absPath: entryAbsPath,
            relPath: entryRelPath,
          });
        }
      }
    }

    // Ordner alphabetisch
    rawFolders.sort((a, b) => a.name.localeCompare(b.name, 'de', { sensitivity: 'base' }));

    // Videos nach mtime absteigend
    const videoItems: Array<LibraryVideo & { mtimeMs: number }> = [];
    for (const v of rawVideos) {
      try {
        const stat = fs.statSync(v.absPath);
        videoItems.push({
          id: encodeVideoId('lib', v.relPath),
          name: v.name,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        // ignore unreadable files
      }
    }
    videoItems.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // Bei mehr als 500 Einträgen abschneiden (truncated: true)
    const totalEntries = rawFolders.length + videoItems.length;
    let truncated = false;
    let finalFolders = rawFolders;
    let finalVideos = videoItems;

    if (totalEntries > 500) {
      truncated = true;
      if (rawFolders.length >= 500) {
        finalFolders = rawFolders.slice(0, 500);
        finalVideos = [];
      } else {
        const remaining = 500 - rawFolders.length;
        finalVideos = videoItems.slice(0, remaining);
      }
    }

    const response: LibraryBrowseResult = {
      path: normalizedPath,
      hostPath,
      parents,
      folders: finalFolders,
      videos: finalVideos.map(({ id, name, size, mtime }) => ({ id, name, size, mtime })),
      truncated,
    };

    res.json(response);
  } catch (err: any) {
    next(err);
  }
});
