/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** The background compare engine over the compare worker. */
import type { CompareDocumentsBackgroundEngine } from '@docx-editor.dev/core/editor';
import { COMPARE_WORKER_PROTOCOL, type CompareWorkerMessage } from './worker-protocol.ts';

/** What the engine needs of a worker: the subset that browsers and test runtimes share. */
export interface CompareWorkerLike {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  addEventListener(type: 'error', listener: (event: Event) => void): void;
  terminate(): void;
}

function isMessage(data: unknown): data is CompareWorkerMessage {
  return (
    typeof data === 'object' &&
    data !== null &&
    (data as { protocol?: unknown }).protocol === COMPARE_WORKER_PROTOCOL
  );
}

/**
 * Each compare starts a fresh worker and ends it when the compare ends or the signal aborts, so
 * a stopped compare costs nothing more and leaves no state behind.
 */
export function createCompareWorkerEngine(
  createWorker: () => CompareWorkerLike
): CompareDocumentsBackgroundEngine {
  return (original, revised, options, { signal, onProgress }) =>
    new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const worker = createWorker();
      const finish = () => {
        signal.removeEventListener('abort', abort);
        worker.terminate();
      };
      const abort = () => {
        finish();
        reject(signal.reason);
      };
      signal.addEventListener('abort', abort, { once: true });
      worker.addEventListener('message', (event) => {
        const message = event.data;
        if (!isMessage(message) || signal.aborted) return;
        if (message.type === 'progress') {
          onProgress({ phase: message.phase, fraction: message.fraction });
          return;
        }
        finish();
        if (message.type === 'result') resolve(message.result);
        else reject(new Error(`The compare worker failed: ${message.message}`));
      });
      worker.addEventListener('error', (event) => {
        if (signal.aborted) return;
        finish();
        const detail = (event as ErrorEvent).message;
        reject(new Error(`The compare worker failed to run${detail ? `: ${detail}` : ''}.`));
      });
      // Copies, so the caller keeps its bytes; the copies move to the worker without a second copy.
      const originalCopy = original.slice();
      const revisedCopy = revised.slice();
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
    });
}
