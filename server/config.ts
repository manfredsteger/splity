import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import type { AppSettings } from './types.js';

function resolvePort(): number {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      return parseInt(args[i + 1], 10);
    }
    if (args[i].startsWith('--port=')) {
      return parseInt(args[i].split('=')[1], 10);
    }
  }
  // Regel 2: PORT immer aus der Umgebung – auch im Dev-Modus (make dev setzt PORT=3007,
  // 3000 ist auf dem Mac von Open WebUI belegt).
  return process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
}

export const PORT = resolvePort();
export const DATA_DIR = path.resolve(process.env.DATA_DIR || './data');
export const SPLITY_DIR = path.resolve(process.env.SPLITY_DIR || './splity');
export const SPLITY_HOST_PATH = process.env.SPLITY_HOST_PATH || SPLITY_DIR;

export const LIBRARY_DIR = process.env.LIBRARY_DIR ? path.resolve(process.env.LIBRARY_DIR) : null;
export const SPLITY_LIBRARY_HOST_PATH = process.env.SPLITY_LIBRARY_HOST_PATH || (LIBRARY_DIR ? LIBRARY_DIR : null);

export const EINGANG_DIR = path.join(SPLITY_DIR, 'Eingang');
export const FERTIG_DIR = path.join(SPLITY_DIR, 'Fertig');
export const CACHE_DIR = path.join(DATA_DIR, 'cache');
export const THUMBS_DIR = path.join(CACHE_DIR, 'thumbs');
export const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');
export const JOBS_FILE = path.join(DATA_DIR, 'jobs.json');

export const DEFAULT_SETTINGS: AppSettings = {
  defaultParts: 8,
  namePattern: '{name} - Teil {nr} von {gesamt}',
  verifyAfterSplit: true,
};

export function isValidNamePattern(pattern: string): boolean {
  if (typeof pattern !== 'string' || !pattern.trim()) return false;
  // Muster muss {nr} enthalten
  if (!pattern.includes('{nr}')) return false;

  // Erlaubte Platzhalter
  const allowed = ['{name}', '{nr}', '{gesamt}', '{start}', '{ende}'];
  let testStr = pattern;
  for (const ph of allowed) {
    testStr = testStr.split(ph).join('');
  }
  // Wenn noch andere {platzhalter} übrig sind, ist das Muster ungültig
  if (/\{[^}]*\}/.test(testStr)) {
    return false;
  }
  return true;
}

export const ALLOWED_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.m4v',
  '.mkv',
  '.webm',
  '.avi',
  '.ts',
  '.mts',
  '.m2ts',
]);

export function ensureDirectories(): void {
  const dirs = [
    DATA_DIR,
    SPLITY_DIR,
    EINGANG_DIR,
    FERTIG_DIR,
    CACHE_DIR,
    THUMBS_DIR,
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  // Clean up any lingering temporary directories in Fertig/ from previous runs
  try {
    const entries = fs.readdirSync(FERTIG_DIR, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('.') && entry.name.endsWith('.tmp')) {
        const tmpPath = path.join(FERTIG_DIR, entry.name);
        try {
          fs.rmSync(tmpPath, { recursive: true, force: true });
        } catch {
          // ignore cleanup errors on startup
        }
      }
    }
  } catch {
    // ignore
  }

  // Abgebrochene Uploads (.part) aus einem früheren Lauf entfernen
  try {
    for (const entry of fs.readdirSync(EINGANG_DIR, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.part')) {
        try {
          fs.rmSync(path.join(EINGANG_DIR, entry.name), { force: true });
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  // Ensure default settings exist
  if (!fs.existsSync(SETTINGS_FILE)) {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2), 'utf-8');
  }
}

export function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8'));
      return {
        defaultParts:
          typeof data.defaultParts === 'number' && data.defaultParts >= 2 && data.defaultParts <= 200
            ? data.defaultParts
            : DEFAULT_SETTINGS.defaultParts,
        namePattern:
          typeof data.namePattern === 'string' && isValidNamePattern(data.namePattern)
            ? data.namePattern.trim()
            : DEFAULT_SETTINGS.namePattern,
        verifyAfterSplit:
          typeof data.verifyAfterSplit === 'boolean'
            ? data.verifyAfterSplit
            : DEFAULT_SETTINGS.verifyAfterSplit,
      };
    }
  } catch {
    // fallback
  }
  return { ...DEFAULT_SETTINGS };
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = loadSettings();
  const updated: AppSettings = {
    defaultParts:
      typeof settings.defaultParts === 'number' &&
      settings.defaultParts >= 2 &&
      settings.defaultParts <= 200
        ? settings.defaultParts
        : current.defaultParts,
    namePattern:
      typeof settings.namePattern === 'string' && isValidNamePattern(settings.namePattern)
        ? settings.namePattern.trim()
        : current.namePattern,
    verifyAfterSplit:
      typeof settings.verifyAfterSplit === 'boolean'
        ? settings.verifyAfterSplit
        : current.verifyAfterSplit,
  };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export async function getFreeDiskBytes(dirPath: string): Promise<number> {
  try {
    if (fs.promises.statfs) {
      const stats = await fs.promises.statfs(dirPath);
      return stats.bavail * stats.bsize;
    }
  } catch {
    // fallback if statfs not available
  }
  return 100 * 1024 * 1024 * 1024; // 100 GB default fallback
}

let cachedFfmpegVersion: string | null = null;
let cachedFfprobeVersion: string | null = null;

function runToolVersion(command: string): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, ['-version']);
      let output = '';
      child.stdout.on('data', (d) => {
        output += d.toString();
      });
      child.on('error', () => resolve(null));
      child.on('close', (code) => {
        if (code === 0 && output) {
          const firstLine = output.split('\n')[0] || '';
          const match = firstLine.match(/version\s+([^\s]+)/i);
          resolve(match ? match[1] : firstLine);
        } else {
          resolve(null);
        }
      });
    } catch {
      resolve(null);
    }
  });
}

export async function initToolVersions(): Promise<{ ffmpeg: string | null; ffprobe: string | null }> {
  if (cachedFfmpegVersion === null) {
    cachedFfmpegVersion = await runToolVersion('ffmpeg');
  }
  if (cachedFfprobeVersion === null) {
    cachedFfprobeVersion = await runToolVersion('ffprobe');
  }
  return { ffmpeg: cachedFfmpegVersion, ffprobe: cachedFfprobeVersion };
}

export function getCachedToolVersions(): { ffmpeg: string | null; ffprobe: string | null } {
  return { ffmpeg: cachedFfmpegVersion, ffprobe: cachedFfprobeVersion };
}
