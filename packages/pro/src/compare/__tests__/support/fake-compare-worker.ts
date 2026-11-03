/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// A stand-in for the compare worker that answers every compare with one fixed result, so the
// dialog tests can show any refusal without building documents that cause it.
import type { CompareDocumentsBackgroundResult } from '@docx-editor.dev/core/editor';
import { COMPARE_WORKER_PROTOCOL } from '../../worker-protocol.ts';

export function answeringCompareWorker(result: CompareDocumentsBackgroundResult): () => Worker {
  return () => {
    let listener: ((event: { data: unknown }) => void) | undefined;
    return {
      postMessage() {
        queueMicrotask(() =>
          listener?.({ data: { protocol: COMPARE_WORKER_PROTOCOL, type: 'result', result } })
        );
      },
      addEventListener(type: string, handler: (event: { data: unknown }) => void) {
        if (type === 'message') listener = handler;
      },
      terminate() {},
    } as unknown as Worker;
  };
}

/** The refusal the engine gives for differences inside a locked content control. */
export const LOCKED_CONTENT_REFUSAL: CompareDocumentsBackgroundResult = {
  ok: false,
  code: 'unsupportedContent',
  reason: 'lockedContent',
  message: 'locked',
};
