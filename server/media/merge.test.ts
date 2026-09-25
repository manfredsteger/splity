import { describe, expect, it } from 'vitest';
import { checkMergeCompatibility, deriveMergeName, formatConcatList } from './merge.js';
import { buildChapters, formatFfmetadata } from './chapters.js';
import type { ProbeResult } from '../types.js';

function probe(over: Partial<ProbeResult> = {}): ProbeResult {
  return {
    filename: 'a.mp4',
    filesize: 1000,
    container: 'MP4',
    duration: 30,
    startTime: 0,
    video: { codec: 'h264', width: 1920, height: 1080, fps: 25, duration: 30, pixFmt: 'yuv420p', profile: 'High' },
    audio: [{ index: 0, codec: 'aac', sampleRate: 48000, channels: 2 }],
    audioTrackCount: 1,
    subtitleTrackCount: 0,
    hasDataStreams: false,
    keyframes: [0, 2, 4],
    keyframeIntervalAvg: 2,
    keyframeIntervalMax: 2,
    analyzedAt: '',
    probeVersion: 2,
    ...over,
  };
}

describe('checkMergeCompatibility', () => {
  it('akzeptiert gleiche Parameter', () => {
    expect(checkMergeCompatibility([{ name: 'a', probe: probe() }, { name: 'b', probe: probe() }])).toEqual([]);
  });

  it('meldet abweichende Auflösung und Ton-Codec je Datei', () => {
    const problems = checkMergeCompatibility([
      { name: 'a', probe: probe() },
      { name: 'b', probe: probe({ video: { ...probe().video!, width: 1280, height: 720 } }) },
      { name: 'c', probe: probe({ audio: [{ index: 0, codec: 'flac', sampleRate: 48000, channels: 2 }] }) },
    ]);
    expect(problems).toEqual([
      { file: 'b', field: 'Auflösung', value: '1280×720', expected: '1920×1080' },
      { file: 'c', field: 'Ton 1 Codec', value: 'flac', expected: 'aac' },
    ]);
  });

  it('meldet unterschiedliche Anzahl Tonspuren', () => {
    const problems = checkMergeCompatibility([{ name: 'a', probe: probe() }, { name: 'b', probe: probe({ audio: [] }) }]);
    expect(problems[0].field).toBe('Tonspuren');
  });
});

describe('deriveMergeName', () => {
  it('entfernt den Teil-Zusatz', () => {
    expect(deriveMergeName('Urlaub - Teil 01 von 08.mp4')).toBe('Urlaub');
    expect(deriveMergeName('Clip (2).mov')).toBe('Clip');
    expect(deriveMergeName('.mp4')).toBe('video');
  });
});

describe('formatConcatList', () => {
  it("schreibt Apostrophe als '\\''", () => {
    expect(formatConcatList(["/a/b's.mp4"])).toBe("file '/a/b'\\''s.mp4'\n");
  });
});

describe('Kapitel', () => {
  it('baut Kapitel aus Grenzen und schreibt FFMETADATA in Millisekunden', () => {
    const chapters = buildChapters(30, [20, 8, 8, 40]);
    expect(chapters.map((c) => [c.start, c.end, c.title])).toEqual([
      [0, 8, 'Szene 1'],
      [8, 20, 'Szene 2'],
      [20, 30, 'Szene 3'],
    ]);
    const meta = formatFfmetadata(chapters);
    expect(meta.startsWith(';FFMETADATA1\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=8000\ntitle=Szene 1')).toBe(true);
  });

  it('maskiert Sonderzeichen im Titel', () => {
    expect(formatFfmetadata(buildChapters(10, [5], ['A=B;C']))).toContain('title=A\\=B\\;C');
  });
});
