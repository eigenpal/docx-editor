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
  type ByteSizeBucket,
  type DocumentOpenDiagnosticCode,
  type EditDiagnosticCode,
} from '@docx-editor.dev/core/automation';
import type { DocxEditorError } from './errors.ts';

/**
 * A diagnostic from a headless runtime: the open, and each refused batch with a known reason.
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
  /** A refused batch, when the engine named a specific reason or the document moved. */
  refused(error: DocxEditorError, host: AutomationHost): void;
}

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
    refused(error, host) {
      const inner = error.debugInfo.innerError?.code;
      const code: EditDiagnosticCode | undefined = inner?.startsWith('edit.')
        ? (inner as EditDiagnosticCode)
        : error.code === 'StaleDocument'
          ? 'edit.stale-target'
          : undefined;
      if (!code) return;
      // A failed batch rolls back the mode it staged, so a tracking refusal is tracked by
      // definition; anything else reads the mode the batch ran under, which is the host's now.
      const tracked = /^edit\.track(?:ed|ing)-/.test(code) || tracking(host);
      deliver({ kind: 'edit.rejected', code, origin: 'automation', tracked });
    },
  };
}
