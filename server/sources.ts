import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_EXTENSIONS, EINGANG_DIR, FERTIG_DIR, LIBRARY_DIR, SPLITY_HOST_PATH } from './config.js';
import type { ResolvedVideo } from './types.js';

// 'out' = Fertig-Ordner: fertige Teile lassen sich so zusammenfügen oder erneut schneiden (nie verändern)
const KNOWN_SOURCES = new Set(['inbox', 'lib', 'out']);

export function encodeVideoId(source: string, relPath: string): string {
  const b64 = Buffer.from(relPath, 'utf8').toString('base64url');
  return `${source}:${b64}`;
}

export function decodeVideoId(id: string): { source: string; relPath: string } | null {
  if (!id || typeof id !== 'string') return null;

  // Nur bekannte Quellen-Präfixe zählen; ein Legacy-Dateiname wie "Aufnahme 12:30.mp4"
  // darf nicht als Quelle "Aufnahme 12" gelesen werden.
  const colonIdx = id.indexOf(':');
  if (colonIdx !== -1 && KNOWN_SOURCES.has(id.slice(0, colonIdx))) {
    const source = id.slice(0, colonIdx);
    const encoded = id.slice(colonIdx + 1);
    try {
      const relPath = Buffer.from(encoded, 'base64url').toString('utf8');
      return { source, relPath };
    } catch {
      return null;
    }
  }

  // Übergangsweise: nackter Dateiname wird als inbox interpretiert
  return { source: 'inbox', relPath: id };
}

export function resolveVideo(id: string): ResolvedVideo | null {
  const decoded = decodeVideoId(id);
  if (!decoded) return null;

  const { source, relPath } = decoded;

  if (!relPath || typeof relPath !== 'string') return null;
  if (relPath.startsWith('/') || relPath.startsWith('\\')) return null;

  const normalized = path.normalize(relPath);
  if (
    normalized.startsWith('..') ||
    normalized.includes(`..${path.sep}`) ||
    normalized.includes(`${path.sep}..`) ||
    normalized === '..'
  ) {
    return null;
  }

  // Versteckte Dateien/Ordner (beginnend mit ".") nie anzeigen / ablehnen
  const segments = normalized.split(/[/\\]/);
  if (segments.some((seg) => seg.startsWith('.'))) {
    return null;
  }

  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return null;
  }

  if (source === 'inbox') {
    const sourceDir = EINGANG_DIR;
    const absPath = path.resolve(sourceDir, normalized);
    if (!absPath.startsWith(sourceDir + path.sep) && absPath !== sourceDir) {
      return null;
    }

    if (!fs.existsSync(absPath)) {
      return null;
    }

    return {
      source: 'inbox',
      relPath: normalized,
      absPath,
      displayName: path.basename(normalized),
      deletable: true,
    };
  }

  if (source === 'out') {
    const absPath = path.resolve(FERTIG_DIR, normalized);
    if (!absPath.startsWith(FERTIG_DIR + path.sep)) return null;
    try {
      const realTarget = fs.realpathSync(absPath);
      const realOut = fs.realpathSync(FERTIG_DIR);
      if (!realTarget.startsWith(realOut + path.sep)) return null;
      if (!fs.statSync(absPath).isFile()) return null;
    } catch {
      return null;
    }
    return { source: 'out', relPath: normalized, absPath, displayName: path.basename(normalized), deletable: false };
  }

  if (source === 'lib') {
    if (!LIBRARY_DIR || !fs.existsSync(LIBRARY_DIR)) {
      return null;
    }

    const absPath = path.resolve(LIBRARY_DIR, normalized);
    if (!absPath.startsWith(LIBRARY_DIR + path.sep) && absPath !== LIBRARY_DIR) {
      return null;
    }

    if (!fs.existsSync(absPath)) {
      return null;
    }

    // Sicherheit wie bei inbox, ZUSÄTZLICH fs.realpath prüfen:
    // Das aufgelöste Ziel muss innerhalb von realpath(LIBRARY_DIR) liegen
    // (Symlinks, die aus dem Ordner hinausführen, ablehnen).
    try {
      const realTarget = fs.realpathSync(absPath);
      const realLibDir = fs.realpathSync(LIBRARY_DIR);
      if (!realTarget.startsWith(realLibDir + path.sep) && realTarget !== realLibDir) {
        return null;
      }
      const stat = fs.statSync(absPath);
      if (!stat.isFile()) {
        return null;
      }
    } catch {
      return null;
    }

    return {
      source: 'lib',
      relPath: normalized,
      absPath,
      displayName: path.basename(normalized),
      deletable: false,
    };
  }

  return null;
}

export interface ListedVideo extends ResolvedVideo {
  id: string;
  size: number;
  mtime: string;
  mtimeMs: number;
}

export function listVideos(sourceName = 'inbox'): ListedVideo[] {
  if (sourceName !== 'inbox') {
    return [];
  }

  if (!fs.existsSync(EINGANG_DIR)) {
    return [];
  }

  const entries = fs.readdirSync(EINGANG_DIR, { withFileTypes: true });
  const result: ListedVideo[] = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name.startsWith('.')) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) continue;

    const absPath = path.join(EINGANG_DIR, entry.name);
    try {
      const stat = fs.statSync(absPath);
      const id = encodeVideoId('inbox', entry.name);

      result.push({
        id,
        source: 'inbox',
        relPath: entry.name,
        absPath,
        displayName: entry.name,
        deletable: true,
        size: stat.size,
        mtime: stat.mtime.toISOString(),
        mtimeMs: stat.mtimeMs,
      });
    } catch {
      // ignore unreadable files
    }
  }

  // Sort newest first
  result.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return result;
}

/** Fertig-Ordner mit ihren Videodateien (nur erste Ebene, sortiert nach Name) */
export function listOutputFolders(): Array<{
  name: string;
  path: string;
  hostPath: string;
  videos: Array<{ id: string; name: string; size: number; mtime: string }>;
}> {
  if (!fs.existsSync(FERTIG_DIR)) return [];
  const folders: ReturnType<typeof listOutputFolders> = [];
  for (const entry of fs.readdirSync(FERTIG_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const dir = path.join(FERTIG_DIR, entry.name);
    const videos: Array<{ id: string; name: string; size: number; mtime: string }> = [];
    try {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!f.isFile() || f.name.startsWith('.')) continue;
        if (!ALLOWED_EXTENSIONS.has(path.extname(f.name).toLowerCase())) continue;
        const stat = fs.statSync(path.join(dir, f.name));
        videos.push({
          id: encodeVideoId('out', `${entry.name}/${f.name}`),
          name: f.name,
          size: stat.size,
          mtime: stat.mtime.toISOString(),
        });
      }
    } catch {
      continue;
    }
    if (videos.length === 0) continue;
    videos.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
    folders.push({
      name: entry.name,
      path: entry.name,
      hostPath: path.join(SPLITY_HOST_PATH, 'Fertig', entry.name),
      videos,
    });
  }
  folders.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  return folders;
}
