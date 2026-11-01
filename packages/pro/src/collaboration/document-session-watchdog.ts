/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/**
 * A warning for a session no editor attaches.
 *
 * A session that is never attached still reports `ready`, and in the connect-later flow a
 * missed `key` remount silently stops replication. The failure codes are a closed core union
 * with only terminal statuses, so this cannot be a typed non-fatal warning; a one-shot
 * console.warn is the honest surface. The session clears it on attach and on destroy.
 */

/** After this long with no attached document port, the session warns that nothing replicates. */
const ATTACH_WATCHDOG_MS = 2_000;

/**
 * Test-only override for the attach watchdog delay. Not re-exported from
 * `@docx-editor.dev/pro/collaboration`.
 *
 * @internal
 */
export const ATTACH_WATCHDOG_MS_FOR_TESTS: unique symbol = Symbol(
  'createDocumentCollaboration.attachWatchdogMs'
);

/** The attach watchdog delay for `createDocumentCollaboration` options: the test override or the default. */
export function attachWatchdogDelay(options: object): number {
  return (
    (options as { readonly [ATTACH_WATCHDOG_MS_FOR_TESTS]?: number })[
      ATTACH_WATCHDOG_MS_FOR_TESTS
    ] ?? ATTACH_WATCHDOG_MS
  );
}

/**
 * Warn once after `ms` unless `settled` says the session was attached or destroyed. `settled`
 * runs when the timer fires.
 */
export function startAttachWatchdog(
  documentId: string,
  ms: number,
  settled: () => boolean
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => {
    if (settled()) return;
    console.warn(
      `[docx-editor] The collaboration session for "${documentId}" was created ` +
        `${ms}ms ago and no editor attached its document port. The session ` +
        `reports "ready" but no edits replicate. Remount the editor when the session ` +
        `appears — for example pass key={session.sessionId} — so ` +
        `collaborationModule({ session }) attaches it.`
    );
  }, ms);
  // Browsers have no unref; destroy clears the timer. Guarded unref keeps a short-lived Node
  // host from waiting on the watchdog.
  (timer as { unref?: () => void }).unref?.();
  return timer;
}
