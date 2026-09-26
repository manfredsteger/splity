export interface VideoItem {
  id: string;
  name: string;
  source?: string;
  relPath?: string;
  size: number;
  mtime: string;
  deletable?: boolean;
  isAnalyzed: boolean;
  duration?: number;
  container?: string;
  resolution?: string;
  codec?: string;
  fps?: number;
  keyframeIntervalAvg?: number;
  keyframeIntervalMax?: number;
}

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
  audio?: AudioStreamInfo[];
  audioTrackCount: number;
  subtitleTrackCount: number;
  hasDataStreams: boolean;
  keyframes: number[];
  gopBytes?: number[];
  keyframeIntervalAvg: number;
  keyframeIntervalMax?: number;
  analyzedAt: string;
}

export type SplitMode =
  | { type: 'count'; n: number }
  | { type: 'every'; seconds: number }
  | { type: 'size'; maxBytes: number }
  | { type: 'trim'; start: number; end: number }
  | { type: 'points'; times: number[]; minPartSeconds?: number; origin?: 'scenes' | 'manual' };

export type SceneSensitivity = 'low' | 'mid' | 'high';

export interface SceneParams {
  threshold: number;
  black: boolean;
}

export interface Scene {
  index: number;
  start: number;
  end: number;
  duration: number;
  score: number;
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
  bytes?: number;
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
export type ResultKind = 'split' | 'chapters' | 'merge' | 'remux' | 'audio';

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
  type?: JobType;
  videoId: string;
  videoName: string;
  source?: string;
  mode: SplitMode;
  sceneParams?: SceneParams;
  scenes?: SceneDetectionResult;
  chapterTimes?: number[];
  chapterTitles?: string[];
  inputIds?: string[];
  inputNames?: string[];
  outputName?: string;
  remuxTarget?: string;
  audioTrack?: number;
  status: JobStatus;
  phase?: JobPhase;
  progress: number;
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
  suggestedName?: string;
}

export interface OutputFolder {
  name: string;
  path: string;
  hostPath: string;
  videos: Array<{ id: string; name: string; size: number; mtime: string }>;
}

export interface ToastMessage {
  id: string;
  type: 'info' | 'success' | 'error';
  title?: string;
  message: string;
}
