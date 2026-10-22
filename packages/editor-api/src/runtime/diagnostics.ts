/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// Anonymous diagnostics for a headless runtime: the same events a mounted editor reports, so
// one telemetry module observes a browser editor and a server agent alike. A module with
// `onDiagnostic` in `createServer({ modules })` receives them.

import {
  byteSizeBucket,
  createDiagnosticEmitter,
  diagnosticCause,
  diagnosticErrorName,
  documentPartKind,
  exceptionCause,
  openDiagnosticCode,
  type AutomationHost,
  type AutomationOperation,
  type ByteSizeBucket,
  type DiagnosticErrorName,
  type DocumentOpenDiagnosticCode,
  type DocumentPartKind,
  type EditDiagnosticCode,
  type ReviewDiagnosticCode,
  type ReviewOperation,
} from '@docx-editor.dev/core/automation';
import type { DocxEditorError } from './errors.ts';
import { refusalCause } from './batch.ts';

/**
 * A diagnostic from a headless runtime: the open, and each refused batch.
 * Each one is also a valid `EditorDiagnostic`, so a telemetry module written for the editor
 * receives these unchanged.
 *
 * @public
 */
export type RuntimeDiagnostic = {
  readonly schemaVersion: number;
  /** Random for each runtime and never stored. */
  readonly editorSessionId: string;
  readonly time: number;
} & (
  | {
      readonly kind: 'document.open';
      readonly outcome: 'opened';
      readonly sizeBucket: ByteSizeBucket;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'document.open';
      readonly outcome: 'rejected';
      readonly code: DocumentOpenDiagnosticCode;
      readonly sizeBucket?: ByteSizeBucket;
      /** The engine's own reason. See `diagnosticCauses()`. */
      readonly cause?: string;
      /** The role of the part that failed. Never its name. */
      readonly part?: DocumentPartKind;
      /** The class of the exception when `cause` is `exception`. */
      readonly errorName?: DiagnosticErrorName;
    }
  | {
      readonly kind: 'edit.rejected';
      readonly code: EditDiagnosticCode;
      readonly origin: 'automation';
      readonly tracked: boolean;
      /** The engine's own reason. See `diagnosticCauses()`. */
      readonly cause?: string;
      /** The class of the exception when `cause` is `exception`. */
      readonly errorName?: DiagnosticErrorName;
      /** `automation` when `cause` is `exception`. */
      readonly stage?: 'automation';
    }
  | {
      /** A tracked-change decision the batch refused, with why and in what structure. */
      readonly kind: 'review.skipped';
      readonly code: ReviewDiagnosticCode;
      /** Always 1: a refused batch is one decision. */
      readonly count: number;
      readonly operation?: ReviewOperation;
      /**
       * The structure behind the skip, such as `paired-change` for the other half of a move,
       * or `nested-table` for a row kept for its nested table. See `diagnosticCauses()`.
       */
      readonly cause?: string;
    }
);

export interface RuntimeDiagnostics {
  openRejected(bytes: Uint8Array, reason: string, limit?: string, detail?: string): void;
  /** The open threw: an engine fault, reported with the exception's class only. */
  openCrashed(bytes: Uint8Array, error: unknown): void;
  opened(bytes: Uint8Array, durationMs: number): void;
  /** A batch that threw an engine error: reported by class, never by message. */
  crashed(error: unknown, host: AutomationHost, operations: readonly AutomationOperation[]): void;
  /** A refused batch, with its operations, so a tracking mode the batch staged still counts. */
  refused(
    error: DocxEditorError,
    host: AutomationHost,
    operations: readonly AutomationOperation[]
  ): void;
}

/** A public code for a refused batch the engine named no reason for. */
const RUNTIME_CODES: Partial<Record<DocxEditorError['code'], EditDiagnosticCode>> = {
  StaleDocument: 'edit.stale-target',
  ItemNotFound: 'edit.stale-target',
  InvalidObjectPath: 'edit.stale-target',
  InvalidArgument: 'edit.invalid-argument',
  ResourceLimitExceeded: 'edit.resource-limit',
  NotSupported: 'edit.operation-unsupported',
  NotImplemented: 'edit.operation-unsupported',
};

/** Whether changes were being tracked, read from the host after the refusal. */
function tracking(host: AutomationHost): boolean {
  try {
    const response = host.execute({ operations: [{ op: 'getChangeTrackingMode' }] });
    const result = response.ok ? response.results[0] : undefined;
    return result?.status === 'ok' && result.value.kind === 'text' && result.value.text !== 'Off';
  } catch {
    return false;
  }
}

