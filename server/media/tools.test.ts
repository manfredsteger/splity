import { describe, expect, it } from 'vitest';
import { audioExtensionFor, checkRemux } from './tools.js';
import type { ProbeResult } from '../types.js';

function probe(over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    filename: 'a.mkv',
    filesize: 1,
    container: 'MKV',
    duration: 10,
    startTime: 0,
    video: { codec: 'h264', width: 1, height: 1, fps: 25, duration: 10 },
    audio: [{ index: 0, codec: 'aac', sampleRate: 48000, channels: 2 }],
    audioTrackCount: 1,
    subtitleTrackCount: 0,
    hasDataStreams: false,
    keyframes: [0],
    keyframeIntervalAvg: 1,
    keyframeIntervalMax: 1,
    analyzedAt: '',
    probeVersion: 3,
    ...over,
  };
}

describe('checkRemux', () => {
  it('erlaubt MKV -> MP4 bei H.264/AAC', () => {
    expect(checkRemux(probe(), '.mkv', 'mp4')).toMatchObject({ ok: true, dropSubtitles: false, annexB: false });
  });

  it('lehnt ProRes in MP4 ab, erlaubt es in MOV', () => {
    const p = probe({ video: { codec: 'prores', width: 1, height: 1, fps: 25, duration: 10 } });
    expect(checkRemux(p, '.mkv', 'mp4').ok).toBe(false);
    expect(checkRemux(p, '.mkv', 'mov').ok).toBe(true);
  });

  it('meldet Untertitel-Verlust bei MP4 und Annex-B bei TS-Quellen', () => {
    expect(checkRemux(probe({ subtitleTrackCount: 2 }), '.mkv', 'mp4').dropSubtitles).toBe(true);
    expect(checkRemux(probe(), '.ts', 'mp4').annexB).toBe(true);
  });

  it('lehnt gleiches Format ab', () => {
    expect(checkRemux(probe(), '.mp4', 'mp4').problems[0]).toContain('schon MP4');
    expect(checkRemux(probe(), '.m4v', 'mp4').ok).toBe(false);
  });
});

describe('audioExtensionFor', () => {
  it('wählt den passenden Container', () => {
    expect(audioExtensionFor('aac')).toBe('.m4a');
    expect(audioExtensionFor('flac')).toBe('.flac');
    expect(audioExtensionFor('pcm_s16le')).toBe('.wav');
    expect(audioExtensionFor('truehd')).toBe('.mka');
  });
});
