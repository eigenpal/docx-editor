/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Translation both ways across the host protocol.
//
// Out: a queue of actions becomes one `AutomationBatchRequest` whose operations are in queue
// order. In: a response is either hydrated positionally into the actions that asked for it, or
// turned into exactly one typed error.
//
// The host's atomicity is the thing being preserved here. When a batch is refused it reports
// the failing operation and marks EVERY other operation `skipped` — including the ones before
// it — because nothing was published. This module therefore never hydrates a partial response:
// a refusal produces an error and no `settle` call at all, so a proxy can never end up holding
// a value from a batch the document did not accept.

import type {
  AutomationBatchResponse,
  AutomationError,
  AutomationErrorCode,
  AutomationOperation,
} from '@docx-editor.dev/core/automation';
import {
  diagnosticCause,
  reviewSkipOfReason,
  storeEditDiagnosticCode,
} from '@docx-editor.dev/core/automation';
import { DocxEditorError, type DocxEditorErrorCode } from './errors.ts';
import type { QueuedAction } from './queue.ts';

export interface PlannedBatch {
  readonly operations: readonly AutomationOperation[];
  readonly hasRead: boolean;
  readonly hasWrite: boolean;
}

/**
 * Plan every action, in order.
 *
 * Planning is all-or-nothing before anything is sent: if one action cannot name its target, the
 * throw happens here and the host is never called, so a batch that could not be expressed
 * writes nothing rather than writing its prefix.
 */
export function planBatch(actions: readonly QueuedAction[]): PlannedBatch {
  const operations: AutomationOperation[] = [];
  let hasRead = false;
  let hasWrite = false;
  for (const action of actions) {
    operations.push(action.plan());
    if (action.sort === 'write') hasWrite = true;
    else hasRead = true;
  }
  return { operations, hasRead, hasWrite };
}

/**
 * The host's own refusal codes, mapped onto this runtime's.
 *
 * A total mapping rather than a default branch: adding a code to the protocol should make this
 * fail to compile, not silently arrive at consumers as `GeneralException`.
 */
const HOST_CODES: Readonly<Record<AutomationErrorCode, DocxEditorErrorCode>> = Object.freeze({
  'stale-revision': 'StaleDocument',
  'invalid-handle': 'InvalidObjectPath',
  'invalid-offset': 'InvalidArgument',
  'unsupported-capability': 'NotSupported',
  disposed: 'RuntimeDisposed',
  'transaction-refused': 'GeneralException',
  'unknown-operation': 'NotSupported',
  'unsupported-content': 'InvalidArgument',
  'unsupported-revision': 'NotImplemented',
  'ambiguous-document': 'GeneralException',
  'conflicting-operations': 'ConflictingChanges',
  'document-unavailable': 'DocumentUnavailable',
});

export interface HostFailureContext {
  /** The consumer-facing name of the object or property the failure is about. */
  readonly target?: string;
  /** The revision the batch was made conditional on, when it was. */
  readonly expectedRevision?: number;
  /** The revision the host reported afterwards. */
  readonly actualRevision?: number;
}

/**
 * One host error as one of ours. Nothing from `error.message`/`error.detail` survives: the
 * detail only selects a public diagnostic code, whose fixed hint becomes `debugInfo.innerError`.
 */
export function hostFailure(
  error: AutomationError,
  context: HostFailureContext = {}
): DocxEditorError {
  const code = HOST_CODES[error.code] ?? 'GeneralException';
  const stale = code === 'StaleDocument';
  // A refused tracked-change decision names its skip reason and structure, such as
  // `incomplete-group:paired-change`; an edit names its rule.
  const review = reviewSkipOfReason(error.detail);
  const diagnostic =
    error.detail === undefined
      ? null
      : (storeEditDiagnosticCode(error.detail) ?? review?.code ?? null);
  const failure = new DocxEditorError({
    code,
    ...(diagnostic === null ? {} : { diagnostic }),
    ...(context.target === undefined ? {} : { target: context.target }),
    ...(stale && context.expectedRevision !== undefined
      ? { expectedRevision: context.expectedRevision }
      : {}),
    ...(stale && context.actualRevision !== undefined
      ? { actualRevision: context.actualRevision }
      : {}),
  });
  // A bare detail such as `locked-content` is its own cause; a structure the engine does not
  // know, after a colon, names none.
  const bare = error.detail !== undefined && !error.detail.includes(':');
  const cause = review
    ? (review.cause ?? (bare ? diagnosticCause(error.detail) : undefined))
    : diagnosticCause(error.detail);
  if (cause) REFUSAL_CAUSES.set(failure, cause);
  return failure;
}

/**
 * The engine reason behind a refused batch, for its diagnostic only. Kept beside the error, not
 * on it, so `DocxEditorError` keeps the Office.js shape.
 */
const REFUSAL_CAUSES = new WeakMap<DocxEditorError, string>();

/** The engine reason a refusal came from, when the engine named one it knows. */
export function refusalCause(error: DocxEditorError): string | undefined {
  return REFUSAL_CAUSES.get(error);
}

/**
 * The error for a refused batch.
 *
 * The failing operation's index names the action, so the error can say WHICH of a consumer's
 * calls the document refused — the one identifier in the whole exchange that the consumer
 * wrote themselves.
 */
export function batchFailure(
  response: AutomationBatchResponse,
  actions: readonly QueuedAction[],
  expectedRevision?: number
): DocxEditorError {
  for (let index = 0; index < response.results.length; index += 1) {
    const result = response.results[index];
    if (result?.status !== 'error') continue;
    const label = actions[index]?.label;
    return hostFailure(result.error, {
      ...(label === undefined ? {} : { target: label }),
      ...(expectedRevision === undefined ? {} : { expectedRevision }),
      actualRevision: response.revision,
    });
  }
  // A response that is not ok and names no failing operation is a host that broke its own
  // contract. It is still a refusal, and it is still not partial — the batch is lost either way.
  return new DocxEditorError({ code: 'GeneralException' });
}

/**
 * Hydrate a successful response into the actions that asked for it.
 *
 * Positional and length-checked: a response with a different number of results than the request
 * had operations cannot be matched up at all, and guessing an alignment would put one proxy's
 * answer into another proxy.
 */
export function settleBatch(
  actions: readonly QueuedAction[],
  response: AutomationBatchResponse
): void {
  if (response.results.length !== actions.length) {
    throw new DocxEditorError({ code: 'GeneralException' });
  }
  for (let index = 0; index < actions.length; index += 1) {
    const result = response.results[index]!;
    const action = actions[index]!;
    if (result.status !== 'ok') {
      throw new DocxEditorError({ code: 'GeneralException', target: action.label });
    }
    action.settle(result.value);
  }
}
