import clsx from 'clsx';
import { ChevronsDown, Plus, X } from 'lucide-react';
import { Ref, useEffect, useRef, useState } from 'react';
import {
  applyUndo,
  clearBlocks,
  formatClock,
  formatMinutes,
  isEmpty,
  isOpen,
  liveMs,
  mergeIntoPrevious,
  parseDuration,
  removeBlock,
  setDuration,
  setLabel,
  splitBlock,
  TimeAccounting,
  TimeBlock,
  undoPoint,
  UndoPoint,
  withOpenBlock,
} from './TimeBlocks';
import { formatTime, Minutes, Seconds } from './time-utils';
import { useNonPassiveWheelHandler } from './useNonPassiveWheelHandler';

export const LABELS_DATALIST_ID = 'coil-time-labels';

/** Attributes that stop browsers and password managers from offering autofill */
export const NO_AUTOFILL = {
  autoComplete: 'off',
  autoCorrect: 'off',
  spellCheck: false,
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': true,
  'data-form-type': 'other',
} as const;

const TOAST_TIMEOUT = 6 * Seconds;
/** Rapid edits of the same kind (e.g. scroll nudges) are undone together */
const COALESCE_WINDOW = 1.5 * Seconds;
const MAX_UNDO = 50;

const isTyping = (e: KeyboardEvent) => !!(e.target as Element | null)?.closest?.('input, textarea');

// ── Undo ──────────────────────────────────────────────────────────────────────

interface UndoEntry {
  point: UndoPoint;
  kind: string;
  at: number;
}

export type Commit = (next: TimeAccounting, kind: string, toast?: string) => void;

/** Undo history for time log edits, with Ctrl/Cmd+Z. Starting/stopping the timer isn't undoable; edits are. */
export const useTimeLogUndo = (accounting: TimeAccounting, onChange: (next: TimeAccounting) => void) => {
  const [stack, setStack] = useState<UndoEntry[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), TOAST_TIMEOUT);
    return () => clearTimeout(id);
  }, [toast]);

  const commit: Commit = (next, kind, toastMessage) => {
    const now = Date.now();
    const point = undoPoint(accounting, next, now);
    const top = stack.at(-1);
    // Typing a label coalesces until something else happens; other edits only in quick succession
    const coalesce = top?.kind === kind && (kind.startsWith('label:') || now - top.at < COALESCE_WINDOW);
    const entry = { point: coalesce ? { ...point, before: top.point.before } : point, kind, at: now };
    setStack([...(coalesce ? stack.slice(0, -1) : stack), entry].slice(-MAX_UNDO));
    setToast(toastMessage ?? null);
    onChange(next);
  };

  const undo = () => {
    const top = stack.at(-1);
    setToast(null);
    if (!top) return;
    const restored = applyUndo(accounting, top.point, Date.now());
    // If the bell has closed a block since, the history no longer applies
    setStack(restored ? stack.slice(0, -1) : []);
    if (restored) onChange(restored);
  };

  const undoRef = useRef(undo);
  useEffect(() => {
    undoRef.current = undo;
  });
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return;
      if (isTyping(e)) return; // let inputs do their own undo
      e.preventDefault();
      undoRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return { commit, undo, toast };
};

// ── Activity colours ─────────────────────────────────────────────────────────

/** Mid-tone hues that read on both light and dark backgrounds, assigned in order of first appearance */
const ACTIVITY_COLORS = ['#60a5fa', '#f59e0b', '#34d399', '#a78bfa', '#f472b6', '#22d3ee', '#a3e635', '#fb923c'];
const UNLABELLED_COLOR = '#9ca3af80';

const activityColor = (label: string, index: number) =>
  label === 'unlabelled' ? UNLABELLED_COLOR : ACTIVITY_COLORS[index % ACTIVITY_COLORS.length];

// ── Time log ─────────────────────────────────────────────────────────────────

/** Live-updating clock, ticking once a second while the timer runs. */
const useNow = (isRunning: boolean) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!isRunning) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning]);
  return now;
};

interface TimeLogProps {
  ref?: Ref<HTMLDivElement>;
  accounting: TimeAccounting;
  commit: Commit;
  undo: () => void;
  toast: string | null;
  /** Buttons are hidden (but keep their space) when false, e.g. when the window isn't focused */
  showControls: boolean;
  /** Called after a new block is started, e.g. to focus a label input */
  onSplit?: () => void;
  className?: string;
}

