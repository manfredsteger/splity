import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, LogIn, LogOut, Play, Plus, Trash2 } from 'lucide-react';
import { formatTime, formatTimePrecise, parseTimeInput } from '../utils/format.js';
import { Scrubber, type NeedlePhase, type ScrubberHandle } from './Scrubber.js';

export interface EditorSegment {
  id: string;
  start: number;
  end: number;
  name: string;
}

/** Rastpunkte: Anfang, alle Keyframes im Inneren, Ende */
export function makeSnapPoints(duration: number, keyframes: number[]): number[] {
  const inner = keyframes.filter((k) => k >= 0.05 && k <= duration - 0.05);
  return Array.from(new Set([0, ...inner, Math.round(duration * 1000) / 1000])).sort((a, b) => a - b);
}

/** Nächstgelegener Rastpunkt (Binärsuche, Liste ist sortiert) */
export function snapTime(points: number[], t: number): number {
  if (points.length === 0) return t;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[Math.max(0, lo - 1)];
  return Math.abs(a - t) < Math.abs(b - t) ? a : b;
}

export function nextPoint(points: number[], t: number): number | null {
  for (const p of points) if (p > t + 0.0005) return p;
  return null;
}

export function prevPoint(points: number[], t: number): number | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i] < t - 0.0005) return points[i];
  return null;
}

/**
 * Bereich gegen die anderen Segmente abgrenzen: Überlappungen werden abgeschnitten, liegt der
 * Bereich komplett in einem anderen Segment (oder bleibt nichts übrig), gibt es null.
 */
export function clampAgainst(others: EditorSegment[], start: number, end: number): { start: number; end: number } | null {
  let s = start;
  let e = end;
  for (const o of others) {
    if (o.end <= s + 0.0005 || o.start >= e - 0.0005) continue; // keine Überlappung
    if (o.start <= s + 0.0005 && o.end >= e - 0.0005) return null; // komplett verdeckt
    if (o.start <= s + 0.0005) s = Math.max(s, o.end);
    else if (o.end >= e - 0.0005) e = Math.min(e, o.start);
    else return null; // anderes Segment liegt mittendrin
  }
  if (e - s <= 0.0005) return null;
  return { start: s, end: e };
}

let idCounter = 0;
export function newSegmentId(): string {
  idCounter++;
  return `seg_${Date.now().toString(36)}_${idCounter}`;
}

type DragKind = 'create' | 'move' | 'resize-start' | 'resize-end';
interface DragState {
  kind: DragKind;
  id?: string;
  anchor: number;
  origStart: number;
  origEnd: number;
  startX: number;
  moved: boolean;
}

