import * as math from '@thi.ng/math';
import clsx from 'clsx';
import { ClockFading, HelpCircle, PictureInPicture2, Scan, Share2, TimerReset, Volume2, VolumeX } from 'lucide-react';
import { KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import { AnimatedColon } from './AnimatedColon';
import { ClockFace, ClockFaceHandle } from './ClockFace';
import { HelpScreen } from './HelpScreen';
import { JogDial, JogEvent } from './JogDial';
import { initAudioContext, playRingSound } from './sound-utils';
import {
  formatDuration,
  formatDurationMinutes,
  formatDurationMinutesSr,
  formatDurationSr,
  formatTime,
  formatTimeSr,
  Hour,
  Hours,
  Milliseconds,
  Minute,
  Minutes,
  Seconds,
} from './time-utils';
import { accountTime, setLabel, withOpenBlock } from './TimeBlocks';
import { LABELS_DATALIST_ID, NO_AUTOFILL, TimeLog, useTimeLogUndo } from './TimeLog';
import { TimerModel, TimerModelSchema } from './TimerModel';
import { TimerRestorePoint } from './TimerRestorePoint';
import {
  changeMode,
  changeTime,
  clampDuration,
  runningOrPaused,
  TimerState,
  toPostFinished,
  togglePaused,
  toInteracting,
  toPaused,
} from './TimerState';
import { Toolbar } from './Toolbar';
import { ToolbarButton } from './ToolbarButton';
import { useAnimation } from './useAnimation';
import { useColorScheme } from './useColorScheme';
import { useDeviceCapabilities } from './useDeviceCapabilities';
import { useLocalStorage } from './useLocalStorage';
import { useMultiClick } from './useMultiClick';
import { useNonPassiveWheelHandler } from './useNonPassiveWheelHandler';
import { useTemporaryState } from './useTemporaryState';
import { useWakeLock } from './useWakeLock';

// Interaction state for timer duration adjustments
interface TimerInteraction {
  remainingTime: number;
  hasChanged: boolean;
}

const FPS: Record<TimerState['is'], number> = {
  interacting: 30,
  running: 1,
  paused: 1 / 30,
  finished: 60,
  postFinished: 1 / 30,
};

const MINUTES_MODE_FPS = {
  ...FPS,
  running: 6, // mimic high-resolution stopwatches
};

const DEFAULT_RESTORE_POINT: TimerRestorePoint = Object.freeze({
  minutes: Object.freeze({ duration: 5 * Seconds }),
  hours: Object.freeze({ duration: 10 * Minutes }),
});
const DEFAULT_STATE: TimerState = Object.freeze({
  is: 'paused',
  mode: 'hours',
  remainingTime: DEFAULT_RESTORE_POINT.hours.duration,
});

const SpiralTimer = () => {
  // Device capabilities
  const { isTouchDevice, hasKeyboard, isMobile } = useDeviceCapabilities();
  const [timerModel, saveTimerModel] = useLocalStorage('coil-timer-model', TimerModelSchema, {
    state: DEFAULT_STATE,
    restorePoint: DEFAULT_RESTORE_POINT,
    blocks: [],
    runningSince: null,
  });
  // Every model write goes through time accounting, so running time is tracked whatever changed the timer
  const setTimerModel = useCallback(
    (next: TimerModel) => saveTimerModel(accountTime(timerModel, next, Date.now())),
    [timerModel, saveTimerModel],
  );
  const timeLog = useTimeLogUndo(timerModel, (next) => setTimerModel({ ...timerModel, ...next }));
  const timerState = timerModel.state;
  const restorePoint = timerModel.restorePoint;
  const scheme = useColorScheme();

  // Reset postFinished on reload (don't show completion buttons on page load)
  useEffect(() => {
    if (timerState.is === 'postFinished') {
      const mode = timerState.mode;
      setTimerModel({ ...timerModel, state: { is: 'paused', mode, remainingTime: restorePoint[mode].duration } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const labelInputRef = useRef<HTMLInputElement>(null);

  const [srTimeEl, setSrTimeEl] = useState<HTMLElement | null>(null);
  const [timeEl, setTimeEl] = useState<HTMLElement | null>(null);
  const [endTimeEl, setEndTimeEl] = useState<HTMLElement | null>(null);
  const [precision, setPrecision] = useState<string>('');
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [jogDial, setJogDial] = useState<HTMLButtonElement | null>(null);
  const [clockFace, setClockFace] = useState<ClockFaceHandle | null>(null);
  const [wasModeRecentlyChanged, setWasModeRecentlyChanged] = useTemporaryState(false, 2 * Seconds);
  const [mustShowControls, setMustShowControls] = useTemporaryState(false, 5 * Seconds);
  const [isHelpVisible, setIsHelpVisible] = useState(false);
  const [clockRadius, setClockRadius] = useState<number | null>(null);
  const [timeLogEl, setTimeLogEl] = useState<HTMLDivElement | null>(null);
  const timeLogSize = useElementSize(timeLogEl);
  const viewport = useViewportSize();
  const clockTop = clockOffsetForLog(viewport, timeLogSize);

  // Track window focus — used to hide decorative UI after a delay when window loses focus
  const [windowFocused, setWindowFocused] = useState(true);
  useEffect(() => {
    let blurTimer: ReturnType<typeof setTimeout>;
    const onFocus = () => {
      clearTimeout(blurTimer);
      setWindowFocused(true);
    };
    const onBlur = () => {
      blurTimer = setTimeout(() => setWindowFocused(false), 3000);
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      clearTimeout(blurTimer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);
  const [isMuted, setIsMuted] = useState(() => {
    try {
      return localStorage.getItem('coil-timer-muted') === 'true';
    } catch {
      return false;
    }
  });

  // Persist mute state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('coil-timer-muted', isMuted.toString());
    } catch {
      // Silently fail if localStorage is not available
    }
  }, [isMuted]);

  useWakeLock({ enable: timerState.is === 'running' });

  const timerInteractionRef = useRef<TimerInteraction | null>(null);
  const isOrWas = 'was' in timerState ? timerState.was : timerState.is;

  useEffect(() => {
    setWasModeRecentlyChanged(true);
  }, [timerState.mode, setWasModeRecentlyChanged]);

  useEffect(() => {
    setMustShowControls(true);
  }, [timerState.is, setMustShowControls]);

  // (Bell is played directly in runFrame at the running→postFinished transition)

  // Show "0" in the main display when postFinished (total is shown separately below)
  useEffect(() => {
    if (timerState.is !== 'postFinished') return;
    if (timeEl) {
      timeEl.textContent = zerosAsOs(timerState.mode === 'hours' ? formatDuration(0) : formatDurationMinutes(0));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerState.is, timeEl]);

  const clampTime = useCallback(
    (time: number) => {
      const maxTime = timerState.mode === 'hours' ? 24 * Hours : 20 * Minutes;
      return math.clamp(time, 0, maxTime);
    },
    [timerState.mode],
  );

  const runFrame = useCallback(() => {
    let remainingTime: number;
    let endTime: number | null;

    if (timerState.is === 'interacting') {
      remainingTime = timerInteractionRef.current!.remainingTime;
      endTime = remainingTime + Date.now();
    } else if (timerState.is === 'running') {
      endTime = timerState.endTime;
      remainingTime = timerState.endTime - Date.now();
      if (remainingTime <= 0) {
        if (!isMuted) playRingSound();
        const nextState = toPostFinished(timerState);
        // accountTime banks the run (up to endTime) and closes the block
        setTimerModel({ ...timerModel, state: nextState });
        return;
      }
    } else if (timerState.is === 'finished') {
      const deltaTime = 16.67;
      const animationComplete = clockFace?.stepVictory(deltaTime) ?? false;
      remainingTime = 0;
      endTime = null;
      if (animationComplete) {
        setTimerModel({ ...timerModel, state: toPaused(timerState) });
        return;
      }
    } else if (timerState.is === 'postFinished') {
      // timeEl is driven by the elapsedOverrun interval, not runFrame
      clockFace?.draw(0);
      return;
    } else if (timerState.is === 'paused') {
      endTime = timerState.remainingTime + Date.now();
      remainingTime = timerState.remainingTime;
    } else {
      throw new Error(`Unknown state: ${timerState}`);
    }

    clockFace?.draw(remainingTime);

    const roundedDuration = math.roundTo(remainingTime, timerState.mode === 'hours' ? Minutes : Seconds);

    if (timerState.mode === 'hours') {
      setPrecision(roundedDuration >= 1 * Hour ? 'h:min' : 'min');
    } else {
      setPrecision(roundedDuration >= 1 * Minute ? "min'sec" : 'sec');
    }

    if (srTimeEl && endTime != null) {
      if (timerState.mode === 'hours') {
        srTimeEl.textContent = `${formatDurationSr(roundedDuration)} (${formatTimeSr(endTime)})`;
      } else {
        srTimeEl.textContent = `${formatDurationMinutesSr(roundedDuration)} (${formatTimeSr(endTime)})`;
      }
    }

    if (timeEl) {
      if (timerState.mode === 'hours') {
        timeEl.textContent = zerosAsOs(formatDuration(roundedDuration));
      } else {
        timeEl.textContent = zerosAsOs(formatDurationMinutes(roundedDuration));
      }
    }

    if (endTimeEl && endTime != null) {
      endTimeEl.textContent = zerosAsOs(formatTime(endTime));
    }
  }, [timerState, clockFace, srTimeEl, timeEl, endTimeEl, timerModel, setTimerModel, isMuted]);

  const fpsMap = timerState.mode === 'hours' ? FPS : MINUTES_MODE_FPS;
  useAnimation({ runFrame, fps: fpsMap[timerState.is] });

  // ── JogDial handlers ──────────────────────────────────────────────────────

  const handleJogStart = () => {
    if (timerState.is === 'interacting' || timerState.is === 'finished') return;
    // Dragging in postFinished acts as an implicit "continue" — dismiss the
    // completion screen and start adjusting time immediately.
    if (timerState.is === 'postFinished') {
      const startingRemaining = restorePoint[timerState.mode].duration;
      initAudioContext();
      timerInteractionRef.current = { remainingTime: startingRemaining, hasChanged: false };
      const baseState = { is: 'paused' as const, mode: timerState.mode, remainingTime: startingRemaining };
      setTimerModel({ ...timerModel, state: toInteracting(baseState) });
      return;
    }
    const remainingTime = timerState.is === 'running' ? timerState.endTime - Date.now() : timerState.remainingTime;
    initAudioContext();
    timerInteractionRef.current = { remainingTime, hasChanged: false };
    setTimerModel({ ...timerModel, state: toInteracting(timerState) });
  };

  const handleJogMove = (event: JogEvent) => {
    if (timerState.is !== 'interacting' || !timerInteractionRef.current) return;
    const timePerRevolution = timerState.mode === 'hours' ? 1 * Hour : 1 * Minute;
    const deltaTime = (event.deltaAngle / math.TAU) * timePerRevolution;
    const newDuration = clampTime(timerInteractionRef.current.remainingTime + deltaTime);
    timerInteractionRef.current.remainingTime = newDuration;
    timerInteractionRef.current.hasChanged = event.wasDragged;
  };

  const handleJogEnd = (event: JogEvent) => {
    if (timerState.is !== 'interacting' || !timerInteractionRef.current) return;
    const { remainingTime } = timerInteractionRef.current;

    if (event.wasDragged) {
      const newRemainingTime = clampDuration(timerState.mode, remainingTime);
      const nextRestorePoint: TimerRestorePoint =
        timerState.was === 'paused' && remainingTime > 0
          ? { ...restorePoint, [timerState.mode]: { duration: newRemainingTime } }
          : restorePoint;

      // If dragged to zero, pause instead of starting
      if (newRemainingTime === 0) {
        const nextState = { is: 'paused' as const, mode: timerState.mode, remainingTime: 0 };
        setTimerModel({ ...timerModel, state: nextState, restorePoint: nextRestorePoint });
      } else {
        // After dragging to non-zero, start the timer
        const nextState = runningOrPaused('running', timerState.mode, newRemainingTime);
        setTimerModel({ ...timerModel, state: nextState, restorePoint: nextRestorePoint });
      }
    } else {
      // Tap: toggle pause/resume
      if (timerState.was === 'paused' && remainingTime === 0) {
        setTimerModel({
          ...timerModel,
          state: runningOrPaused('paused', timerState.mode, restorePoint[timerState.mode].duration),
        });
      } else {
        const nextState = timerState.was === 'running' ? 'paused' : 'running';
        setTimerModel({ ...timerModel, state: runningOrPaused(nextState, timerState.mode, remainingTime) });
      }
    }
  };

  const restoreFromLastSetDuration = () => {
    if (timerState.is !== 'paused') return;
    setTimerModel({
      ...timerModel,
      state: runningOrPaused('paused', timerState.mode, restorePoint[timerState.mode].duration),
    });
  };

  const handleJogKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (timerState.is !== 'running' && timerState.is !== 'paused') return;
    initAudioContext();

    if (event.key === 'Enter' || event.key === ' ') {
      if (timerState.is === 'paused' && timerState.remainingTime === 0) {
        restoreFromLastSetDuration();
      } else {
        setTimerModel({ ...timerModel, state: togglePaused(timerState) });
      }
      return;
    }

    const stepSize =
      timerState.mode === 'hours'
        ? { small: 1 * Minute, medium: 5 * Minutes, large: 1 * Hour }
        : { small: 5 * Seconds, medium: 30 * Seconds, large: 5 * Minutes };

    let nextState: TimerState | null = null;
    switch (event.key) {
      case 'ArrowUp':
        nextState = changeTime(timerState.mode, timerState, event.shiftKey ? stepSize.large : stepSize.medium);
        break;
      case 'ArrowDown':
        nextState = changeTime(timerState.mode, timerState, event.shiftKey ? -stepSize.large : -stepSize.medium);
        break;
      case 'ArrowRight':
        nextState = changeTime(timerState.mode, timerState, event.shiftKey ? stepSize.medium : stepSize.small);
        break;
      case 'ArrowLeft':
        nextState = changeTime(timerState.mode, timerState, event.shiftKey ? -stepSize.medium : -stepSize.small);
        break;
    }
    if (nextState) {
      const nextRestorePoint =
        nextState.is === 'paused'
          ? { ...restorePoint, [timerState.mode]: { duration: nextState.remainingTime } }
          : restorePoint;
      setTimerModel({ ...timerModel, state: nextState, restorePoint: nextRestorePoint });
    }
  };

  // ── Label input ───────────────────────────────────────────────────────────

  const handleSessionNameKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      // Move focus to the jog dial so user can drag without clicking elsewhere
      jogDial?.focus();
    }
    // Stop key events from reaching the JogDial behind the input
    e.stopPropagation();
  };

  // ── Misc handlers ─────────────────────────────────────────────────────────

  const handleBackgroundClicks = useMultiClick({
    single: () => {
      initAudioContext();
      setMustShowControls((value) => !value);
    },
    double: () => toggleFullscreen(),
    interval: 250 * Milliseconds,
  });

  const toggleFullscreen = () => {
    // requestFullscreen is missing on iOS Safari and rejects if not permitted
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
    }
  };

  // Browsers won't shrink a regular tab window below ~500px wide, but popup windows can go
  // much smaller. Timer state syncs between windows via localStorage `storage` events.
  const canPopOut = !isMobile && !isPopoutWindow();
  const openPopout = () => {
    const size = 320;
    const left = Math.max(0, window.screenX + window.outerWidth - size - 40);
    const top = Math.max(0, window.screenY + 80);
    const popup = window.open(
      window.location.href,
      POPOUT_WINDOW_NAME,
      `popup,width=${size},height=${size},left=${left},top=${top}`,
    );
    popup?.focus();
  };

  const toggleTimerMode = () => {
    if (timerState.is !== 'paused') return;
    const nextMode = timerState.mode === 'hours' ? 'minutes' : 'hours';
    const fallbackDuration = restorePoint[nextMode].duration;
    setTimerModel({ ...timerModel, state: changeMode(timerState, nextMode, fallbackDuration) });
  };

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      // Let the time log scroll (and handle its own wheel nudges)
      if ((e.target as Element | null)?.closest?.('[data-time-log]')) return;
      e.preventDefault();
      if (timerState.is !== 'running' && timerState.is !== 'paused') return;
      const delta = e.deltaY;
      const change =
        timerState.mode === 'hours'
          ? e.shiftKey
            ? 5 * Minutes
            : 30 * Seconds
          : e.shiftKey
            ? 30 * Seconds
            : 5 * Seconds;
      setTimerModel({ ...timerModel, state: changeTime(timerState.mode, timerState, delta > 0 ? -change : change) });
    },
    [setTimerModel, timerModel, timerState],
  );
  useNonPassiveWheelHandler(container, handleWheel);

  const handleShare = navigator.share
    ? () => {
        navigator
          .share({
            title: document.title,
            text: 'Distraction-free visual timer',
            url: window.location.href,
          })
          .catch(() => {
            /* user cancelled */
          });
      }
    : null;

  // ── Derived state ─────────────────────────────────────────────────────────

  const controlsAreVisible = timerState.is === 'paused' || mustShowControls || timerState.is === 'postFinished';
  // When the window isn't focused, show only the clock and the time log
  const showButtons = controlsAreVisible && !isHelpVisible && windowFocused;
  const hint = timerState.is === 'interacting' ? 'end-time' : wasModeRecentlyChanged ? 'precision' : null;

  const blocks = withOpenBlock(timerModel.blocks);
  const openBlock = blocks.at(-1)!;
  // On the completion screen, show the block that the bell just closed
  const finishedBlock = timerState.is === 'postFinished' ? blocks.at(-2) : undefined;

  // The label input above the dial edits the open block's label
  const showNameInput = timerState.is === 'paused' || timerState.is === 'running' || timerState.is === 'postFinished';

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={setContainer}
      className={clsx('h-screen overflow-hidden relative', 'text-white', 'bg-white dark:bg-black')}
      style={{ '--clock-diameter': `${(clockRadius ?? 100) * 2}px` } as React.CSSProperties}
      onClick={handleBackgroundClicks}
    >
      {/* Clock face */}
      <div
        className={clsx('absolute left-0 w-[100vw]', 'breathe-animation', 'transition-opacity')}
        style={{ top: clockTop, height: `calc(100vh - ${clockTop}px)` }}
      >
        {scheme.effective && (
          <ClockFace
            ref={setClockFace}
            className={clsx(
              'stroke-red-400 dark:stroke-red-500',
              'decoration-gray-700 dark:decoration-white',
              'text-gray-600 dark:text-gray-200',
              'fill-red-100 dark:fill-red-900',
              'bg-white dark:bg-black',
            )}
            colorScheme={scheme.effective}
            initialTime={timerState.is === 'paused' ? timerState.remainingTime : 0}
            onClockRadiusChange={setClockRadius}
            mode={timerState.mode}
            isRunning={isOrWas === 'running'}
          />
        )}

        <JogDial
          ref={setJogDial}
          aria-label={(() => {
            if (isTouchDevice && !hasKeyboard)
              return isOrWas === 'paused'
                ? 'Timer control: tap to start, drag to adjust time'
                : 'Timer control: tap to pause, drag to adjust time';
            if (hasKeyboard && !isTouchDevice)
              return isOrWas === 'paused'
                ? 'Timer control: press space or enter to start, arrow keys to adjust time'
                : 'Timer control: press space or enter to pause, arrow keys to adjust time';
            if (isTouchDevice && hasKeyboard)
              return isOrWas === 'paused'
                ? 'Timer control: tap or press space/enter to start, drag or use arrow keys to adjust time'
                : 'Timer control: tap or press space/enter to pause, drag or use arrow keys to adjust time';
            return isOrWas === 'paused'
              ? 'Timer control: activate to start, adjust time'
              : 'Timer control: activate to pause, adjust time';
          })()}
          title="Timer control"
          className={clsx(
            'absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2',
            'w-(--clock-diameter) h-(--clock-diameter) rounded-full',
            'leading-none font-[Inconsolata,monospace]',
            'text-gray-600 dark:text-gray-300 dark:text-shadow-lg/30',
            'transition-opacity duration-500',
            'opacity-100',
          )}
          onJogStart={handleJogStart}
          onJogMove={handleJogMove}
          onJogEnd={handleJogEnd}
          onKeyDown={handleJogKey}
        >
          {/* Screen-reader live region */}
          <span ref={setSrTimeEl} className="sr-only" aria-live="polite" aria-atomic="true" />

          {/* Time display */}
          <span
            aria-hidden="true"
            className="pointer-events-none flex items-center justify-center text-[calc(min(10vh,10vw))]"
          >
            <span ref={setTimeEl} />
            <span className="pointer-events-none inline-block w-0 flex items-baseline">
              <AnimatedColon isRunning={timerState.is === 'running' && windowFocused} />
            </span>
          </span>

          {/* Total duration shown below the dial in postFinished */}
          {finishedBlock && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-[calc(50%+3.5rem)] left-1/2 -translate-x-1/2 text-sm font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap"
            >
              {formatTotalDuration(finishedBlock.ms)}
              {finishedBlock.label && (
                <span className="text-gray-400 dark:text-gray-500"> · {finishedBlock.label}</span>
              )}
            </span>
          )}

          {/* End-time hint */}
          <span aria-hidden="true" className="pointer-events-none block h-0 text-[calc(min(5vh,5vw))]">
            <span
              ref={setEndTimeEl}
              className={clsx(
                'text-gray-500 dark:text-gray-400',
                'transition-opacity duration-500',
                hint === 'end-time' ? 'opacity-100 delay-2000' : 'opacity-0',
              )}
            >
              --
            </span>
          </span>

          {/* Precision hint */}
          <span className="pointer-events-none block h-0 text-[calc(min(5vh,5vw))]">
            <span
              className={clsx(
                'font-sans font-light',
                'text-gray-500 dark:text-gray-400',
                'transition-opacity duration-500',
                hint === 'precision' ? 'opacity-100' : 'opacity-0 delay-2000',
              )}
            >
              {precision}
            </span>
          </span>
        </JogDial>

        {/* ── Session name input ── shown when paused or after completion */}
        {showNameInput && (
          <div
            className="absolute top-[calc(50%-min(10rem,var(--clock-diameter)*0.3))] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={labelInputRef}
              type="text"
              {...NO_AUTOFILL}
              list={LABELS_DATALIST_ID}
              value={openBlock.label ?? ''}
              onChange={(e) =>
                timeLog.commit(setLabel(timerModel, openBlock.id, e.target.value), `label:${openBlock.id}`)
              }
              onBlur={(e) => {
                const trimmed = e.currentTarget.value.trim();
                if (trimmed !== (openBlock.label ?? ''))
                  timeLog.commit(setLabel(timerModel, openBlock.id, trimmed), `label:${openBlock.id}`);
              }}
              onKeyDown={handleSessionNameKeyDown}
              aria-label="Label for the current block"
              placeholder={windowFocused ? 'What are you working on?' : ''}
              maxLength={150}
              className={clsx(
                'w-56 text-center bg-transparent',
                'text-gray-700 dark:text-gray-300 placeholder-gray-400 dark:placeholder-gray-600',
                'text-sm font-medium',
                'border-b border-transparent',
                'hover:border-gray-300 dark:hover:border-gray-600',
                'focus:border-gray-400 dark:focus:border-gray-500',
                'focus:outline-none',
                'transition-colors duration-200',
                'py-1',
              )}
            />
          </div>
        )}
      </div>

      {/* ── Help overlay ── */}
      <HelpScreen
        isHelpVisible={isHelpVisible}
        bgAction={timerState.is === 'running' ? 'controls' : null}
        jogDialAction={
          timerState.is === 'interacting'
            ? null
            : timerState.is === 'running'
              ? 'pause'
              : timerState.is === 'paused'
                ? timerState.remainingTime > 0
                  ? 'resume'
                  : 'reset'
                : null
        }
        onCloseClicked={() => {
          setIsHelpVisible(false);
          setTimeout(() => jogDial?.focus());
        }}
      />

      {/* ── Top-left toolbar (mode + restore) ── */}
      <Toolbar ariaLabel="Timer controls" isVisible={showButtons}>
        <ToolbarButton
          onClick={toggleTimerMode}
          aria-label={`Switch to ${timerState.mode === 'hours' ? 'minutes' : 'hours'} mode`}
          title={`Switch to ${timerState.mode === 'hours' ? 'minutes' : 'hours'} mode`}
          disabled={isOrWas !== 'paused'}
        >
          {timerState.mode === 'hours' ? <ClockFading size={24} /> : <TimerReset size={24} />}
        </ToolbarButton>
      </Toolbar>

      {/* ── Bottom-right: visual/audio controls ── */}
      <Toolbar ariaLabel="Visual controls" isVisible={showButtons} position="bottom-right">
        <ToolbarButton
          aria-label={document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'}
          title="Fullscreen"
          onClick={toggleFullscreen}
        >
          <Scan size={24} />
        </ToolbarButton>

        {canPopOut && (
          <ToolbarButton aria-label="Open in a small resizable window" title="Pop out" onClick={openPopout}>
            <PictureInPicture2 size={24} />
          </ToolbarButton>
        )}

        <ToolbarButton
          onClick={() => {
            initAudioContext();
            setIsMuted(!isMuted);
          }}
          aria-label={isMuted ? 'Unmute' : 'Mute'}
          title={isMuted ? 'Unmute' : 'Mute'}
          className="relative"
        >
          <Volume2
            size={24}
            className={clsx('transition-opacity duration-200', !isMuted ? 'opacity-100' : 'opacity-0')}
          />
          <VolumeX
            className={clsx('absolute inset-0 transition-opacity duration-200', isMuted ? 'opacity-100' : 'opacity-0')}
          />
        </ToolbarButton>
      </Toolbar>

      {/* ── Bottom-left: help & share ── */}
      <Toolbar ariaLabel="Help etc." isVisible={showButtons} position="bottom-left">
        <ToolbarButton
          onClick={() => setIsHelpVisible(true)}
          aria-label={isHelpVisible ? 'Hide instructions' : 'Show instructions'}
          title="Help"
        >
          <HelpCircle size={24} />
        </ToolbarButton>

        {handleShare && (
          <ToolbarButton onClick={handleShare} aria-label="Share this app" title="Share">
            <Share2 size={24} />
          </ToolbarButton>
        )}
      </Toolbar>

      {/* ── Time log — top-left ── */}
      {/* Always mounted (it hides itself when empty) so undo and the N shortcut survive */}
      <TimeLog
        ref={setTimeLogEl}
        className={clsx('absolute top-4 left-4 z-20', isHelpVisible && 'hidden')}
        showControls={windowFocused}
        accounting={timerModel}
        commit={timeLog.commit}
        undo={timeLog.undo}
        toast={timeLog.toast}
        onSplit={() => setTimeout(() => labelInputRef.current?.focus(), 0)}
      />
    </div>
  );
};

