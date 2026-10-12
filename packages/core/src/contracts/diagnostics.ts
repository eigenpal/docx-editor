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
  CustomNodeDiagnosticCode,
  HistoryDiagnosticCode,
  PerformanceDiagnosticCode,
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
  CustomNodeDiagnosticCode,
  HistoryDiagnosticCode,
  PerformanceDiagnosticCode,
} from '../automation/diagnostic-vocabulary.ts';
export type { DiagnosticExplanation } from '../automation/diagnostic-hints.ts';

/** The bucketed shape of an opened document. @public */
export interface DocumentShape {
  /** XML parts in the package. */
  readonly parts: CountBucket;
  readonly paragraphs: CountBucket;
  /** Tracked changes and comments, as the review queue lists them. */
  readonly reviewItems: CountBucket;
  readonly embeddedFonts: CountBucket;
}

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
        /**
         * More of the document's shape, in buckets. A telemetry client sends it only when you
         * ask for the detailed shape: several counts together describe a document more closely.
         */
        readonly shape?: DocumentShape;
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

/** The undo history did not group edits as the gesture intended. Informational. @public */
export interface HistoryDiagnosticEvent extends DiagnosticBase {
  readonly kind: 'history';
  readonly code: HistoryDiagnosticCode;
}

/** A custom node's stored payload could not be read. The node and its data are not named. @public */
export interface CustomNodeDiagnosticEvent extends DiagnosticBase {
  readonly kind: 'custom-node';
  readonly code: CustomNodeDiagnosticCode;
}

/** The number of people in the collaboration room changed. @public */
export interface CollaborationParticipantsDiagnostic extends DiagnosticBase {
  readonly kind: 'collab.participants';
  /** People present, this editor included. A person with two tabs counts twice. */
  readonly count: number;
}

/**
 * Timings of one kind over a performance window. Every value is in milliseconds, rounded to
 * whole milliseconds.
 *
 * @public
 */
export interface TimingSummary {
  /** Timings measured in the window. */
  readonly count: number;
  /** Median. Exact up to 2048 timings; above that, from a uniform sample of 2048. */
  readonly p50Ms: number;
  /** 95th percentile, from the same sample as the median. */
  readonly p95Ms: number;
  /** The slowest timing, always exact. */
  readonly maxMs: number;
  /**
   * Timings per band, always exact. Eight counts: up to 16, 33, 50, 100, 200, 500, and 1000
   * ms, then over 1000 ms. A metrics backend builds a histogram from these.
   */
  readonly bands: readonly number[];
}

/**
 * How the editor performed while it was used: one summary per window, never one event per key
 * press. Sent after a minute of use, when the page is hidden, and when the editor is destroyed,
 * if anything was measured since the last summary.
 *
 * @public
 */
export interface PerformanceDiagnostic extends DiagnosticBase {
  readonly kind: 'performance';
  /** Present when the summary needs attention, such as slow key presses. */
  readonly code?: PerformanceDiagnosticCode;
  /** Milliseconds from the window's first timing to the summary. */
  readonly windowMs: number;
  /** Pages in the document at the last paint. */
  readonly pagesBucket?: CountBucket;
  /**
   * Key presses and pointer presses on the pages, from the browser event to the next frame on
   * screen: the delay a person feels. At most one is timed at a time, so a burst of key repeats
   * is timed from its first press.
   */
  readonly interaction?: TimingSummary;
  /** Engine layout passes. */
  readonly layout?: TimingSummary;
  /** Engine paints of the pages. */
  readonly paint?: TimingSummary;
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
  | HistoryDiagnosticEvent
  | CustomNodeDiagnosticEvent
  | CollaborationStatusDiagnostic
  | CollaborationParticipantsDiagnostic
  | PerformanceDiagnostic;

/** The `kind` of every {@link EditorDiagnostic}. @public */
export type EditorDiagnosticKind = EditorDiagnostic['kind'];
