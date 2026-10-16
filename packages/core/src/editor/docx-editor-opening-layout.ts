// The background half of a large open: the surface is mounted and takes input, and its
// remaining pages lay out in short tasks (`surface-progressive-open.ts`).
//
// The open itself ended at the mount, so nothing here holds the document's bytes: a detach,
// an attach to another container, or an edit keeps the live surface. The tasks belong to the
// surface they started for, and stop once the facade holds another one; a destroyed surface
// cleans up its own opening state.

import { continueProgressiveOpen, progressiveOpenPending } from './surface-progressive-open.ts';

/** The work one background task aims to do, in milliseconds: room for a frame and for input. */
const OPENING_SLICE_MS = 12;

export interface OpeningLayoutHooks {
  /** The surface the facade holds now; the tasks stop once it is another one. */
  current(): object | null;
  /** The window the pages paint in: its tasks are the ones that run while it is visible. */
  view(): Window;
  /** Run one slice; the facade reports a throw as a failed open. */
  slice(run: () => boolean): boolean;
  /** The last page is laid out. */
  settled(): void;
}

function queueTask(run: () => void, view: Window): void {
  if (typeof MessageChannel === 'function') {
    // A message task, not a timer: a chain of nested timers waits 4 ms between steps.
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      run();
    };
    channel.port2.postMessage(null);
    return;
  }
  view.setTimeout(run, 0);
}

/** Lay out `surface`'s remaining pages in background tasks, if it has any. */
export function continueOpeningLayout(surface: object, hooks: OpeningLayoutHooks): void {
  if (!progressiveOpenPending(surface)) return;
  const slice = (): void => {
    if (hooks.current() !== surface || !progressiveOpenPending(surface)) return;
    if (hooks.slice(() => continueProgressiveOpen(surface, OPENING_SLICE_MS))) hooks.settled();
    else queueTask(slice, hooks.view());
  };
  queueTask(slice, hooks.view());
}