export const TimeLog = ({ ref, accounting, commit, undo, toast, showControls, onSplit, className }: TimeLogProps) => {
  const now = useNow(accounting.runningSince != null);

  const blocks = withOpenBlock(accounting.blocks);
  const open = blocks.at(-1)!;
  const tracked = blocks.filter((b) => !isEmpty(accounting, b));
  const totalMs = tracked.reduce((sum, b) => sum + liveMs(accounting, b, now), 0);

  // Totals per label, in order of first appearance
  const labelTotals = [
    ...tracked.reduce((m, b) => {
      const key = b.label?.trim() || 'unlabelled';
      return m.set(key, (m.get(key) ?? 0) + liveMs(accounting, b, now));
    }, new Map<string, number>()),
  ];
  const labels = [...new Set(blocks.map((b) => b.label?.trim()).filter(Boolean))] as string[];

  const split = () => {
    if (isEmpty(accounting, open)) return;
    commit(splitBlock(accounting, Date.now()), 'split');
    onSplit?.();
  };

  // "N" starts a new block, unless typing somewhere
  const splitRef = useRef(split);
  useEffect(() => {
    splitRef.current = split;
  });
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'n' || e.ctrlKey || e.metaKey || e.altKey || isTyping(e)) return;
      e.preventDefault();
      splitRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (tracked.length === 0 && accounting.runningSince == null && !toast) return null;

  const hideWhenUnfocused = clsx('transition-opacity duration-500', !showControls && 'opacity-0 invisible');

  return (
    <div
      ref={ref}
      data-time-log
      className={clsx('flex flex-col gap-0.5 text-xs text-gray-500 dark:text-gray-400 select-none', className)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
    >
      <datalist id={LABELS_DATALIST_ID}>
        {labels.map((l) => (
          <option key={l} value={l} />
        ))}
      </datalist>

      <div className="max-h-[40vh] overflow-y-auto flex flex-col gap-0.5">
        {[...blocks].reverse().map((block, i, rev) => (
          <BlockRow
            key={block.id}
            block={block}
            accounting={accounting}
            now={now}
            canMerge={i < rev.length - 1}
            showControls={showControls}
            commit={commit}
          />
        ))}
      </div>

      {/* Totals */}
      <div className="mt-1 pt-1 border-t border-gray-200 dark:border-gray-800 flex flex-col gap-0.5 max-w-64">
        {labelTotals.length > 1 && totalMs > 0 && (
          <>
            {/* Share of time per activity */}
            <div className="flex h-1.5 rounded-full overflow-hidden gap-px" aria-hidden>
              {labelTotals.map(([label, ms], i) => (
                <div
                  key={label}
                  className="transition-[flex-grow] duration-500"
                  style={{ flexGrow: ms, backgroundColor: activityColor(label, i) }}
                />
              ))}
            </div>
            <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 leading-snug">
              {labelTotals.map(([label, ms], i) => (
                <span key={label} className="flex items-center gap-1 min-w-0" title={`${label}: ${formatMinutes(ms)}`}>
                  <span
                    className="size-1.5 shrink-0 rounded-full"
                    style={{ backgroundColor: activityColor(label, i) }}
                  />
                  <span className="truncate max-w-20">{label}</span>
                  <span className="shrink-0 tabular-nums">{formatMinutes(ms)}</span>
                </span>
              ))}
            </div>
          </>
        )}
        <div className="text-gray-600 dark:text-gray-300 font-medium">{formatMinutes(totalMs)} total</div>
      </div>

      {/* Actions */}
      <div className={clsx('mt-1 flex items-center gap-1', hideWhenUnfocused)}>
        <LogButton onClick={split} disabled={isEmpty(accounting, open)} title="Start a new block (N)">
          <Plus size={12} /> new
        </LogButton>
        <LogButton
          onClick={() => commit(clearBlocks(accounting, Date.now()), 'clear', 'Log cleared')}
          disabled={tracked.length === 0}
          title="Clear all blocks"
          className="hover:text-red-400 dark:hover:text-red-400"
        >
          clear
        </LogButton>
        {toast && (
          <span className="ml-1 flex items-center gap-1" role="status">
            {toast}
            <LogButton onClick={undo} title="Undo (Ctrl+Z)" className="text-blue-600 dark:text-blue-300 font-medium">
              undo
            </LogButton>
          </span>
        )}
      </div>
    </div>
  );
};

interface BlockRowProps {
  block: TimeBlock;
  accounting: TimeAccounting;
  now: number;
  canMerge: boolean;
  showControls: boolean;
  commit: Commit;
}

