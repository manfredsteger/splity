import { describe, expect, it } from 'vitest';
import { buildScenes, parseSceneLine } from './scenes.js';

describe('parseSceneLine', () => {
  it('liest scdet-Zeilen', () => {
    expect(parseSceneLine('[scdet @ 0x60000307cf80] lavfi.scd.score: 28.330, lavfi.scd.time: 10')).toEqual({
      time: 10,
      score: 28.33,
      kind: 'scene',
    });
  });

  it('liest blackdetect-Zeilen (Schnitt am Beginn des Schwarzbilds)', () => {
    expect(parseSceneLine('[blackdetect @ 0x1] black_start:12.5 black_end:13.1 black_duration:0.6')).toEqual({
      time: 12.5,
      score: 0.6,
      kind: 'black',
    });
  });

  it('ignoriert andere Zeilen', () => {
    expect(parseSceneLine('frame=  750 fps=0.0 q=-0.0 Lsize=N/A')).toBeNull();
    expect(parseSceneLine('')).toBeNull();
  });
});

describe('buildScenes', () => {
  it('baut Szenen aus Grenzen inkl. erster und letzter Szene', () => {
    const scenes = buildScenes(30, [
      { time: 20, score: 27.4, kind: 'scene' },
      { time: 10, score: 28.3, kind: 'scene' },
    ]);
    expect(scenes.map((s) => [s.start, s.end])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(scenes[0].kind).toBe('start');
    expect(scenes[1].score).toBe(28.3);
    expect(scenes[2].index).toBe(3);
  });

  it('legt Szenenwechsel und Schwarzbild an derselben Stelle zusammen (Szene gewinnt)', () => {
    const scenes = buildScenes(30, [
      { time: 10.2, score: 0.4, kind: 'black' },
      { time: 10.4, score: 30, kind: 'scene' },
    ]);
    expect(scenes).toHaveLength(2);
    expect(scenes[1].kind).toBe('scene');
    expect(scenes[1].start).toBe(10.4);
  });

  it('verwirft Grenzen direkt am Anfang oder Ende', () => {
    const scenes = buildScenes(30, [
      { time: 0.1, score: 50, kind: 'scene' },
      { time: 29.8, score: 50, kind: 'scene' },
    ]);
    expect(scenes).toHaveLength(1);
    expect(scenes[0]).toMatchObject({ start: 0, end: 30 });
  });
});
