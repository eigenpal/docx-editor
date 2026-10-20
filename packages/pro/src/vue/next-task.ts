/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Run work in a later event-loop task through a message, not a timer.
//
// A timer belongs to one window. With the editor in a pop-out, the opener's timers are
// throttled while the opener is hidden, and a pop-out's never run once it closes, which would
// leave a coalescer waiting forever. Message tasks are neither throttled nor tied to a window.

let pending: (() => void)[] = [];
let channel: MessageChannel | null = null;

/** Queue `task` for a later task. @internal */
export function nextTask(task: () => void): void {
  if (typeof MessageChannel !== 'function') {
    // Only engines without channels take this path; any window's timer will do there.
    globalThis.setTimeout(task, 0);
    return;
  }
  if (!channel) {
    channel = new MessageChannel();
    channel.port1.onmessage = () => {
      const tasks = pending;
      pending = [];
      for (const run of tasks) {
        // One task that throws must not drop the rest of the batch: a coalescer whose task
        // never ran would wait forever.
        try {
          run();
        } catch (error) {
          console.error(error);
        }
      }
    };
  }
  pending.push(task);
  if (pending.length === 1) channel.port2.postMessage(null);
}
