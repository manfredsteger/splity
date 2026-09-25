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
  analyzedAt: string;
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

export interface SplitResult {
  outputDir: string;
  hostOutputDir: string;
  files: SplitResultFile[];
  warnings: string[];
  durationSeconds: number;
}

export interface Job {
  id: string;
  videoId: string;
  videoName: string;
  mode: SplitMode;
  status: JobStatus;
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
    dataDir: string;
    eingang: string;
    fertig: string;
  };
}
