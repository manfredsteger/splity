import { describe, expect, it } from 'vitest';
import { planSplit } from './plan.js';

describe('planSplit', () => {
  it('count 8 auf 30-s-Video mit Keyframes alle 2 s', () => {
    // 30s video, keyframes at 0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30
    const keyframes = Array.from({ length: 16 }, (_, i) => i * 2);
    const plan = planSplit(30, keyframes, { type: 'count', n: 8 });

    expect(plan.parts.length).toBe(8);
    expect(plan.cuts.length).toBe(7);
    expect(plan.warnings.length).toBe(0);

    // Ideal cuts are at 3.75, 7.5, 11.25, 15.0, 18.75, 22.5, 26.25
    // Nearest keyframes:
    // 3.75 -> 4
    // 7.5 -> 8 (or 6 / 8, difference 0.5)
    // 11.25 -> 12 (or 10)
    // 15 -> 14 (first nearest keyframe with diff 1.0)
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([4, 8, 12, 14, 18, 22, 26]);
    // The sum of all part durations must equal 30
    const totalDuration = plan.parts.reduce((sum, p) => sum + p.duration, 0);
    expect(Math.round(totalDuration)).toBe(30);
  });

  it('zu wenige Keyframes für die gewünschte Teileanzahl', () => {
    // 30s video, only keyframes at 0, 10, 20, 30
    const keyframes = [0, 10, 20, 30];
    const plan = planSplit(30, keyframes, { type: 'count', n: 8 });

    // With only candidate keyframes at 10 and 20, maximum parts is 3
    expect(plan.parts.length).toBe(3);
    expect(plan.cuts.length).toBe(2);
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([10, 20]);
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0]).toContain('zu wenige Keyframes für 8 Teile, es werden 3 Teile');
  });

  it('Keyframe-Liste mit Offset (z. B. nicht auf glatten Sekunden)', () => {
    // Keyframes with offset: 0, 1.3, 3.8, 6.2, 9.1, 12.4, 15.0, 18.2, 21.1, 24.5, 27.9
    const keyframes = [0, 1.3, 3.8, 6.2, 9.1, 12.4, 15.0, 18.2, 21.1, 24.5, 27.9];
    const plan = planSplit(30, keyframes, { type: 'count', n: 4 });

    // 4 parts -> 3 cuts at ideal 7.5, 15.0, 22.5
    // Closest to 7.5 is 6.2 (diff 1.3) or 9.1 (diff 1.6) -> 6.2
    // Closest to 15.0 is 15.0 (diff 0.0)
    // Closest to 22.5 is 21.1 (diff 1.4) or 24.5 (diff 2.0) -> 21.1
    expect(plan.parts.length).toBe(4);
    expect(plan.cuts.length).toBe(3);
    expect(plan.cuts[0].actualTime).toBe(6.2);
    expect(plan.cuts[1].actualTime).toBe(15.0);
    expect(plan.cuts[2].actualTime).toBe(21.1);
    expect(plan.parts[0].start).toBe(0);
    expect(plan.parts[0].end).toBe(6.2);
    expect(plan.parts[1].start).toBe(6.2);
    expect(plan.parts[1].end).toBe(15.0);
  });

  it('every-Modus (alle X Sekunden)', () => {
    // 60s video with keyframes every 5s
    const keyframes = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60];
    const plan = planSplit(60, keyframes, { type: 'every', seconds: 15 });

    // Ideal cut points: 15, 30, 45
    expect(plan.cuts.length).toBe(3);
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([15, 30, 45]);
    expect(plan.parts.length).toBe(4);
  });

  it('n größer als Anzahl Keyframes', () => {
    // 100s video with only 3 internal keyframes: 25, 50, 75
    const keyframes = [0, 25, 50, 75, 100];
    const plan = planSplit(100, keyframes, { type: 'count', n: 20 });

    expect(plan.cuts.length).toBe(3);
    expect(plan.parts.length).toBe(4);
    expect(plan.warnings.length).toBe(1);
    expect(plan.warnings[0]).toContain('zu wenige Keyframes für 20 Teile, es werden 4 Teile');
  });

  it('points-Modus: Mindestlänge verschmilzt zu kurze Teile mit dem vorherigen', () => {
    const keyframes = Array.from({ length: 31 }, (_, i) => i); // jede Sekunde ein Keyframe
    const plan = planSplit(30, keyframes, { type: 'points', times: [8, 10, 11, 20, 28], minPartSeconds: 5 });
    // 8 ok (8 s), 10 zu kurz (2 s), 11 zu kurz (3 s), 20 ok (12 s), 28 -> letzter Teil nur 2 s -> weg
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([8, 20]);
    expect(plan.parts.length).toBe(3);
    expect(plan.warnings.some((w) => w.includes('3 Schnitte wegen Mindestlänge 5 s'))).toBe(true);
  });

  it('points-Modus: minPartSeconds 0 schaltet das Verschmelzen ab', () => {
    const keyframes = Array.from({ length: 31 }, (_, i) => i);
    const plan = planSplit(30, keyframes, { type: 'points', times: [1, 2, 3], minPartSeconds: 0 });
    expect(plan.cuts.length).toBe(3);
  });

  it('points-Modus: Punkte werden auf den nächsten Keyframe gelegt, Abweichung ausgewiesen', () => {
    const keyframes = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
    const plan = planSplit(30, keyframes, { type: 'points', times: [10.9, 21.2], origin: 'scenes' });
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([10, 22]);
    expect(plan.cuts[0].deltaSeconds).toBeCloseTo(-0.9, 3);
    expect(plan.maxDeltaSeconds).toBeCloseTo(0.9, 3);
  });

  it('size-Modus: schneidet, bevor das Limit überschritten wird, und schätzt Bytes je Teil', () => {
    const keyframes = [0, 2, 4, 6, 8, 10];
    const gopBytes = [100, 100, 100, 100, 100, 100]; // 600 Bytes gesamt
    const plan = planSplit(12, keyframes, { type: 'size', maxBytes: 300 }, gopBytes);
    // Limit 300 * 0.985 = 295 -> je 2 Abschnitte (200) pro Teil
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([4, 8]);
    expect(plan.parts.map((p) => p.bytes)).toEqual([200, 200, 200]);
    expect(plan.warnings).toEqual([]);
  });

  it('size-Modus: warnt bei einem Abschnitt über dem Limit', () => {
    const plan = planSplit(6, [0, 2, 4], { type: 'size', maxBytes: 100 }, [50, 500, 50]);
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([2, 4]);
    expect(plan.warnings[0]).toContain('größer als das Limit');
  });

  it('size-Modus ohne Größeninformation liefert einen Teil mit Warnung', () => {
    const plan = planSplit(30, [0, 10, 20], { type: 'size', maxBytes: 1000 });
    expect(plan.parts.length).toBe(1);
    expect(plan.warnings[0]).toContain('Größeninformation fehlt');
  });

  it('trim-Modus: behält nur den Bereich, Grenzen auf Keyframes', () => {
    const keyframes = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30];
    const plan = planSplit(30, keyframes, { type: 'trim', start: 5.2, end: 21.1 });
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([6, 22]);
    expect(plan.parts.map((p) => [p.start, p.end, p.keep])).toEqual([
      [0, 6, false],
      [6, 22, true],
      [22, 30, false],
    ]);
  });

  it('trim-Modus: Anfang bei 0 bzw. Ende bei der Dauer erzeugt nur einen Schnitt', () => {
    const keyframes = [0, 2, 4, 6, 8, 10];
    const plan = planSplit(10, keyframes, { type: 'trim', start: 0, end: 6.3 });
    expect(plan.cuts.map((c) => c.actualTime)).toEqual([6]);
    expect(plan.parts.map((p) => p.keep)).toEqual([true, false]);
    const plan2 = planSplit(10, keyframes, { type: 'trim', start: 3.9, end: 10 });
    expect(plan2.cuts.map((c) => c.actualTime)).toEqual([4]);
    expect(plan2.parts.map((p) => p.keep)).toEqual([false, true]);
  });
});
