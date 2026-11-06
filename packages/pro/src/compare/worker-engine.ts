/*
Copyright (c) 2026 Eigenpal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** The background compare engine over the compare worker. */
import type { CompareDocumentsBackgroundEngine } from '@docx-editor.dev/core/editor';
import { COMPARE_WORKER_PROTOCOL, isWorkerMessage, ownProtocol } from './worker-protocol.ts';

/** What the engine needs of a worker: the subset that browsers and test runtimes share. */
export interface CompareWorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  removeEventListener?(
    type: 'message' | 'messageerror',
    listener: (event: MessageEvent<unknown>) => void
  ): void;
  removeEventListener?(type: 'error', listener: (event: Event) => void): void;
  terminate(): void;
}

/** A worker that sends no valid message of this protocol in this time never started. */
export const COMPARE_WORKER_STARTUP_MS = 30_000;

/**
 * Each compare starts a fresh worker and ends it when the compare ends or the signal aborts, so
 * a stopped compare costs nothing more and leaves no state behind.
 */
export function createCompareWorkerEngine(
  createWorker: () => CompareWorkerLike,
  startupMs = COMPARE_WORKER_STARTUP_MS
): CompareDocumentsBackgroundEngine {
  return (original, revised, options, { signal, onProgress }) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const worker = createWorker();
      let settled = false;
      let startup: ReturnType<typeof globalThis.setTimeout> | undefined;
      const stopStartup = () => {
        if (startup !== undefined) globalThis.clearTimeout(startup);
        startup = undefined;
      };
      /** Ends the compare once: every listener, the deadline, and the worker go. */
      const finish = (): boolean => {
        if (settled) return false;
        settled = true;
        stopStartup();
        signal.removeEventListener('abort', abort);
        worker.removeEventListener?.('message', onMessage);
        worker.removeEventListener?.('messageerror', onMessageError);
        worker.removeEventListener?.('error', onError);
        worker.terminate();
        return true;
      };
      const fail = (message: string, cause?: unknown) => {
        if (finish()) reject(new Error(message, cause === undefined ? undefined : { cause }));
      };
      const abort = () => {
        if (finish()) reject(signal.reason);
      };
      const onMessage = (event: MessageEvent<unknown>) => {
        const message = event.data;
        // Other code that shares the worker; it does not count as a start.
        if (settled || !ownProtocol(message)) return;
        if (!isWorkerMessage(message)) {
          fail('The compare worker sent a malformed message.');
          return;
        }
        stopStartup();
        if (message.type === 'progress') {
          onProgress({ phase: message.phase, fraction: message.fraction });
          return;
        }
        if (!finish()) return;
        if (message.type === 'result') resolve(message.result);
        else reject(new Error(`The compare worker failed: ${message.message}`));
      };
      const onMessageError = () => fail('The compare worker sent a message that cannot be read.');
      const onError = (event: Event) => {
        const detail = (event as ErrorEvent).message;
        fail(`The compare worker failed to run${detail ? `: ${detail}` : ''}.`);
      };
      signal.addEventListener('abort', abort, { once: true });
      worker.addEventListener('message', onMessage);
      worker.addEventListener('messageerror', onMessageError);
      worker.addEventListener('error', onError);
      startup = globalThis.setTimeout(
        () =>
          fail(`The compare worker did not start within ${Math.round(startupMs / 1000)} seconds.`),
        startupMs
      );
      // Copies, so the caller keeps its bytes; the copies move to the worker without a second copy.
      const originalCopy = original.slice();
      const revisedCopy = revised.slice();
      try {
        worker.postMessage(
          {
            protocol: COMPARE_WORKER_PROTOCOL,
            type: 'compare',
            original: originalCopy,
            revised: revisedCopy,
            options: { ...options },
          },
          [originalCopy.buffer, revisedCopy.buffer]
        );
      } catch (error) {
        fail('The compare worker could not receive the documents.', error);
      }
    });
}
