/** Coalesced deferred notifier for editor state ticks. @internal */

/**
 * How many consecutive notification WAVES may take the microtask path before the next one
 * yields through a task.
 *
 * A wave is one event-loop task's worth of notifications (every subscriber a single commit
 * notifies shares one wave). React's maximum-update-depth guard counts synchronous store
 * updates that reach it without a real yield, and sustained hardware input against a fast
 * engine can chain waves past that limit even though every update is a legitimate
 * keystroke: `isInputPending` reads false the moment the backlog is already dispatched
 * into tasks, so the pending-input check alone cannot break the chain. The streak resets
 * whenever a zero-delay timer gets to run — timers running IS the yield React needs.
 */
const MAX_MICROTASK_WAVES_BEFORE_YIELD = 16;

let waveStreak = 0;
let waveOpen = false;
let streakResetArmed = false;

/** Decide the scheduling lane for one coalesced notification. @internal */
export function notificationYieldsToTask(): boolean {
  const scheduling = (
    globalThis as typeof globalThis & {
      navigator?: {
        scheduling?: { isInputPending?: (options?: { includeContinuous?: boolean }) => boolean };
      };
    }
  ).navigator?.scheduling;
  // Without the Scheduling API there is no input-driven cascade to break — test
  // environments and non-Chromium engines keep the legacy immediate path, and the wave
  // counter must not accrue where timers may never run to reset it.
  if (typeof scheduling?.isInputPending !== 'function') return false;
  if (scheduling.isInputPending({ includeContinuous: true })) return true;
  if (!waveOpen) {
    waveOpen = true;
    waveStreak += 1;
    // Closes at this task's microtask checkpoint, so notifications from a later task open
    // a new wave.
    queueMicrotask(() => {
      waveOpen = false;
    });
    if (!streakResetArmed) {
      streakResetArmed = true;
      setTimeout(() => {
        streakResetArmed = false;
        waveStreak = 0;
      }, 0);
    }
  }
  return waveStreak > MAX_MICROTASK_WAVES_BEFORE_YIELD;
}

export function deferredTick(notify: () => void): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    const flush = () => {
      scheduled = false;
      notify();
    };
    if (notificationYieldsToTask()) setTimeout(flush, 0);
    else queueMicrotask(flush);
  };
}