/** Whether a batch ran under change tracking: the mode it staged, or the host's after it. */
export function trackedDuring(
  host: AutomationHost,
  operations: readonly AutomationOperation[]
): boolean {
  // A failed batch rolls back the mode it staged, so read the batch as well as the host.
  const staged = operations.some(
    (operation) => operation.op === 'setChangeTrackingMode' && operation.mode !== 'Off'
  );
  return staged || tracking(host);
}

/** The public code of a refused batch, and whether it ran under change tracking. */
export function classifyRefusal(
  error: DocxEditorError,
  host: AutomationHost,
  operations: readonly AutomationOperation[]
): { readonly code: EditDiagnosticCode; readonly tracked: boolean } {
  const inner = error.debugInfo.innerError?.code;
  const code: EditDiagnosticCode = inner?.startsWith('edit.')
    ? (inner as EditDiagnosticCode)
    : (RUNTIME_CODES[error.code] ?? 'edit.refused');
  // `tracked` says whether tracking was on, as the editor reports it; refusals about tracking
  // itself are routed by their code.
  return { code, tracked: trackedDuring(host, operations) };
}

/** What a refused batch's tracked-change decision asked, or undefined for another batch. */
export function reviewOperationOf(
  operations: readonly AutomationOperation[]
): ReviewOperation | undefined {
  for (const operation of operations) {
    switch (operation.op) {
      case 'acceptRevision':
      case 'acceptAllRevisions':
        return 'accept';
      case 'rejectRevision':
      case 'rejectAllRevisions':
        return 'reject';
      case 'resolveRevisionBatch':
        return operation.action;
      case 'setRevisionAuthorBatch':
        return 'reassign';
    }
  }
  return undefined;
}

/** The review code of a refusal that skipped a tracked-change decision, or null. */
export function reviewRefusalCode(error: DocxEditorError): ReviewDiagnosticCode | null {
  const inner = error.debugInfo.innerError?.code;
  return inner?.startsWith('review.') ? (inner as ReviewDiagnosticCode) : null;
}

/** Diagnostics for these listeners, or null when there are none. */
export function runtimeDiagnostics(
  listeners: readonly ((event: RuntimeDiagnostic) => unknown)[]
): RuntimeDiagnostics | null {
  if (listeners.length === 0) return null;
  const { deliver } = createDiagnosticEmitter<RuntimeDiagnostic>(() => listeners);
  return {
    openRejected(bytes, reason, limit, detail) {
      const cause = diagnosticCause(reason);
      const part = documentPartKind(detail);
      deliver({
        kind: 'document.open',
        outcome: 'rejected',
        code: openDiagnosticCode(reason, limit),
        sizeBucket: byteSizeBucket(bytes.byteLength),
        ...(cause ? { cause } : {}),
        ...(part ? { part } : {}),
      });
    },
    openCrashed(bytes, error) {
      deliver({
        kind: 'document.open',
        outcome: 'rejected',
        code: 'open.failed',
        sizeBucket: byteSizeBucket(bytes.byteLength),
        cause: exceptionCause(),
        errorName: diagnosticErrorName(error),
      });
    },
    opened(bytes, durationMs) {
      deliver({
        kind: 'document.open',
        outcome: 'opened',
        sizeBucket: byteSizeBucket(bytes.byteLength),
        durationMs: Math.max(0, Math.round(durationMs)),
      });
    },
    crashed(error, host, operations) {
      deliver({
        kind: 'edit.rejected',
        code: 'edit.internal-invariant',
        origin: 'automation',
        tracked: trackedDuring(host, operations),
        cause: exceptionCause(),
        errorName: diagnosticErrorName(error),
        stage: 'automation',
      });
    },
    refused(error, host, operations) {
      const cause = refusalCause(error);
      const review = reviewRefusalCode(error);
      if (review) {
        const operation = reviewOperationOf(operations);
        deliver({
          kind: 'review.skipped',
          code: review,
          count: 1,
          ...(operation ? { operation } : {}),
          ...(cause ? { cause } : {}),
        });
        return;
      }
      deliver({
        kind: 'edit.rejected',
        origin: 'automation',
        ...classifyRefusal(error, host, operations),
        ...(cause ? { cause } : {}),
      });
    },
  };
}
