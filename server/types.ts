export interface VideoStreamInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  bitrate?: number;
  pixFmt?: string;
  profile?: string;
}

export interface AudioStreamInfo {
  index: number;
  codec: string;
  sampleRate: number;
  channels: number;
  language?: string;
}

export interface ProbeResult {
  filename: string;
  filesize: number;
  container: string;
  duration: number;
  startTime: number;
  video: VideoStreamInfo | null;
  /** Ab probeVersion 2: alle Tonspuren (für die Merge-Vorprüfung) */
  audio?: AudioStreamInfo[];
  audioTrackCount: number;
  subtitleTrackCount: number;
  hasDataStreams: boolean;
  keyframes: number[]; // Relative seconds from 0, sorted
  /** Bytes aller Streams je Keyframe-Abschnitt, gleiche Länge wie keyframes (ab probeVersion 3) */
  gopBytes?: number[];
  keyframeIntervalAvg: number; // Average gap in seconds
  keyframeIntervalMax: number; // Maximum gap in seconds
  analyzedAt: string;
  /** Cache-Format; fehlt bei alten Analysen -> neu analysieren */
  probeVersion?: number;
}

export interface ResolvedVideo {
  source: string;
  relPath: string;
  absPath: string;
  displayName: string;
  deletable: boolean;
}

export type SplitMode =
  | { type: 'count'; n: number }
  | { type: 'every'; seconds: number }
  /** Teile mit maximaler Dateigröße (Bytes); Schnitte an Keyframes, Summe der Paketgrößen je Keyframe-Abschnitt */
  | { type: 'size'; maxBytes: number }
  /** Nur einen Bereich behalten (Sekunden), Grenzen landen auf Keyframes */
  | { type: 'trim'; start: number; end: number }
  | {
      type: 'points';
      times: number[];
      /** Teile, die kürzer wären, werden mit dem vorherigen verschmolzen (Default 5 s). */
      minPartSeconds?: number;
      /** Woher die Punkte stammen – nur für die Anzeige im Verlauf. */
      origin?: 'scenes' | 'manual';
    };

// Szenenerkennung
export type SceneSensitivity = 'low' | 'mid' | 'high';

export interface SceneParams {
  /** scdet-Schwelle: niedrig=15, mittel=10, hoch=6 */
  threshold: number;
  /** Schwarzbilder (blackdetect) zusätzlich als Szenengrenze */
  black: boolean;
}

export interface Scene {
  index: number;
  start: number;
  end: number;
  duration: number;
  /** scdet-Score der Grenze am Szenenanfang (0 bei der ersten Szene) */
  score: number;
  /** Wie die Grenze am Szenenanfang gefunden wurde */
  kind: 'start' | 'scene' | 'black';
}

export interface SceneDetectionResult {
  threshold: number;
  black: boolean;
  scenes: Scene[];
  durationMs: number;
  analyzedAt: string;
}

export interface Cut {
  idealTime: number;
  actualTime: number;
  deltaSeconds: number;
}

export interface Part {
  index: number;
  start: number;
  end: number;
  duration: number;
  /** Geschätzte Größe in Bytes (Summe der Paketgrößen), falls die Analyse sie kennt */
  bytes?: number;
  /** false = Teil wird nach dem Schnitt verworfen (Trimmen) */
  keep?: boolean;
}

export interface SplitPlan {
  cuts: Cut[];
  parts: Part[];
  warnings: string[];
  maxDeltaSeconds: number;
}

export type JobStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface SplitResultFile {
  name: string;
  size: number;
  duration: number;
}

export type JobPhase = 'split' | 'verify' | 'scenes' | 'chapters' | 'merge' | 'remux' | 'audio';
export type JobType = 'split' | 'scenes' | 'chapters' | 'merge' | 'remux' | 'audio';

export interface StreamVerification {
  kind: 'video' | 'audio';
  index: number;
  packetsOriginal: number;
  packetsParts: number;
  firstMismatchAt?: number;
}

export interface VerificationResult {
  ok: boolean;
  skipped?: boolean;
  /** Grund, falls übersprungen (z. B. Bitstream-Umwandlung bei TS-Quellen) */
  note?: string;
  streams: StreamVerification[];
  durationMs: number;
  errorMessage?: string;
}

export interface SplitResult {
  outputDir: string;
  hostOutputDir: string;
  files: SplitResultFile[];
  warnings: string[];
  durationSeconds: number;
  verification?: VerificationResult;
}

export interface Job {
  id: string;
  /** Fehlt bei alten Jobs -> 'split' */
  type?: JobType;
  videoId: string;
  videoName: string;
  source?: string;
  mode: SplitMode;
  /** Nur bei type 'scenes' */
  sceneParams?: SceneParams;
  scenes?: SceneDetectionResult;
  /** Nur bei type 'chapters': Kapitelgrenzen (Sekunden, bildgenau, ohne Keyframe-Zwang) */
  chapterTimes?: number[];
  chapterTitles?: string[];
  /** Nur bei type 'merge': Video-IDs in Reihenfolge */
  inputIds?: string[];
  inputNames?: string[];
  outputName?: string;
  /** Nur bei type 'remux': Ziel-Container */
  remuxTarget?: string;
  /** Nur bei type 'audio': Index der Tonspur (0-basiert) */
  audioTrack?: number;
  status: JobStatus;
  phase?: JobPhase;
  progress: number; // 0 to 100
  currentPart: number;
  totalParts: number;
  createdAt: string;
  finishedAt?: string;
  durationSeconds?: number;
  result?: SplitResult;
  error?: string;
}

export interface AppSettings {
  defaultParts: number;
  namePattern: string;
  verifyAfterSplit: boolean;
}

export interface HealthInfo {
  ok: boolean;
  version: string;
  ffmpeg: string | null;
  ffprobe: string | null;
  freeBytes: number;
  paths: {
    splityDir: string;
    splityHostPath: string;
    libraryDir?: string | null;
    libraryHostPath?: string | null;
    dataDir: string;
    eingang: string;
    fertig: string;
  };
}

export interface LibraryParent {
  name: string;
  path: string;
}

export interface LibraryFolder {
  name: string;
  path: string;
}

export interface LibraryVideo {
  id: string;
  name: string;
  size: number;
  mtime: string;
}

export interface LibraryBrowseResult {
  path: string;
  hostPath: string;
  parents: LibraryParent[];
  folders: LibraryFolder[];
  videos: LibraryVideo[];
  truncated: boolean;
}

// Zusammenfügen (Merge)
export interface MergeProblem {
  file: string;
  field: string;
  value: string;
  expected: string;
}

export interface MergeCheckItem {
  id: string;
  name: string;
  size: number;
  duration: number;
  container: string;
  videoCodec: string;
  resolution: string;
  audioSummary: string;
}

export interface MergeCheckResult {
  ok: boolean;
  problems: MergeProblem[];
  items: MergeCheckItem[];
  totalDuration: number;
  totalSize: number;
  outputExt: string;
}

export interface OutputFolder {
  name: string;
  path: string;
  hostPath: string;
  videos: Array<{ id: string; name: string; size: number; mtime: string }>;
}