const BlockRow = ({ block, accounting, now, canMerge, showControls, commit }: BlockRowProps) => {
  const [editingDuration, setEditingDuration] = useState<string | null>(null);
  const [durationEl, setDurationEl] = useState<HTMLElement | null>(null);
  const open = isOpen(accounting, block.id);
  const live = open && accounting.runningSince != null;
  const ms = liveMs(accounting, block, now);
  const empty = isEmpty(accounting, block);

  // Scroll over a duration to nudge it by a minute (5 with shift)
  useNonPassiveWheelHandler(durationEl, (e: WheelEvent) => {
    e.preventDefault();
    if (e.deltaY === 0) return;
    const step = (e.shiftKey ? 5 : 1) * Minutes;
    commit(setDuration(accounting, block.id, ms + (e.deltaY > 0 ? -step : step), Date.now()), `nudge:${block.id}`);
  });

  const commitDuration = () => {
    if (editingDuration == null) return;
    const parsed = parseDuration(editingDuration, ms);
    if (parsed != null && parsed !== ms)
      commit(setDuration(accounting, block.id, parsed, Date.now()), `duration:${block.id}`);
    setEditingDuration(null);
  };

  return (
    <div className={clsx('flex items-center gap-2 group/row', open && 'text-gray-600 dark:text-gray-300')}>
      <span className="w-10 shrink-0 font-mono tabular-nums text-gray-400 dark:text-gray-600">
        {block.startedAt != null ? formatTime(block.startedAt) : ''}
      </span>

      {editingDuration != null ? (
        <input
          autoFocus
          {...NO_AUTOFILL}
          value={editingDuration}
          onChange={(e) => setEditingDuration(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commitDuration}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitDuration();
            if (e.key === 'Escape') setEditingDuration(null);
          }}
          aria-label="Duration (e.g. 35, 1h5, 32:10, +5)"
          title="e.g. 35 · 1h5 · 32:10 · +5 · -2"
          className="w-14 shrink-0 text-right font-mono tabular-nums bg-gray-100/70 dark:bg-white/10 rounded px-1 outline-none"
        />
      ) : (
        <button
          ref={setDurationEl}
          onClick={() => setEditingDuration(formatClock(ms))}
          title="Click to edit, scroll to nudge"
          aria-label={`Duration ${formatClock(ms)}, click to edit`}
          className={clsx(
            'w-14 shrink-0 text-right font-mono tabular-nums rounded px-1 cursor-text',
            showControls && 'hover:bg-gray-100/50 dark:hover:bg-white/5',
            empty && 'text-gray-300 dark:text-gray-700',
          )}
        >
          {live && <span className="text-red-400 dark:text-red-500 mr-1">•</span>}
          {formatClock(ms)}
        </button>
      )}

      <input
        type="text"
        {...NO_AUTOFILL}
        list={LABELS_DATALIST_ID}
        value={block.label ?? ''}
        placeholder={open ? 'label…' : '—'}
        maxLength={150}
        onChange={(e) => commit(setLabel(accounting, block.id, e.target.value), `label:${block.id}`)}
        onBlur={(e) => {
          const trimmed = e.currentTarget.value.trim();
          if (trimmed !== (block.label ?? '')) commit(setLabel(accounting, block.id, trimmed), `label:${block.id}`);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' || e.key === 'Escape') e.currentTarget.blur();
        }}
        aria-label="Block label"
        className={clsx(
          'bg-transparent border-none outline-none',
          'w-28 min-w-0 truncate rounded px-1',
          'placeholder-gray-300 dark:placeholder-gray-700',
          showControls && 'hover:bg-gray-100/50 dark:hover:bg-white/5',
          'focus:bg-gray-100/70 dark:focus:bg-white/10',
          'transition-colors cursor-text',
        )}
      />

      <span
        className={clsx(
          'flex gap-0.5 opacity-0 group-hover/row:opacity-100 focus-within:opacity-100 transition-opacity',
          !showControls && 'invisible',
        )}
      >
        {canMerge && (
          <RowAction
            onClick={() => commit(mergeIntoPrevious(accounting, block.id), 'merge')}
            title="Merge into previous block"
          >
            <ChevronsDown size={12} />
          </RowAction>
        )}
        {!empty && (
          <RowAction
            onClick={() => commit(removeBlock(accounting, block.id, Date.now()), 'delete', 'Block deleted')}
            title="Delete block"
            className="hover:text-red-400 dark:hover:text-red-400"
          >
            <X size={12} />
          </RowAction>
        )}
      </span>
    </div>
  );
};

const RowAction = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) => (
  <button
    aria-label={props.title}
    className={clsx(
      'p-0.5 rounded cursor-pointer text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-200',
      className,
    )}
    {...props}
  />
);

const LogButton = ({ className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
  <button
    className={clsx(
      'flex items-center gap-0.5 px-1 rounded text-[10px] cursor-pointer transition-colors',
      'text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-200',
      'disabled:opacity-40 disabled:pointer-events-none',
      className,
    )}
    {...props}
  />
);
