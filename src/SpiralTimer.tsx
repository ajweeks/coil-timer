import * as math from '@thi.ng/math';
import clsx from 'clsx';
import {
  CircleCheck,
  ClockFading,
  Eraser,
  HelpCircle,
  Moon,
  RotateCw,
  Scan,
  Share2,
  Sun,
  SunMoon,
  TimerReset,
  Volume2,
  VolumeX,
} from 'lucide-react';
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
import { TimerModelSchema } from './TimerModel';
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
  const { isTouchDevice, hasKeyboard } = useDeviceCapabilities();
  const [timerModel, setTimerModel] = useLocalStorage('coil-timer-model', TimerModelSchema, {
    state: DEFAULT_STATE,
    restorePoint: DEFAULT_RESTORE_POINT,
    sessionHistory: [],
    accumulatedMs: 0,
  });
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

  // Session name: purely local until the user presses Log
  const [sessionName, setSessionName] = useState('');
  const sessionInputRef = useRef<HTMLInputElement>(null);

  // Live pending duration for the current session (updates every second when running)
  const [pendingDuration, setPendingDuration] = useState(0);
  // Tracks elapsed time of the current partial run (preserved across pauses)
  const [partialRunMs, setPartialRunMs] = useState(0);
  const partialRunMsRef = useRef(partialRunMs);

  useEffect(() => {
    partialRunMsRef.current = partialRunMs;
  }, [partialRunMs]);

  const [srTimeEl, setSrTimeEl] = useState<HTMLElement | null>(null);
  const [timeEl, setTimeEl] = useState<HTMLElement | null>(null);
  const [endTimeEl, setEndTimeEl] = useState<HTMLElement | null>(null);
  const [precision, setPrecision] = useState<string>('');
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [jogDial, setJogDial] = useState<HTMLButtonElement | null>(null);
  const [clockFace, setClockFace] = useState<ClockFaceHandle | null>(null);
  const [wasModeRecentlyChanged, setWasModeRecentlyChanged] = useTemporaryState(false, 2 * Seconds);
  const [wasRecentlySaved, setWasRecentlySaved] = useTemporaryState(false, 2 * Seconds);
  const [mustShowControls, setMustShowControls] = useTemporaryState(false, 5 * Seconds);
  const [isHelpVisible, setIsHelpVisible] = useState(false);
  const [clockRadius, setClockRadius] = useState<number | null>(null);

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
  const timerStateIsRef = useRef(timerState.is);

  const hasMounted = useRef(false);
  useEffect(() => {
    timerStateIsRef.current = timerState.is;
  }, [timerState.is]);
  useEffect(() => {
    if (hasMounted.current) {
      setWasRecentlySaved(true);
    } else {
      hasMounted.current = true;
    }
  }, [restorePoint, setWasRecentlySaved]);

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

  // Track when the current run segment started (to accumulate partial time correctly)
  const runSegmentStartRef = useRef<number | null>(null);
  const runStartedAt = timerState.is === 'running' ? timerState.startedAt : null;

  // Accumulate partial run time across state transitions
  useEffect(() => {
    if (runStartedAt !== null) {
      // Entered running: start tracking this segment
      if (runSegmentStartRef.current === null) runSegmentStartRef.current = runStartedAt;
    } else if (timerState.is === 'postFinished') {
      // Finished: partial time has been folded into accumulatedMs by runFrame
      setPartialRunMs(0);
      partialRunMsRef.current = 0;
      runSegmentStartRef.current = null;
    } else if (runSegmentStartRef.current !== null) {
      // Left running (paused, or interacting — tap/drag goes via interacting): bank the segment
      const next = partialRunMsRef.current + (Date.now() - runSegmentStartRef.current);
      partialRunMsRef.current = next;
      setPartialRunMs(next);
      runSegmentStartRef.current = null;
    }
  }, [timerState.is, runStartedAt]);

  // Reset partialRunMs when accumulatedMs is reset (after logging)
  const prevAccumulatedRef = useRef(timerModel.accumulatedMs ?? 0);
  useEffect(() => {
    const accumulated = timerModel.accumulatedMs ?? 0;
    const prevAccumulated = prevAccumulatedRef.current;

    if (accumulated === 0 && prevAccumulated !== 0) {
      setPartialRunMs(0);
      partialRunMsRef.current = 0;
      runSegmentStartRef.current = null;
    }

    prevAccumulatedRef.current = accumulated;
  }, [timerModel.accumulatedMs]);

  // Update pending duration every second for the history list
  useEffect(() => {
    const tick = () => {
      const accumulated = timerModel.accumulatedMs ?? 0;
      if (timerStateIsRef.current === 'running' && runSegmentStartRef.current !== null) {
        const segmentElapsed = Date.now() - runSegmentStartRef.current;
        setPendingDuration(accumulated + partialRunMsRef.current + segmentElapsed);
      } else {
        setPendingDuration(accumulated + partialRunMsRef.current);
      }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timerState.is, timerModel.accumulatedMs, partialRunMs]);

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
        // completedDuration only covers the final run segment; earlier segments
        // (before any pauses) live in partialRunMs until now.
        setTimerModel({
          ...timerModel,
          accumulatedMs: (timerModel.accumulatedMs ?? 0) + partialRunMsRef.current + nextState.completedDuration,
          state: nextState,
        });
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
      // Do NOT add overflow time — accumulatedMs already has the pure running total.
      setTimerModel({
        ...timerModel,
        state: toInteracting(baseState),
      });
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

      // If dragged to zero, pause instead of starting (allows logging accumulated time)
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

  const resetToDefault = () => {
    if (timerState.is !== 'paused') return;
    const mode = timerState.mode;
    const nextRestorePoint = { ...restorePoint, [mode]: DEFAULT_RESTORE_POINT[mode] };
    const nextState = runningOrPaused('paused', mode, DEFAULT_RESTORE_POINT[mode].duration);
    setTimerModel({ ...timerModel, restorePoint: nextRestorePoint, state: nextState });
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

    if (event.key === 'Escape') {
      restoreFromLastSetDuration();
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

  // ── Session actions ───────────────────────────────────────────────────────

  /** Log the completed session, then reset to idle so user can start a new one. */
  const handleLogSession = () => {
    if (timerState.is !== 'postFinished' && !(timerState.is === 'paused' && timerState.remainingTime === 0)) return;
    // accumulatedMs + partialRunMs holds the exact running time
    const totalMs = (timerModel.accumulatedMs ?? 0) + partialRunMs;
    const newEntry = {
      id: Date.now().toString(),
      duration: totalMs,
      mode: timerState.mode,
      name: sessionName.trim() || undefined,
      timestamp: Date.now(),
    };
    setTimerModel({
      ...timerModel,
      sessionHistory: [...(timerModel.sessionHistory ?? []), newEntry],
      accumulatedMs: 0,
      state: { is: 'paused', mode: timerState.mode, remainingTime: restorePoint[timerState.mode].duration },
    });
    setSessionName('');
    setTimeout(() => sessionInputRef.current?.focus(), 50);
  };

  /** Dismiss the completion screen and go back to paused with restore point duration. */
  const handleContinueSession = () => {
    if (timerState.is !== 'postFinished' && !(timerState.is === 'paused' && timerState.remainingTime === 0)) return;
    setTimerModel({
      ...timerModel,
      state: { is: 'paused', mode: timerState.mode, remainingTime: restorePoint[timerState.mode].duration },
    });
  };

  const handleSessionNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.value.length <= 150) setSessionName(e.target.value);
  };

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

  const cycleColorScheme = () => {
    const nextScheme = scheme.selected === 'light' ? 'dark' : scheme.selected === 'dark' ? 'auto' : 'light';
    scheme.update(nextScheme);
  };

  const toggleTimerMode = () => {
    if (timerState.is !== 'paused') return;
    const nextMode = timerState.mode === 'hours' ? 'minutes' : 'hours';
    const fallbackDuration = restorePoint[nextMode].duration;
    setTimerModel({ ...timerModel, state: changeMode(timerState, nextMode, fallbackDuration) });
  };

  const handleWheel = useCallback(
    (e: WheelEvent) => {
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
  const hint = timerState.is === 'interacting' ? 'end-time' : wasModeRecentlyChanged ? 'precision' : null;

  // (session name is shown in the always-visible input above the dial — no redundant label on dial)

  // Show the name input when idle, running, or after completion (always editable)
  const showNameInput = timerState.is === 'paused' || timerState.is === 'running' || timerState.is === 'postFinished';

  const resetBehavior =
    timerState.is !== 'paused'
      ? null
      : timerState.remainingTime !== restorePoint[timerState.mode].duration
        ? 'restore'
        : restorePoint[timerState.mode].duration !== DEFAULT_RESTORE_POINT[timerState.mode].duration
          ? 'reset-to-default'
          : null;

  const sessionHistory = timerModel.sessionHistory ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={setContainer}
      className={clsx('h-screen overflow-hidden', 'text-white', 'flex flex-col items-center justify-center')}
      style={{ '--clock-diameter': `${(clockRadius ?? 100) * 2}px` } as React.CSSProperties}
      onClick={handleBackgroundClicks}
    >
      {/* Clock face */}
      <div className={clsx('w-[100vw] h-[100vh] relative', 'breathe-animation', 'transition-opacity')}>
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
            'absolute top-[50vh] left-[50vw] transform -translate-x-1/2 -translate-y-1/2',
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
          {timerState.is === 'postFinished' &&
            (() => {
              const totalMs = timerModel.accumulatedMs ?? 0;
              return (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute top-[calc(50%+3.5rem)] left-1/2 -translate-x-1/2 text-sm font-medium text-gray-600 dark:text-gray-300"
                >
                  {formatTotalDuration(totalMs)}
                </span>
              );
            })()}

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
            className="absolute top-[calc(50vh-10rem)] left-1/2 -translate-x-1/2 flex flex-col items-center gap-1 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={sessionInputRef}
              type="text"
              value={sessionName}
              onChange={handleSessionNameChange}
              onKeyDown={handleSessionNameKeyDown}
              placeholder={windowFocused ? 'Session name…' : ''}
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
            {sessionName.length > 140 && (
              <p className="text-xs text-gray-400 dark:text-gray-500">{sessionName.length}/150</p>
            )}
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
      <Toolbar ariaLabel="Timer controls" isVisible={controlsAreVisible && !isHelpVisible}>
        <ToolbarButton
          onClick={toggleTimerMode}
          aria-label={`Switch to ${timerState.mode === 'hours' ? 'minutes' : 'hours'} mode`}
          title={`Switch to ${timerState.mode === 'hours' ? 'minutes' : 'hours'} mode`}
          disabled={isOrWas !== 'paused'}
        >
          {timerState.mode === 'hours' ? <ClockFading size={24} /> : <TimerReset size={24} />}
        </ToolbarButton>

        <ToolbarButton
          onClick={() => {
            if (resetBehavior === 'reset-to-default') resetToDefault();
            else if (resetBehavior === 'restore') restoreFromLastSetDuration();
            jogDial?.focus();
          }}
          aria-label={
            resetBehavior === 'reset-to-default' ? 'Reset to default duration' : 'Restore from last set duration'
          }
          title={resetBehavior === 'reset-to-default' ? 'Reset' : 'Restore last'}
          disabled={resetBehavior == null}
          highlight={wasRecentlySaved}
          className="relative"
        >
          {resetBehavior === 'reset-to-default' ? (
            <Eraser size={24} />
          ) : (
            <RotateCw className="transform -rotate-45" size={24} />
          )}
          <CircleCheck
            className={clsx(
              'absolute -top-1 -right-1',
              'text-blue-600 dark:text-blue-300 fill-white dark:fill-black',
              'transition-all duration-200',
              wasRecentlySaved ? 'opacity-100' : 'opacity-0',
            )}
            size={16}
            strokeWidth={(2 * 24) / 16}
          />
        </ToolbarButton>
      </Toolbar>

      {/* ── Bottom-center: Log & Continue (when finished or paused at zero with accumulated time) ── */}
      <Toolbar
        ariaLabel="Session complete"
        isVisible={
          !isHelpVisible &&
          (timerState.is === 'postFinished' ||
            (timerState.is === 'paused' &&
              timerState.remainingTime === 0 &&
              (timerModel.accumulatedMs ?? 0) + partialRunMs > 0))
        }
        position="bottom-center"
      >
        <ToolbarButton onClick={handleLogSession} aria-label="Log this session" title="Log session">
          <CircleCheck size={24} />
          <span className="ml-2 text-sm font-medium">Log</span>
        </ToolbarButton>

        <ToolbarButton onClick={handleContinueSession} aria-label="Continue without logging" title="Continue">
          <RotateCw size={24} />
          <span className="ml-2 text-sm font-medium">Continue</span>
        </ToolbarButton>
      </Toolbar>

      {/* ── Bottom-right: visual/audio controls ── */}
      <Toolbar ariaLabel="Visual controls" isVisible={controlsAreVisible && !isHelpVisible} position="bottom-right">
        <ToolbarButton
          aria-label={document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen'}
          title="Fullscreen"
          onClick={toggleFullscreen}
        >
          <Scan size={24} />
        </ToolbarButton>

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

        <ToolbarButton
          onClick={cycleColorScheme}
          aria-label={`Switch to ${scheme.selected === 'light' ? 'dark' : scheme.selected === 'dark' ? 'system' : 'light'} theme`}
          title="Toggle color scheme"
          className="relative"
        >
          <Sun
            size={24}
            className={clsx(
              'transition-opacity duration-200',
              scheme.selected === 'light' ? 'opacity-100' : 'opacity-0',
            )}
          />
          <Moon
            className={clsx(
              'absolute inset-0 transition-opacity duration-200',
              scheme.selected === 'dark' ? 'opacity-100' : 'opacity-0',
            )}
          />
          <SunMoon
            className={clsx(
              'absolute inset-0 transition-opacity duration-200',
              scheme.selected === 'auto' ? 'opacity-100' : 'opacity-0',
            )}
          />
        </ToolbarButton>
      </Toolbar>

      {/* ── Bottom-left: help & share ── */}
      <Toolbar ariaLabel="Help etc." isVisible={controlsAreVisible && !isHelpVisible} position="bottom-left">
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

      {/* ── Session history — top-left, interactive ── */}
      {(sessionHistory.length > 0 ||
        pendingDuration > 0 ||
        timerState.is === 'paused' ||
        timerState.is === 'interacting') && (
        <div
          className="absolute top-4 left-4 max-h-[40vh] overflow-y-auto z-20 flex flex-col gap-0.5"
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerMove={(e) => e.stopPropagation()}
        >
          {/* Clear buttons */}
          <div className="flex justify-end gap-2 mb-1">
            {pendingDuration > 0 && (
              <button
                onClick={() => {
                  setTimerModel({ ...timerModel, accumulatedMs: 0 });
                  setPartialRunMs(0);
                  runSegmentStartRef.current = null;
                }}
                className="text-[10px] text-gray-400 dark:text-gray-600 hover:text-orange-400 dark:hover:text-orange-400 transition-colors cursor-pointer"
                aria-label="Clear pending session"
                title="Clear pending"
              >
                clear pending
              </button>
            )}
            <button
              onClick={() => setTimerModel({ ...timerModel, sessionHistory: [] })}
              className="text-[10px] text-gray-400 dark:text-gray-600 hover:text-red-400 dark:hover:text-red-400 transition-colors cursor-pointer"
              aria-label="Clear session history"
              title="Clear history"
            >
              clear all
            </button>
          </div>
          {/* Pending entry (current session, not yet logged) */}
          {(pendingDuration > 0 || timerState.is === 'paused' || timerState.is === 'interacting') && (
            <div className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 font-medium mb-1 pb-1 border-b border-gray-200 dark:border-gray-800">
              <span className="font-mono tabular-nums shrink-0">{formatTotalDuration(pendingDuration)}</span>
              <span className="text-gray-400 dark:text-gray-600 italic text-[10px]">
                {sessionName.trim() || 'pending'}
              </span>
            </div>
          )}
          {[...sessionHistory]
            .reverse()
            .slice(0, 15)
            .map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 group/row"
              >
                <span className="font-mono tabular-nums shrink-0">
                  {formatHistoryDuration(entry.duration, entry.mode)}
                </span>
                <input
                  type="text"
                  defaultValue={entry.name ?? ''}
                  placeholder="label…"
                  maxLength={150}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  onBlur={(e) => {
                    const newName = e.currentTarget.value.trim() || undefined;
                    if (newName === entry.name) return;
                    setTimerModel({
                      ...timerModel,
                      sessionHistory: (timerModel.sessionHistory ?? []).map((s) =>
                        s.id === entry.id ? { ...s, name: newName } : s,
                      ),
                    });
                  }}
                  className={clsx(
                    'bg-transparent border-none outline-none',
                    'w-28 min-w-0 truncate',
                    'placeholder-gray-300 dark:placeholder-gray-700',
                    'hover:bg-gray-100/50 dark:hover:bg-white/5 rounded px-1',
                    'focus:bg-gray-100/70 dark:focus:bg-white/10 rounded px-1',
                    'transition-colors cursor-text',
                  )}
                />
              </div>
            ))}
          {/* Total row */}
          {sessionHistory.length > 1 &&
            (() => {
              const totalMs = sessionHistory.reduce((sum, e) => sum + e.duration, 0);
              return (
                <div className="flex items-center gap-2 text-xs mt-1 pt-1 border-t border-gray-200 dark:border-gray-800">
                  <span className="font-mono tabular-nums shrink-0 text-gray-600 dark:text-gray-300 font-medium">
                    {formatTotalDuration(totalMs)}
                  </span>
                  <span className="text-gray-400 dark:text-gray-600">total</span>
                </div>
              );
            })()}
        </div>
      )}
    </div>
  );
};

export default SpiralTimer;

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

/** Human-readable duration for the history list, e.g. "30 min", "1h 05min", "45 sec" */
const formatHistoryDuration = (ms: number, mode: 'hours' | 'minutes'): string => {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;

  if (mode === 'hours') {
    // Show seconds for durations < 10 min to avoid rounding confusion
    if (h === 0 && m < 10) {
      if (m > 0 && s > 0) return `${m}min ${s}s`;
      if (m > 0) return `${m} min`;
      return `${s} sec`;
    }
    // For longer durations, whole minutes are fine
    if (h > 0 && m > 0) return `${h}h ${m}min`;
    if (h > 0) return `${h}h`;
    return `${m} min`;
  } else {
    // Minutes mode: always show seconds
    if (m > 0 && s > 0) return `${m}min ${s}s`;
    if (m > 0) return `${m} min`;
    return `${s} sec`;
  }
};
