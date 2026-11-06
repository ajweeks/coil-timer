import z from 'zod';
import { Hours, Minutes, Seconds } from './time-utils';
import type { TimerState } from './TimerState';

/**
 * Time tracking: every millisecond the timer spends running is added to the *open* block, which is
 * always the last one in the list. Blocks are closed when the timer finishes (the bell), or manually
 * by starting a new block. Closed blocks can be relabelled, re-timed, merged or deleted.
 */
export const TimeBlockSchema = z.object({
  id: z.string(),
  label: z.string().max(150).optional(),
  /** When the block first started running; null for a block that hasn't run yet. */
  startedAt: z.number().nullable(),
  /** Banked running time. The open block also accrues `now - runningSince` while running. */
  ms: z.number().min(0),
});
export type TimeBlock = z.infer<typeof TimeBlockSchema>;

export interface TimeAccounting {
  blocks: TimeBlock[];
  /** Start of the current running stretch, or null when the timer isn't running. */
  runningSince: number | null;
}

let idCounter = 0;
const newId = () => `${Date.now().toString(36)}-${(idCounter++).toString(36)}`;

export const newBlock = (label?: string): TimeBlock => ({ id: newId(), label, startedAt: null, ms: 0 });

/** The block list with the open block materialised (there's always one, even if nothing has been tracked). */
export const withOpenBlock = (blocks: readonly TimeBlock[]): TimeBlock[] =>
  blocks.length > 0 ? [...blocks] : [{ id: 'initial', startedAt: null, ms: 0 }];

const replaceLast = (blocks: TimeBlock[], block: TimeBlock) => [...blocks.slice(0, -1), block];

export const isOpen = (a: TimeAccounting, id: string) => withOpenBlock(a.blocks).at(-1)!.id === id;

export const liveMs = (a: TimeAccounting, block: TimeBlock, now: number) =>
  block.ms + (isOpen(a, block.id) && a.runningSince != null ? Math.max(0, now - a.runningSince) : 0);

export const isEmpty = (a: TimeAccounting, block: TimeBlock) =>
  block.ms === 0 && !(isOpen(a, block.id) && a.runningSince != null);

/** Fold the current running stretch into the open block. */
const bank = (a: TimeAccounting, end: number): TimeAccounting => {
  if (a.runningSince == null) return a;
  const blocks = withOpenBlock(a.blocks);
  const open = blocks.at(-1)!;
  return {
    blocks: replaceLast(blocks, { ...open, ms: open.ms + Math.max(0, end - a.runningSince) }),
    runningSince: null,
  };
};

const startRunning = (a: TimeAccounting, now: number): TimeAccounting => {
  const blocks = withOpenBlock(a.blocks);
  const open = blocks.at(-1)!;
  return {
    blocks: open.startedAt == null ? replaceLast(blocks, { ...open, startedAt: now }) : blocks,
    runningSince: now,
  };
};

/** Close the open block and start a fresh one (which keeps running if the timer is running). */
export const splitBlock = (a: TimeAccounting, now: number, label?: string): TimeAccounting => {
  const open = withOpenBlock(a.blocks).at(-1)!;
  if (isEmpty(a, open)) return a;
  const wasRunning = a.runningSince != null;
  const banked = bank(a, now);
  const next = { ...banked, blocks: [...banked.blocks, newBlock(label)] };
  return wasRunning ? startRunning(next, now) : next;
};

export const setLabel = (a: TimeAccounting, id: string, label: string): TimeAccounting => ({
  ...a,
  blocks: withOpenBlock(a.blocks).map((b) => (b.id === id ? { ...b, label: label || undefined } : b)),
});

export const setDuration = (a: TimeAccounting, id: string, ms: number, now: number): TimeAccounting => {
  const duration = Math.max(0, Math.round(ms / Seconds) * Seconds);
  const blocks = withOpenBlock(a.blocks).map((b) => (b.id === id ? { ...b, ms: duration } : b));
  // Editing the live block: the typed value is the total so far, so restart the running stretch
  const restart = isOpen(a, id) && a.runningSince != null;
  return { blocks, runningSince: restart ? now : a.runningSince };
};

export const removeBlock = (a: TimeAccounting, id: string, now: number): TimeAccounting => {
  if (!isOpen(a, id)) return { ...a, blocks: a.blocks.filter((b) => b.id !== id) };
  // Deleting the open block discards its time but keeps tracking under the same label
  const open = withOpenBlock(a.blocks).at(-1)!;
  const running = a.runningSince != null;
  const fresh = { ...newBlock(open.label), startedAt: running ? now : null };
  return { blocks: replaceLast(withOpenBlock(a.blocks), fresh), runningSince: running ? now : null };
};

/** Merge a block into the one before it (chronologically). Merging the open block keeps it open. */
export const mergeIntoPrevious = (a: TimeAccounting, id: string): TimeAccounting => {
  const blocks = withOpenBlock(a.blocks);
  const i = blocks.findIndex((b) => b.id === id);
  if (i < 1) return a;
  const prev = blocks[i - 1];
  const curr = blocks[i];
  const starts = [prev.startedAt, curr.startedAt].filter((t) => t != null);
  const merged: TimeBlock = {
    ...prev,
    label: prev.label ?? curr.label,
    ms: prev.ms + curr.ms,
    startedAt: starts.length ? Math.min(...starts) : null,
  };
  return { ...a, blocks: [...blocks.slice(0, i - 1), merged, ...blocks.slice(i + 1)] };
};

