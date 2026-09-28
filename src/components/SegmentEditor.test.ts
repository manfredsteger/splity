import { describe, expect, it } from 'vitest';
import { clampAgainst, makeSnapPoints, nextPoint, prevPoint, snapTime } from './SegmentEditor.js';

describe('SegmentEditor – Rastpunkte', () => {
  const points = makeSnapPoints(60, [0, 2, 4, 6, 8, 10, 59.99]);

  it('Anfang und Ende sind Rastpunkte, Keyframes am Rand fallen weg', () => {
    expect(points[0]).toBe(0);
    expect(points[points.length - 1]).toBe(60);
    expect(points).not.toContain(59.99);
  });

  it('snapTime findet den nächsten Punkt', () => {
    expect(snapTime(points, 4.9)).toBe(4);
    expect(snapTime(points, 5.1)).toBe(6);
    expect(snapTime(points, 30)).toBe(10);
    expect(snapTime(points, 59)).toBe(60);
  });

  it('nextPoint / prevPoint', () => {
    expect(nextPoint(points, 4)).toBe(6);
    expect(prevPoint(points, 4)).toBe(2);
    expect(nextPoint(points, 60)).toBeNull();
    expect(prevPoint(points, 0)).toBeNull();
  });
});

describe('SegmentEditor – Überlappungen', () => {
  const others = [
    { id: 'a', start: 10, end: 20, name: '' },
    { id: 'b', start: 40, end: 50, name: '' },
  ];

  it('freier Bereich bleibt unverändert', () => {
    expect(clampAgainst(others, 22, 38)).toEqual({ start: 22, end: 38 });
  });

  it('wird an den Nachbarn abgeschnitten', () => {
    expect(clampAgainst(others, 15, 45)).toEqual({ start: 20, end: 40 });
    expect(clampAgainst(others, 5, 15)).toEqual({ start: 5, end: 10 });
  });

  it('komplett in einem anderen Segment -> null', () => {
    expect(clampAgainst(others, 12, 18)).toBeNull();
  });

  it('anderes Segment mittendrin -> null', () => {
    expect(clampAgainst(others, 5, 25)).toBeNull();
  });

  it('angrenzend ist erlaubt', () => {
    expect(clampAgainst(others, 20, 40)).toEqual({ start: 20, end: 40 });
  });
});
