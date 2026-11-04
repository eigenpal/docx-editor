/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
/** Messages between the editor and the compare worker. One worker runs one compare. */
import type {
  CompareDocumentsBackgroundResult,
  CompareDocumentsEngineErrorCode,
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

const PHASES: Record<CompareDocumentsPhase, true> = {
  reading: true,
  comparing: true,
  checking: true,
  applying: true,
};
// A record, so a new code fails the typecheck until it is listed here.
const ENGINE_CODES: Record<CompareDocumentsEngineErrorCode, true> = {
  invalidOptions: true,
  invalidOriginal: true,
  invalidRevised: true,
  tooLarge: true,
  protected: true,
  unsupportedContent: true,
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;
const has = (record: Record<string, true>, key: unknown) =>
  typeof key === 'string' && Object.hasOwn(record, key);

/** Byte arrays from any realm: a worker's `Uint8Array` is not the page's. */
export const isBytes = (value: unknown): value is Uint8Array =>
  Object.prototype.toString.call(value) === '[object Uint8Array]';

/** Whether `data` is marked with this protocol. Other data is someone else's and is ignored. */
export const ownProtocol = (data: unknown): data is { readonly protocol: string } =>
  isRecord(data) && data['protocol'] === COMPARE_WORKER_PROTOCOL;

/** Whether a message of this protocol has the shape of a compare request. */
export function isCompareRequest(data: {
  readonly protocol: string;
}): data is CompareWorkerRequest {
  const request = data as Record<string, unknown>;
  return (
    request['type'] === 'compare' &&
    isBytes(request['original']) &&
    isBytes(request['revised']) &&
    isRecord(request['options'])
  );
}

function isResult(value: unknown): value is CompareDocumentsBackgroundResult {
  if (!isRecord(value) || typeof value['ok'] !== 'boolean') return false;
  if (!value['ok']) return has(ENGINE_CODES, value['code']);
  const count = value['revisionCount'];
  // Bytes come exactly when the result changed the document.
  return (
    typeof value['changed'] === 'boolean' &&
    (value['changed'] ? isBytes(value['bytes']) : value['bytes'] === null) &&
    typeof count === 'number' &&
    Number.isSafeInteger(count) &&
    count >= 0
  );
}

/** Whether a message of this protocol has the shape of a worker message. */
export function isWorkerMessage(data: { readonly protocol: string }): data is CompareWorkerMessage {
  const message = data as Record<string, unknown>;
  switch (message['type']) {
    case 'progress': {
      const fraction = message['fraction'];
      return (
        has(PHASES, message['phase']) &&
        typeof fraction === 'number' &&
        Number.isFinite(fraction) &&
        fraction >= 0 &&
        fraction <= 1
      );
    }
    case 'result':
      return isResult(message['result']);
    case 'error':
      return typeof message['message'] === 'string';
    default:
      return false;
  }
}