export const clearBlocks = (a: TimeAccounting, now: number): TimeAccounting => {
  const cleared = { blocks: [], runningSince: null };
  return a.runningSince != null ? startRunning(cleared, now) : cleared;
};

/**
 * Apply time accounting to a model update, based on how the timer state changed. Every model write
 * goes through this, so time is tracked no matter which control changed the timer.
 */
export const accountTime = <M extends TimeAccounting & { state: TimerState }>(prev: M, next: M, now: number): M => {
  let a: TimeAccounting = { blocks: next.blocks, runningSince: next.runningSince };
  const shouldAccrue = next.state.is === 'running';
  // Stretch boundaries come from the timer state's own timestamps rather than `now`, so the log
  // matches the countdown exactly (a full 45:00 run logs 45:00, not 44:59.997 that rounds down)
  if (a.runningSince != null && !shouldAccrue) {
    let end = now;
    if (prev.state.is === 'running') {
      // The moment the timer read the remaining time it stopped at; for the bell that's endTime, which
      // also avoids counting time past the end if it was detected late (e.g. a background tab)
      const remaining = 'remainingTime' in next.state ? Math.max(0, next.state.remainingTime) : 0;
      end = Math.min(now, prev.state.endTime - remaining);
    }
    a = bank(a, Math.max(a.runningSince, end));
  } else if (a.runningSince == null && shouldAccrue) {
    const start = next.state.is === 'running' && prev.state.is !== 'running' ? next.state.startedAt : now;
    a = startRunning(a, Math.min(now, start));
  }
  if (next.state.is === 'postFinished' && prev.state.is !== 'postFinished') {
    // The bell closes the block; the next one carries the label over
    const blocks = withOpenBlock(a.blocks);
    const open = blocks.at(-1)!;
    if (open.ms > 0) {
      // Snap a run that ends just shy of a whole minute up to it (e.g. 44:59.4 → 45:00)
      const toNextMinute = (Minutes - (open.ms % Minutes)) % Minutes;
      const ms = toNextMinute > 0 && toNextMinute <= Seconds ? open.ms + toNextMinute : open.ms;
      a = { ...a, blocks: [...replaceLast(blocks, { ...open, ms }), newBlock(open.label)] };
    }
  }
  return { ...next, ...a };
};

/** Clock-style duration: "4:05", "32:10", "1:05:00" */
export const formatClock = (ms: number): string => {
  const total = Math.round(ms / Seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

/**
 * Parse a typed duration. Accepts "35" (minutes), "1h5", "1h 5m", "45m", "90s", "32:10" (m:ss),
 * "1:05:00" (h:mm:ss), and relative changes like "+5" or "-2m". Returns null if unparseable.
 */
export const parseDuration = (input: string, current: number): number | null => {
  const text = input.trim().toLowerCase();
  if (!text) return null;
  const rel = /^([+-])\s*(.+)$/.exec(text);
  if (rel) {
    const delta = parseDuration(rel[2], 0);
    return delta == null ? null : Math.max(0, current + (rel[1] === '+' ? delta : -delta));
  }
  if (/^\d+(:\d{1,2}){1,2}$/.test(text)) {
    const parts = text.split(':').map(Number);
    if (parts.slice(1).some((p) => p >= 60)) return null;
    const [h, m, s] = parts.length === 3 ? parts : [0, ...parts];
    return h * Hours + m * Minutes + s * Seconds;
  }
  if (!/^(\d+(\.\d+)?\s*[hms]?\s*)+$/.test(text)) return null;
  const units = { h: Hours, m: Minutes, s: Seconds };
  const nextSmaller = { h: 'm', m: 's', s: 's' } as const;
  let total = 0;
  let implied: keyof typeof units = 'm';
  for (const [, num, unit] of text.matchAll(/(\d+(?:\.\d+)?)\s*([hms]?)/g)) {
    const u = (unit || implied) as keyof typeof units;
    total += Number(num) * units[u];
    implied = nextSmaller[u];
  }
  return total;
};

/**
 * An undo point. Undoing restores the blocks from before an edit, while keeping any running time
 * that has accrued since the edit (it goes to whichever block is open after the undo).
 */
export interface UndoPoint {
  before: TimeAccounting;
  openIdAfter: string;
  openMsAfter: number;
}

export const undoPoint = (before: TimeAccounting, after: TimeAccounting, now: number): UndoPoint => {
  const open = withOpenBlock(after.blocks).at(-1)!;
  return { before: bank(before, now), openIdAfter: open.id, openMsAfter: liveMs(after, open, now) };
};

/** Returns null if the log has moved on in a way that can't be undone (e.g. the bell closed a block). */
export const applyUndo = (current: TimeAccounting, point: UndoPoint, now: number): TimeAccounting | null => {
  const open = withOpenBlock(current.blocks).at(-1)!;
  if (open.id !== point.openIdAfter) return null;
  const accrued = Math.max(0, liveMs(current, open, now) - point.openMsAfter);
  const blocks = withOpenBlock(point.before.blocks);
  const restoredOpen = blocks.at(-1)!;
  const restored = {
    blocks: replaceLast(blocks, { ...restoredOpen, ms: restoredOpen.ms + accrued }),
    runningSince: null,
  };
  return current.runningSince != null ? startRunning(restored, now) : restored;
};

/** Rounded to the nearest minute: "14m", "1h 05m" */
export const formatMinutes = (ms: number): string => {
  const total = Math.round(ms / Minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m.toString().padStart(2, '0')}m`;
};
