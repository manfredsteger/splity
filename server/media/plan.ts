import type { Cut, Part, SplitMode, SplitPlan } from '../types.js';

/**
 * Calculates a lossless split plan by snapping ideal cut points to the nearest available keyframes.
 * Pure function: no I/O, no side-effects.
 */
export function planSplit(
  duration: number,
  keyframes: number[],
  mode: SplitMode
): SplitPlan {
  const warnings: string[] = [];

  if (duration <= 0) {
    return {
      cuts: [],
      parts: [],
      warnings: ['Ungültige Videodauer (0s oder negativ)'],
      maxDeltaSeconds: 0,
    };
  }

  // Filter keyframes: must be within (0, duration), excluding boundaries close to start/end
  const minThreshold = 0.05;
  const maxThreshold = duration - 0.05;
  const candidateKeyframes = keyframes
    .filter((kf) => kf >= minThreshold && kf <= maxThreshold)
    .sort((a, b) => a - b);

  let idealCutPoints: number[] = [];
  let requestedPartsCount = 1;

  if (mode.type === 'count') {
    const n = Math.max(2, Math.min(200, Math.round(mode.n || 2)));
    requestedPartsCount = n;
    for (let i = 1; i < n; i++) {
      idealCutPoints.push((i * duration) / n);
    }
  } else if (mode.type === 'every') {
    const step = Math.max(1, mode.seconds);
    let t = step;
    while (t < duration - minThreshold) {
      idealCutPoints.push(t);
      t += step;
    }
    requestedPartsCount = idealCutPoints.length + 1;
  } else if (mode.type === 'points') {
    idealCutPoints = (mode.times || [])
      .filter((t) => t >= minThreshold && t <= maxThreshold)
      .sort((a, b) => a - b);
    requestedPartsCount = idealCutPoints.length + 1;
  }

  if (candidateKeyframes.length === 0 || idealCutPoints.length === 0) {
    if (idealCutPoints.length > 0) {
      warnings.push(
        `Das Video hat keine geeigneten Keyframes zwischen Anfang und Ende. Es kann nicht verlustfrei in mehrere Teile geteilt werden.`
      );
    }
    return {
      cuts: [],
      parts: [
        {
          index: 1,
          start: 0,
          end: Math.round(duration * 1000) / 1000,
          duration: Math.round(duration * 1000) / 1000,
        },
      ],
      warnings,
      maxDeltaSeconds: 0,
    };
  }

  // Map each ideal point to the nearest keyframe
  const rawCuts: Array<{ idealTime: number; actualTime: number }> = [];

  for (const ideal of idealCutPoints) {
    let nearestKf = candidateKeyframes[0];
    let minDiff = Math.abs(nearestKf - ideal);

    for (let j = 1; j < candidateKeyframes.length; j++) {
      const kf = candidateKeyframes[j];
      const diff = Math.abs(kf - ideal);
      if (diff < minDiff) {
        minDiff = diff;
        nearestKf = kf;
      }
    }

    rawCuts.push({
      idealTime: Math.round(ideal * 1000) / 1000,
      actualTime: Math.round(nearestKf * 1000) / 1000,
    });
  }

  // Deduplicate cuts that snapped to the same keyframe
  // If multiple ideal points snap to the same actualTime, keep the one with smaller delta
  const cutMap = new Map<number, { idealTime: number; actualTime: number; delta: number }>();
  for (const raw of rawCuts) {
    const delta = Math.abs(raw.actualTime - raw.idealTime);
    const existing = cutMap.get(raw.actualTime);
    if (!existing || delta < existing.delta) {
      cutMap.set(raw.actualTime, { ...raw, delta });
    }
  }

  // Sort unique cuts ascending by actual cut time
  const uniqueCuts = Array.from(cutMap.values()).sort(
    (a, b) => a.actualTime - b.actualTime
  );

  const finalCuts: Cut[] = uniqueCuts.map((c) => ({
    idealTime: c.idealTime,
    actualTime: c.actualTime,
    deltaSeconds: Math.round((c.actualTime - c.idealTime) * 1000) / 1000,
  }));

  const actualPartsCount = finalCuts.length + 1;
  if (actualPartsCount < requestedPartsCount) {
    warnings.push(
      `Das Video hat zu wenige Keyframes für ${requestedPartsCount} Teile, es werden ${actualPartsCount} Teile.`
    );
  }

  // Mindestlänge je Teil (nur points-Modus, Default 5 s): Teile, die kürzer wären, mit dem
  // vorherigen verschmelzen – dazu den Schnittpunkt streichen. Der letzte Teil zählt auch.
  let cuts: Cut[] = finalCuts;
  if (mode.type === 'points') {
    const minLen = mode.minPartSeconds ?? 5;
    if (minLen > 0) {
      const kept: Cut[] = [];
      let lastStart = 0;
      for (const c of finalCuts) {
        if (c.actualTime - lastStart >= minLen) {
          kept.push(c);
          lastStart = c.actualTime;
        }
      }
      while (kept.length > 0 && duration - kept[kept.length - 1].actualTime < minLen) {
        kept.pop();
      }
      const merged = finalCuts.length - kept.length;
      if (merged > 0) {
        warnings.push(
          `${merged} Schnitt${merged === 1 ? '' : 'e'} wegen Mindestlänge ${minLen} s mit dem vorherigen Teil zusammengelegt.`
        );
      }
      cuts = kept;
    }
  }

  // Generate parts from cuts
  const boundaryPoints = [
    0,
    ...cuts.map((c) => c.actualTime),
    Math.round(duration * 1000) / 1000,
  ];

  const parts: Part[] = [];
  for (let i = 0; i < boundaryPoints.length - 1; i++) {
    const start = boundaryPoints[i];
    const end = boundaryPoints[i + 1];
    parts.push({
      index: i + 1,
      start,
      end,
      duration: Math.round((end - start) * 1000) / 1000,
    });
  }

  const maxDeltaSeconds =
    cuts.length > 0
      ? Math.max(...cuts.map((c) => Math.abs(c.deltaSeconds)))
      : 0;

  return {
    cuts,
    parts,
    warnings,
    maxDeltaSeconds: Math.round(maxDeltaSeconds * 1000) / 1000,
  };
}
