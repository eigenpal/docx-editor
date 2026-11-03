/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Messages between the editor and the compare worker. One worker runs one compare. */
import type {
  CompareDocumentsBackgroundResult,
  CompareDocumentsEngineOptions,
  CompareDocumentsPhase,
} from '@docx-editor.dev/core/editor';

/** Marks every message of this protocol, so a worker shared with other code can tell. */
export const COMPARE_WORKER_PROTOCOL = 'docx-editor.compare/1';

/** The editor asks for one compare. */
export interface CompareWorkerRequest {
  readonly protocol: typeof COMPARE_WORKER_PROTOCOL;
  readonly type: 'compare';
  readonly original: Uint8Array;
  readonly revised: Uint8Array;
  readonly options: CompareDocumentsEngineOptions;
}

/** The worker reports a step, or the result. */
export type CompareWorkerMessage =
  | {
      readonly protocol: typeof COMPARE_WORKER_PROTOCOL;
      readonly type: 'progress';
      readonly phase: CompareDocumentsPhase;
      readonly fraction: number;
    }
  | {
      readonly protocol: typeof COMPARE_WORKER_PROTOCOL;
      readonly type: 'result';
      readonly result: CompareDocumentsBackgroundResult;
    }
  | {
      readonly protocol: typeof COMPARE_WORKER_PROTOCOL;
      readonly type: 'error';
      readonly message: string;
    };
