import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AlertCircle, Play } from 'lucide-react';
import { formatTime } from '../utils/format.js';

export interface VideoPlayerHandle {
  seek: (seconds: number, play?: boolean) => void;
}

interface VideoPlayerProps {
  videoId: string;
  container: string;
  codec?: string;
  onTimeUpdate?: (seconds: number) => void;
}

const MIME_BY_CONTAINER: Record<string, string> = {
  MP4: 'video/mp4',
  M4V: 'video/mp4',
  MOV: 'video/quicktime',
  MKV: 'video/x-matroska',
  WEBM: 'video/webm',
  AVI: 'video/x-msvideo',
  TS: 'video/mp2t',
};

/**
 * Vorschau per HTTP-Range-Streaming. Kann der Browser das Format nicht (MKV, manche HEVC),
 * gibt es statt eines Fehlers einen Hinweis – der Schnitt funktioniert trotzdem.
 */
export const VideoPlayer = forwardRef<VideoPlayerHandle, VideoPlayerProps>(({ videoId, container, codec, onTimeUpdate }, ref) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const [current, setCurrent] = useState(0);

  const src = `/api/videos/${encodeURIComponent(videoId)}/stream`;

  useEffect(() => {
    setUnsupported(false);
    setCurrent(0);
    const el = videoRef.current;
    if (!el) return;
    const mime = MIME_BY_CONTAINER[(container || '').toUpperCase()];
    if (mime && el.canPlayType(mime) === '') {
      setUnsupported(true);
    }
  }, [videoId, container]);

  useImperativeHandle(
    ref,
    () => ({
      seek: (seconds: number, play = false) => {
        const el = videoRef.current;
        if (!el || unsupported) return;
        try {
          el.currentTime = Math.max(0, seconds);
          if (play) void el.play().catch(() => undefined);
        } catch {
          // ignore
        }
      },
    }),
    [unsupported]
  );

  if (unsupported) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-xl bg-zinc-50 dark:bg-zinc-800/50 border border-zinc-200 dark:border-zinc-700/60 text-sm text-zinc-600 dark:text-zinc-400">
        <AlertCircle className="w-5 h-5 shrink-0 text-zinc-400" />
        <div>
          <div className="font-semibold text-zinc-800 dark:text-zinc-200">Vorschau in diesem Browser nicht möglich</div>
          <div className="text-xs mt-0.5">
            {container}{codec ? ` mit ${codec.toUpperCase()}` : ''} kann der Browser nicht abspielen – der Schnitt funktioniert trotzdem, die Vorschaubilder bleiben.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      <div className="relative rounded-xl overflow-hidden bg-black border border-zinc-200 dark:border-zinc-800">
        <video
          ref={videoRef}
          key={videoId}
          src={src}
          controls
          preload="metadata"
          playsInline
          className="w-full max-h-[360px] bg-black"
          onTimeUpdate={(e) => {
            const t = (e.target as HTMLVideoElement).currentTime;
            setCurrent(t);
            onTimeUpdate?.(t);
          }}
          onError={() => setUnsupported(true)}
        />
      </div>
      <div className="flex items-center justify-between text-[11px] text-zinc-500 dark:text-zinc-400 px-1">
        <span className="flex items-center gap-1">
          <Play className="w-3 h-3" />
          <span>Klick auf einen Teil oder eine Szene springt dorthin</span>
        </span>
        <span className="font-mono">{formatTime(current)}</span>
      </div>
    </div>
  );
});

VideoPlayer.displayName = 'VideoPlayer';