export default SpiralTimer;

const POPOUT_WINDOW_NAME = 'coil-timer-popout';
const isPopoutWindow = () => window.name === POPOUT_WINDOW_NAME;

const zerosAsOs = (text: string) => text.replaceAll('0', 'O');

/**
 * Friendly total duration regardless of mode — shows all non-zero units.
 * e.g. "1h 22 min 30 sec", "52 min 30 sec", "45 sec"
 */
const formatTotalDuration = (ms: number): string => {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m} min`);
  if (s > 0 || parts.length === 0) parts.push(`${s} sec`);
  return parts.join(' ');
};

const TIME_LOG_INSET = 16;
const TIME_LOG_GAP = 12;

/** How far to push the clock down so it doesn't overlap the time log (0 if there's room beside it). */
const clockOffsetForLog = (viewport: Size, log: Size): number => {
  if (log.width === 0 || log.height === 0) return 0;
  const radius = (Math.min(viewport.width, viewport.height) / 2) * 0.9; // ClockFace's outer tick diameter
  const cx = viewport.width / 2;
  const cy = viewport.height / 2;
  const right = TIME_LOG_INSET + log.width;
  const bottom = TIME_LOG_INSET + log.height;
  // Distance from the clock's center to the nearest point of the log's box
  const dx = cx - Math.min(cx, right);
  const dy = cy - Math.min(cy, bottom);
  if (Math.hypot(dx, dy) > radius + TIME_LOG_GAP) return 0;
  return bottom + TIME_LOG_GAP;
};

type Size = { width: number; height: number };

const useElementSize = (el: HTMLElement | null): Size => {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(() => setSize({ width: el.offsetWidth, height: el.offsetHeight }));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return size;
};

const useViewportSize = (): Size => {
  const [size, setSize] = useState<Size>(() => ({ width: window.innerWidth, height: window.innerHeight }));
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return size;
};
