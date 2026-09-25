import fs from 'node:fs';
import path from 'node:path';
import { ALLOWED_EXTENSIONS, EINGANG_DIR } from './config.js';
import type { ResolvedVideo } from './types.js';

export function encodeVideoId(source: string, relPath: string): string {
  const b64 = Buffer.from(relPath, 'utf8').toString('base64url');
  return `${source}:${b64}`;
}

export function decodeVideoId(id: string): { source: string; relPath: string } | null {
  if (!id || typeof id !== 'string') return null;

  const colonIdx = id.indexOf(':');
  if (colonIdx !== -1) {
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

  const ext = path.extname(normalized).toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return null;
  }

  let sourceDir: string;
  let deletable: boolean;

  if (source === 'inbox') {
    sourceDir = EINGANG_DIR;
    deletable = true;
  } else {
    // Zukünftige schreibgeschützte Quellen vorbereitet
    return null;
  }

  const absPath = path.resolve(sourceDir, normalized);
  if (!absPath.startsWith(sourceDir + path.sep) && absPath !== sourceDir) {
    return null;
  }

  if (!fs.existsSync(absPath)) {
    return null;
  }

  return {
    source,
    relPath: normalized,
    absPath,
    displayName: path.basename(normalized),
    deletable,
  };
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