interface SegmentEditorProps {
  videoId: string;
  duration: number;
  keyframes: number[];
  fps: number;
  segments: EditorSegment[];
  onChange: (segments: EditorSegment[]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Nadel (Vorschau-Position) */
  needle: number;
  onNeedle: (seconds: number, phase: NeedlePhase) => void;
}

export const SegmentEditor: React.FC<SegmentEditorProps> = ({
  videoId,
  duration,
  keyframes,
  fps,
  segments,
  onChange,
  selectedId,
  onSelect,
  needle,
  onNeedle,
}) => {
  const points = useMemo(() => makeSnapPoints(duration, keyframes), [duration, keyframes]);
  const [zoom, setZoom] = useState(1);
  const [draft, setDraft] = useState<EditorSegment[] | null>(null);
  const [ghost, setGhost] = useState<{ start: number; end: number } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const scrubberRef = useRef<ScrubberHandle | null>(null);
  const playerTime = needle;
  const onSeek = useCallback((t: number) => onNeedle(t, 'end'), [onNeedle]);
  // Refs neben dem State: pointerup kann im selben Frame wie der letzte pointermove kommen,
  // dann wäre der State im Handler noch alt (schnelle Züge erzeugten sonst kein Segment).
  const ghostRef = useRef<{ start: number; end: number } | null>(null);
  const draftRef = useRef<EditorSegment[] | null>(null);
  const setGhostBoth = (g: { start: number; end: number } | null) => {
    ghostRef.current = g;
    setGhost(g);
  };
  const setDraftBoth = (d: EditorSegment[] | null) => {
    draftRef.current = d;
    setDraft(d);
  };

  const working = draft ?? segments;
  const byTime = useMemo(() => [...working].sort((a, b) => a.start - b.start), [working]);
  const kept = working.reduce((s, x) => s + (x.end - x.start), 0);
  const frame = Math.max(0.02, fps > 0 ? 1 / fps : 0.04);

  const gaps = useMemo(() => {
    const out: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    for (const s of byTime) {
      if (s.start - cursor > 0.0005) out.push({ start: cursor, end: s.start });
      cursor = Math.max(cursor, s.end);
    }
    if (duration - cursor > 0.0005) out.push({ start: cursor, end: duration });
    return out;
  }, [byTime, duration]);

  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / duration) * 100))}%`;

  const timeFromClientX = useCallback((clientX: number) => scrubberRef.current?.timeFromClientX(clientX) ?? 0, []);
  const capture = (e: React.PointerEvent) => {
    try {
      scrubberRef.current?.track?.setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  const update = useCallback(
    (next: EditorSegment[]) => {
      draftRef.current = null;
      setDraft(null);
      onChange(next);
    },
    [onChange]
  );

  // ---- Segmente ändern ----
  const setBounds = useCallback(
    (id: string, start: number, end: number, list: EditorSegment[] = segments): EditorSegment[] | null => {
      const others = list.filter((s) => s.id !== id);
      const c = clampAgainst(others, start, end);
      if (!c) return null;
      return list.map((s) => (s.id === id ? { ...s, start: c.start, end: c.end } : s));
    },
    [segments]
  );

  const addSegment = useCallback(
    (start: number, end: number): string | null => {
      const c = clampAgainst(segments, start, end);
      if (!c) return null;
      const seg: EditorSegment = { id: newSegmentId(), start: c.start, end: c.end, name: '' };
      update([...segments, seg]);
      onSelect(seg.id);
      return seg.id;
    },
    [segments, update, onSelect]
  );

  /** Neues Segment ab der Player-Position (bzw. in der nächsten Lücke), etwa 1/20 der Länge */
  const addAtPlayer = useCallback(() => {
    const s0 = snapTime(points, playerTime);
    const defaultLen = Math.max(10, duration / 20);
    const gap = gaps.find((g) => g.end > s0 + 0.0005) || gaps[0];
    if (!gap) return;
    const start = Math.max(gap.start, s0 >= gap.start && s0 < gap.end ? s0 : gap.start);
    let end = Math.min(gap.end, snapTime(points, start + defaultLen));
    if (end <= start + 0.0005) end = Math.min(gap.end, nextPoint(points, start) ?? gap.end);
    if (end <= start + 0.0005) return;
    const id = addSegment(start, end);
    if (id && onSeek) onSeek(start);
  }, [points, playerTime, duration, gaps, addSegment, onSeek]);

  const removeSegment = useCallback(
    (id: string) => {
      update(segments.filter((s) => s.id !== id));
      if (selectedId === id) onSelect(null);
    },
    [segments, update, selectedId, onSelect]
  );

  const moveInOrder = useCallback(
    (id: string, dir: -1 | 1) => {
      const idx = segments.findIndex((s) => s.id === id);
      const target = idx + dir;
      if (idx < 0 || target < 0 || target >= segments.length) return;
      const next = [...segments];
      [next[idx], next[target]] = [next[target], next[idx]];
      update(next);
    },
    [segments, update]
  );

  const sortByTime = useCallback(() => update([...segments].sort((a, b) => a.start - b.start)), [segments, update]);

  const nudge = useCallback(
    (id: string, which: 'start' | 'end', dir: -1 | 1) => {
      const seg = segments.find((s) => s.id === id);
      if (!seg) return;
      const cur = which === 'start' ? seg.start : seg.end;
      const t = dir < 0 ? prevPoint(points, cur) : nextPoint(points, cur);
      if (t === null) return;
      const next = which === 'start' ? setBounds(id, t, seg.end) : setBounds(id, seg.start, t);
      if (next) update(next);
    },
    [segments, points, setBounds, update]
  );

  const setFromPlayer = useCallback(
    (id: string, which: 'start' | 'end') => {
      const seg = segments.find((s) => s.id === id);
      if (!seg) return;
      const t = snapTime(points, playerTime);
      const next = which === 'start' ? setBounds(id, t, seg.end) : setBounds(id, seg.start, t);
      if (next) update(next);
    },
    [segments, points, playerTime, setBounds, update]
  );

  const setFromText = useCallback(
    (id: string, which: 'start' | 'end', text: string) => {
      const seg = segments.find((s) => s.id === id);
      if (!seg) return;
      const raw = parseTimeInput(text);
      if (Number.isNaN(raw)) return;
      const t = snapTime(points, Math.min(duration, Math.max(0, raw)));
      const next = which === 'start' ? setBounds(id, t, seg.end) : setBounds(id, seg.start, t);
      if (next) update(next);
    },
    [segments, points, duration, setBounds, update]
  );

  const rename = useCallback(
    (id: string, name: string) => update(segments.map((s) => (s.id === id ? { ...s, name } : s))),
    [segments, update]
  );

  // ---- Zeiger auf der Leiste ----
  const onBarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const t = snapTime(points, timeFromClientX(e.clientX));
    dragRef.current = { kind: 'create', anchor: t, origStart: t, origEnd: t, startX: e.clientX, moved: false };
    capture(e);
  };

  const onSegmentPointerDown = (e: React.PointerEvent<HTMLDivElement>, seg: EditorSegment, kind: DragKind) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const t = timeFromClientX(e.clientX);
    dragRef.current = { kind, id: seg.id, anchor: t, origStart: seg.start, origEnd: seg.end, startX: e.clientX, moved: false };
    capture(e);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const t = timeFromClientX(e.clientX);
    const d = dragRef.current;
    if (!d) return;
    if (!d.moved && Math.abs(e.clientX - d.startX) < 3) return;
    d.moved = true;
    const snapped = snapTime(points, t);
    // Die Nadel folgt der bewegten Kante – der Monitor zeigt live das Bild dort
    onNeedle(snapped, 'drag');
    if (d.kind === 'create') {
      const start = Math.min(d.anchor, snapped);
      const end = Math.max(d.anchor, snapped);
      setGhostBoth(end > start ? { start, end } : null);
      return;
    }
    if (!d.id) return;
    if (d.kind === 'move') {
      const len = d.origEnd - d.origStart;
      const start = snapTime(points, Math.min(duration - len, Math.max(0, d.origStart + (t - d.anchor))));
      const end = snapTime(points, start + len);
      const next = setBounds(d.id, start, end);
      if (next && next.find((s) => s.id === d.id)!.end > start) setDraftBoth(next);
    } else if (d.kind === 'resize-start') {
      const next = setBounds(d.id, Math.min(snapped, d.origEnd), d.origEnd);
      if (next) setDraftBoth(next);
    } else {
      const next = setBounds(d.id, d.origStart, Math.max(snapped, d.origStart));
      if (next) setDraftBoth(next);
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    try {
      scrubberRef.current?.track?.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (!d) return;
    if (d.kind === 'create') {
      const g = ghostRef.current;
      if (d.moved && g && g.end > g.start) {
        addSegment(g.start, g.end);
        onNeedle(g.start, 'end');
      } else if (!d.moved) {
        // Klick in eine Lücke: Nadel dorthin
        onNeedle(timeFromClientX(e.clientX), 'end');
      }
      setGhostBoth(null);
      return;
    }
    if (d.moved) {
      if (draftRef.current) update(draftRef.current);
      onNeedle(snapTime(points, timeFromClientX(e.clientX)), 'end');
    } else if (d.id) {
      onSelect(d.id);
      const seg = segments.find((s) => s.id === d.id);
      if (seg) onNeedle(seg.start, 'end');
    }
    setDraftBoth(null);
  };

  // Tastatur: I/O = Anfang/Ende des gewählten Segments an die Player-Position, N = neues Segment, Entf = löschen
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'n') {
        e.preventDefault();
        addAtPlayer();
      } else if (k === 'i' && selectedId) {
        e.preventDefault();
        setFromPlayer(selectedId, 'start');
      } else if (k === 'o' && selectedId) {
        e.preventDefault();
        setFromPlayer(selectedId, 'end');
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        removeSegment(selectedId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [addAtPlayer, setFromPlayer, removeSegment, selectedId]);

  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  const thumbUrl = (t: number) => `/api/videos/${encodeURIComponent(videoId)}/thumb?t=${Math.max(0, Math.round(t * 100) / 100)}`;

  return (
    <div className="space-y-4">
      {/* Werkzeugleiste */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addAtPlayer}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
          title="Neues Segment an der Nadel (Taste N)"
        >
          <Plus className="w-3.5 h-3.5" />
          Neues Segment an der Nadel
        </button>
        <button
          type="button"
          onClick={sortByTime}
          disabled={working.length < 2}
          className="px-3 py-1.5 rounded-xl text-xs font-bold bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 cursor-pointer disabled:cursor-not-allowed"
          title="Ausgabereihenfolge = zeitliche Reihenfolge"
        >
          Nach Zeit sortieren
        </button>
        <button
          type="button"
          onClick={() => {
            if (confirmClear) {
              update([]);
              onSelect(null);
              setConfirmClear(false);
            } else setConfirmClear(true);
          }}
          disabled={working.length === 0}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
            confirmClear ? 'bg-red-600 text-white' : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300 hover:bg-zinc-200 dark:hover:bg-zinc-700'
          }`}
        >
          {confirmClear ? 'Wirklich alle löschen?' : 'Alle löschen'}
        </button>
      </div>

      {/* Zeitleiste: Lineal = Nadel, Spur = Segmente aufziehen/verschieben */}
      <Scrubber
        ref={scrubberRef}
        duration={duration}
        keyframes={keyframes}
        needle={needle}
        onNeedle={onNeedle}
        snapNeedle={false}
        zoom={zoom}
        onZoom={setZoom}
        headerLeft={
          <div className="text-xs text-zinc-600 dark:text-zinc-400 truncate">
            <span className="font-semibold text-zinc-800 dark:text-zinc-200">{working.length} Segment{working.length === 1 ? '' : 'e'}</span>
            {' · '}behalten <span className="font-mono">{formatTime(kept)}</span>
            {' · '}verworfen <span className="font-mono">{formatTime(Math.max(0, duration - kept))}</span>
          </div>
        }
        trackProps={{
          onPointerDown: onBarPointerDown,
          onPointerMove,
          onPointerUp: endDrag,
          onPointerCancel: endDrag,
          title: 'Bereich aufziehen = neues Segment · Segment ziehen = verschieben · Kanten ziehen = Anfang/Ende ändern (Vorschau folgt)',
        }}
        trackClassName="cursor-crosshair rounded-b-lg"
        trackStyle={{
          backgroundImage: 'repeating-linear-gradient(135deg, rgba(120,120,130,0.18) 0px, rgba(120,120,130,0.18) 6px, transparent 6px, transparent 12px)',
        }}
        footer={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-600 inline-block" /> Segment (wird behalten)</span>
            <span className="flex items-center gap-1.5"><Trash2 className="w-3 h-3" /> Lücke (wird verworfen)</span>
            <span className="flex items-center gap-1.5"><span className="w-px h-3 bg-zinc-400 inline-block" /> Keyframe – Segmentgrenzen rasten darauf ein</span>
            <span className="ml-auto">
              Tasten: <kbd className="px-1 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">N</kbd> neu ·{' '}
              <kbd className="px-1 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">I</kbd>/<kbd className="px-1 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">O</kbd> Anfang/Ende = Nadel ·{' '}
              <kbd className="px-1 rounded bg-zinc-100 dark:bg-zinc-800 font-mono">Entf</kbd> löschen
            </span>
          </div>
        }
      >
        {/* Lücken (werden verworfen) */}
        {gaps.map((g, i) => (
          <div
            key={`gap-${i}`}
            className="absolute top-0 bottom-0 flex items-center justify-center text-zinc-500 pointer-events-none"
            style={{ left: pct(g.start), width: `${((g.end - g.start) / duration) * 100}%` }}
            title={`Wird verworfen: ${formatTime(g.start)} – ${formatTime(g.end)}`}
          >
            {((g.end - g.start) / duration) * 100 * zoom > 4 && <Trash2 className="w-4 h-4 opacity-60" />}
          </div>
        ))}

        {/* Segmente */}
        {working.map((seg) => {
          const order = working.findIndex((s) => s.id === seg.id) + 1;
          const isSel = seg.id === selectedId;
          const widthPct = ((seg.end - seg.start) / duration) * 100;
          return (
            <div
              key={seg.id}
              onPointerDown={(e) => onSegmentPointerDown(e, seg, 'move')}
              className={`absolute top-1 bottom-1 rounded-lg cursor-grab active:cursor-grabbing flex flex-col justify-center px-2 overflow-hidden transition-shadow ${
                isSel ? 'bg-blue-500 ring-2 ring-white shadow-lg z-20' : 'bg-blue-600 hover:bg-blue-500 z-10'
              }`}
              style={{ left: pct(seg.start), width: `${widthPct}%` }}
              title={`Segment ${order}${seg.name ? ` „${seg.name}“` : ''}: ${formatTime(seg.start)} – ${formatTime(seg.end)} (${formatTime(seg.end - seg.start)})`}
            >
              <div className="text-xs font-bold text-white truncate drop-shadow-xs">{widthPct * zoom > 3 ? `${order}${seg.name ? ` ${seg.name}` : ''}` : ''}</div>
              {widthPct * zoom > 8 && <div className="text-[10px] font-mono text-blue-100 truncate">{formatTime(seg.end - seg.start)}</div>}
              <div onPointerDown={(e) => onSegmentPointerDown(e, seg, 'resize-start')} className="absolute left-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/25 hover:bg-white/60" title="Anfang ziehen (Vorschau folgt)" />
              <div onPointerDown={(e) => onSegmentPointerDown(e, seg, 'resize-end')} className="absolute right-0 top-0 bottom-0 w-2.5 cursor-ew-resize bg-white/25 hover:bg-white/60" title="Ende ziehen (Vorschau folgt)" />
            </div>
          );
        })}

        {/* Aufzieh-Vorschau */}
        {ghost && (
          <div className="absolute top-1 bottom-1 rounded-lg border-2 border-dashed border-blue-300 bg-blue-400/40 pointer-events-none z-30" style={{ left: pct(ghost.start), width: `${((ghost.end - ghost.start) / duration) * 100}%` }} />
        )}
      </Scrubber>

      {/* Karten in Ausgabereihenfolge */}
      {working.length === 0 ? (
        <div className="text-sm text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/50 p-4 rounded-xl border border-zinc-200 dark:border-zinc-700/60">
          Ziehe auf der Spur einen Bereich auf oder klicke „Neues Segment an der Nadel“. Beim Ziehen zeigt der Monitor oben das Bild an der
          bewegten Kante. Jedes Segment zeigt sein erstes und letztes Bild; alles außerhalb landet im Papierkorb. Am Ende werden alle Segmente verlustfrei geschnitten und – wenn gewünscht – in dieser Reihenfolge zu einer Datei zusammengefügt.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {working.map((seg, idx) => {
            const isSel = seg.id === selectedId;
            const endThumb = Math.max(seg.start, seg.end - frame);
            return (
              <div
                key={seg.id}
                onClick={() => onSelect(seg.id)}
                className={`rounded-xl border-2 p-3 space-y-2 transition-colors cursor-pointer ${
                  isSel ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30' : 'border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-800/40 hover:border-zinc-300 dark:hover:border-zinc-700'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-lg bg-blue-600 text-white text-xs font-bold flex items-center justify-center shrink-0">{idx + 1}</span>
                  <input
                    type="text"
                    value={seg.name}
                    placeholder={`Segment ${idx + 1}`}
                    onChange={(e) => rename(seg.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm font-semibold text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                  />
                  <span className="text-[11px] font-mono text-blue-600 dark:text-blue-400 shrink-0">{formatTime(seg.end - seg.start)}</span>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button type="button" onClick={(e) => { e.stopPropagation(); moveInOrder(seg.id, -1); }} disabled={idx === 0} title="In der Ausgabe nach vorn" className="w-7 h-7 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed">
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); moveInOrder(seg.id, 1); }} disabled={idx === working.length - 1} title="In der Ausgabe nach hinten" className="w-7 h-7 rounded-lg hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-30 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed">
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={(e) => { e.stopPropagation(); removeSegment(seg.id); }} title="Segment löschen" className="w-7 h-7 rounded-lg hover:bg-red-100 dark:hover:bg-red-950/60 text-zinc-500 hover:text-red-600 flex items-center justify-center cursor-pointer">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  {(['start', 'end'] as const).map((which) => {
                    const t = which === 'start' ? seg.start : seg.end;
                    return (
                      <div key={which} className="space-y-1">
                        <div className="relative w-full aspect-video rounded-lg bg-zinc-200 dark:bg-zinc-700 overflow-hidden group">
                          <img
                            src={thumbUrl(which === 'start' ? seg.start : endThumb)}
                            alt={which === 'start' ? 'Erstes Bild' : 'Letztes Bild'}
                            loading="lazy"
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              (e.target as HTMLElement).style.display = 'none';
                            }}
                          />
                          <span className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-white text-[10px] font-semibold">
                            {which === 'start' ? 'Anfang' : 'Ende'}
                          </span>
                          {(
                            <span
                              role="button"
                              title={which === 'start' ? 'Nadel an den Anfang (Vorschau zeigt das erste Bild)' : 'Nadel auf das letzte Bild'}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSeek(which === 'start' ? seg.start : Math.max(seg.start, seg.end - frame));
                              }}
                              className="absolute bottom-1 right-1 w-6 h-6 rounded-md bg-white/85 dark:bg-zinc-900/85 text-zinc-800 dark:text-zinc-100 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-colors"
                            >
                              <Play className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <button type="button" onClick={(e) => { e.stopPropagation(); nudge(seg.id, which, -1); }} title="Einen Keyframe früher" className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center cursor-pointer shrink-0">
                            <ChevronLeft className="w-3.5 h-3.5" />
                          </button>
                          <input
                            key={`${seg.id}-${which}-${t}`}
                            type="text"
                            defaultValue={formatTimePrecise(t)}
                            onClick={(e) => e.stopPropagation()}
                            onBlur={(e) => setFromText(seg.id, which, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                            }}
                            className="flex-1 min-w-0 px-1.5 py-1 rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-[11px] font-mono text-zinc-900 dark:text-zinc-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500/30"
                            title="Zeit eingeben (hh:mm:ss, mm:ss oder Sekunden) – rastet auf den nächsten Keyframe"
                          />
                          <button type="button" onClick={(e) => { e.stopPropagation(); nudge(seg.id, which, 1); }} title="Einen Keyframe später" className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 flex items-center justify-center cursor-pointer shrink-0">
                            <ChevronRight className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setFromPlayer(seg.id, which); }}
                            title={`${which === 'start' ? 'Anfang' : 'Ende'} = Nadel (${formatTimePrecise(playerTime)}), Taste ${which === 'start' ? 'I' : 'O'}`}
                            className="w-6 h-6 rounded-md bg-zinc-100 dark:bg-zinc-800 hover:bg-zinc-200 dark:hover:bg-zinc-700 disabled:opacity-40 flex items-center justify-center cursor-pointer disabled:cursor-not-allowed shrink-0"
                          >
                            {which === 'start' ? <LogIn className="w-3.5 h-3.5" /> : <LogOut className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
