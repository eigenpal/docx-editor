/**
 * Anonymous diagnostics: why something failed, as stable codes and bucketed numbers.
 *
 * A document is user data. Its text, names, part names, relationship targets, author names and
 * font names never appear in a diagnostic. Every field below is a closed enum, a boolean or a
 * number, so an event can go to an error tracker or a metrics backend as it is. The internal
 * rejection reasons stay internal: they map many-to-one onto {@link DiagnosticCode}, which is
 * the public, versioned vocabulary a host can match on.
 *
 * @packageDocumentation
 */

import type { CollaborationStatus } from '../collaboration/index.ts';
import type { EditorCommand } from './editor.ts';

/** Version of the {@link EditorDiagnostic} shape. Raised only when a field changes meaning. @public */
export const DIAGNOSTIC_SCHEMA_VERSION = 1;

import type {
  DocumentOpenDiagnosticCode,
  EditDiagnosticCode,
  ReviewDiagnosticCode,
  FontDiagnosticCode,
  CollaborationDiagnosticCode,
  DiagnosticCode,
  ByteSizeBucket,
  CountBucket,
} from '../automation/diagnostic-vocabulary.ts';

export type {
  DocumentOpenDiagnosticCode,
  EditDiagnosticCode,
  ReviewDiagnosticCode,
  FontDiagnosticCode,
  CollaborationDiagnosticCode,
  DiagnosticCode,
  ByteSizeBucket,
  CountBucket,
} from '../automation/diagnostic-vocabulary.ts';
export type { DiagnosticExplanation } from '../automation/diagnostic-hints.ts';

/** Fields every diagnostic carries. @public */
export interface DiagnosticBase {
  /** {@link DIAGNOSTIC_SCHEMA_VERSION} when the event was made. */
  readonly schemaVersion: number;
  /**
   * Random for each editor instance and never stored, so one open failure can be linked to the
   * edits after it. It identifies no person and no document.
   */
  readonly editorSessionId: string;
  /** Milliseconds since the epoch. */
  readonly time: number;
}

/** A document opened, or failed to open. @public */
export type DocumentOpenDiagnostic = DiagnosticBase & {
  readonly kind: 'document.open';
} & (
    | {
        readonly outcome: 'opened';
        /** Compressed size of the bytes the editor was given. */
        readonly sizeBucket: ByteSizeBucket;
        /** Pages after the first layout. Absent on a headless host that does not paginate. */
        readonly pagesBucket?: CountBucket;
        /** Milliseconds from the start of the open to the mounted first layout. */
        readonly durationMs: number;
      }
    | {
        readonly outcome: 'rejected';
        readonly code: DocumentOpenDiagnosticCode;
        /** Compressed size of the bytes, absent when the source was not bytes at all. */
        readonly sizeBucket?: ByteSizeBucket;
      }
  );

/** Where a refused edit came from. @public */
export type EditRejectionOrigin = 'command' | 'input' | 'automation';

/** An edit, a command or a tracked change was refused. @public */
export interface EditRejectedDiagnostic extends DiagnosticBase {
  readonly kind: 'edit.rejected';
  readonly code: EditDiagnosticCode;
  /**
   * `'command'` for `exec(...)`, `'input'` for typing, clipboard, drag and pointer edits, and
   * `'automation'` for a batch from the editing API.
   */
  readonly origin: EditRejectionOrigin;
  /** True when the editor was suggesting (tracking changes) at the time. */
  readonly tracked: boolean;
  /** The command type for `origin: 'command'`, such as `'insertTable'`. */
  readonly command?: EditorCommand['type'];
}

/** An accept, reject or re-author request skipped one or more tracked changes. @public */
export interface ReviewSkippedDiagnostic extends DiagnosticBase {
  readonly kind: 'review.skipped';
  readonly code: ReviewDiagnosticCode;
  /** How many items were skipped for this code in the one request. */
  readonly count: number;
}

/** A font failed to load. The editor kept working with a substitute. @public */
export interface FontFailedDiagnostic extends DiagnosticBase {
  readonly kind: 'font.failed';
  readonly code: FontDiagnosticCode;
}

/**
 * A collaboration session changed status: it joined, disconnected, failed, or healed.
 *
 * @public
 */
export interface CollaborationStatusDiagnostic extends DiagnosticBase {
  readonly kind: 'collab.status';
  readonly status: CollaborationStatus;
  /** The status before this change; `'none'` for the first status the editor saw. */
  readonly previous: CollaborationStatus | 'none';
  /** Why the session holds `status`, when something is wrong. */
  readonly code?: CollaborationDiagnosticCode;
  /** True when the session will heal on its own; wait instead of rejoining. */
  readonly recovering: boolean;
  /** Milliseconds from the editor attaching the session to its first `ready`. Only then. */
  readonly connectMs?: number;
}

/** The number of people in the collaboration room changed. @public */
export interface CollaborationParticipantsDiagnostic extends DiagnosticBase {
  readonly kind: 'collab.participants';
  /** People present, this editor included. A person with two tabs counts twice. */
  readonly count: number;
}

/**
 * One anonymous diagnostic. Switch on `kind` to narrow `code`.
 *
 * @example
 * ```ts
 * editor.on('diagnostic', (event) => {
 *   if (event.kind === 'edit.rejected') {
 *     console.warn(event.code, explainDiagnostic(event.code).hint);
 *   }
 * });
 * ```
 *
 * @public
 */
export type EditorDiagnostic =
  | DocumentOpenDiagnostic
  | EditRejectedDiagnostic
  | ReviewSkippedDiagnostic
  | FontFailedDiagnostic
  | CollaborationStatusDiagnostic
  | CollaborationParticipantsDiagnostic;

/** The `kind` of every {@link EditorDiagnostic}. @public */
export type EditorDiagnosticKind = EditorDiagnostic['kind'];
