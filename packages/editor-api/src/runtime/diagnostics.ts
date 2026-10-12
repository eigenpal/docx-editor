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
  openDiagnosticCode,
  type AutomationHost,
  type AutomationOperation,
  type ByteSizeBucket,
  type DocumentOpenDiagnosticCode,
  type EditDiagnosticCode,
} from '@docx-editor.dev/core/automation';
import type { DocxEditorError } from './errors.ts';

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
    }
  | {
      readonly kind: 'edit.rejected';
      readonly code: EditDiagnosticCode;
      readonly origin: 'automation';
      readonly tracked: boolean;
    }
);

export interface RuntimeDiagnostics {
  openRejected(bytes: Uint8Array, reason: string, limit?: string): void;
  opened(bytes: Uint8Array, durationMs: number): void;
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
  // A failed batch rolls back the mode it staged, so read the batch as well as the host.
  const staged = operations.some(
    (operation) => operation.op === 'setChangeTrackingMode' && operation.mode !== 'Off'
  );
  // `tracked` says whether tracking was on, as the editor reports it; refusals about tracking
  // itself are routed by their code.
  return { code, tracked: staged || tracking(host) };
}

/** Diagnostics for these listeners, or null when there are none. */
export function runtimeDiagnostics(
  listeners: readonly ((event: RuntimeDiagnostic) => unknown)[]
): RuntimeDiagnostics | null {
  if (listeners.length === 0) return null;
  const { deliver } = createDiagnosticEmitter<RuntimeDiagnostic>(() => listeners);
  return {
    openRejected(bytes, reason, limit) {
      deliver({
        kind: 'document.open',
        outcome: 'rejected',
        code: openDiagnosticCode(reason, limit),
        sizeBucket: byteSizeBucket(bytes.byteLength),
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
    refused(error, host, operations) {
      deliver({
        kind: 'edit.rejected',
        origin: 'automation',
        ...classifyRefusal(error, host, operations),
      });
    },
  };
}
