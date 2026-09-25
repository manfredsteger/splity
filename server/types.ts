export interface VideoStreamInfo {
  codec: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  bitrate?: number;
}

export interface ProbeResult {
  filename: string;
  filesize: number;
  container: string;
  duration: number;
  startTime: number;
  video: VideoStreamInfo | null;
  audioTrackCount: number;
  subtitleTrackCount: number;
  hasDataStreams: boolean;
  keyframes: number[]; // Relative seconds from 0, sorted
  keyframeIntervalAvg: number; // Average gap in seconds
  keyframeIntervalMax: number; // Maximum gap in seconds
  analyzedAt: string;
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
  | { type: 'points'; times: number[] };

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

export type JobPhase = 'split' | 'verify';

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
  videoId: string;
  videoName: string;
  source?: string;
  mode: SplitMode;
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
