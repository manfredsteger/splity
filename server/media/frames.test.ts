import { describe, expect, it } from 'vitest';
import { keyframeAtOrBefore, round2 } from './frames.js';

describe('frames – Hilfsfunktionen', () => {
  const kf = [0, 10.077, 20.153, 30.23];
  it('keyframeAtOrBefore: letzter Keyframe ≤ t, Anfang als Rückfall', () => {
    expect(keyframeAtOrBefore(kf, 25)).toBe(20.153);
    expect(keyframeAtOrBefore(kf, 10.077)).toBe(10.077);
    expect(keyframeAtOrBefore(kf, 10.0765)).toBe(10.077); // Toleranz 0,5 ms
    expect(keyframeAtOrBefore(kf, 3)).toBe(0);
    expect(keyframeAtOrBefore([], 3)).toBe(0);
  });
  it('round2 rundet auf Hundertstel und klemmt bei 0', () => {
    expect(round2(100.766733)).toBe(100.77);
    expect(round2(-1)).toBe(0);
  });
});
