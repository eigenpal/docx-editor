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

import type { EditorCommand } from './editor.ts';

/** Version of the {@link EditorDiagnostic} shape. Raised only when a field changes meaning. @public */
export const DIAGNOSTIC_SCHEMA_VERSION = 1;

/** Why a document could not be opened. @public */
export type DocumentOpenDiagnosticCode =
  | 'open.unsupported-source'
  | 'open.zip-corrupt'
  | 'open.zip-invalid-entry-name'
  | 'open.zip-entry-limit'
  | 'open.zip-size-limit'
  | 'open.zip-ratio-limit'
  | 'open.xml-malformed'
  | 'open.xml-dtd-forbidden'
  | 'open.xml-part-size-limit'
  | 'open.xml-depth-limit'
  | 'open.xml-element-limit'
  | 'open.invalid-limits'
  | 'open.content-types-invalid'
  | 'open.missing-main-document'
  | 'open.relationships-invalid'
  | 'open.relationship-limit'
  | 'open.part-limit'
  | 'open.failed';

/** Why an edit, a command or a tracked change was refused. @public */
export type EditDiagnosticCode =
  | 'edit.read-only'
  | 'edit.protected-content'
  | 'edit.suggesting-needs-author'
  | 'edit.review-module-required'
  | 'edit.tracked-drawing-delete-unsupported'
  | 'edit.tracked-structure-unsupported'
  | 'edit.revision-unsupported'
  | 'edit.cross-structure-join'
  | 'edit.indivisible-content'
  | 'edit.field-structure'
  | 'edit.section-mark'
  | 'edit.table-structure-unsupported'
  | 'edit.table-insert-refused'
  | 'edit.table-of-contents-refused'
  | 'edit.unsupported-content'
  | 'edit.unsupported-story'
  | 'edit.unmapped-change'
  | 'edit.stale-target'
  | 'edit.invalid-argument'
  | 'edit.resource-limit'
  | 'edit.refresh-in-progress'
  | 'edit.internal-invariant'
  | 'edit.refused';

/** Why accepting, rejecting or re-authoring a tracked change skipped an item. @public */
export type ReviewDiagnosticCode =
  | 'review.revision-unsupported'
  | 'review.incomplete-group'
  | 'review.retained-structure'
  | 'review.stale-revision';

/** Why a font did not load. The family name is never reported. @public */
export type FontDiagnosticCode =
  | 'font.shaper-unavailable'
  | 'font.load-failed'
  | 'font.missing'
  | 'font.integrity-mismatch'
  | 'font.malformed'
  | 'font.size-limit'
  | 'font.unsupported-face';

/** Every public diagnostic code. Codes are stable: a new one is additive, none is renamed. @public */
export type DiagnosticCode =
  | DocumentOpenDiagnosticCode
  | EditDiagnosticCode
  | ReviewDiagnosticCode
  | FontDiagnosticCode;

/**
 * A coarse size, in powers of two, so a size cannot single out one document.
 * `'0-64KiB'` covers everything under 64 KiB; `'512MiB+'` everything above.
 *
 * @public
 */
export type ByteSizeBucket =
  | '0-64KiB'
  | '64-128KiB'
  | '128-256KiB'
  | '256-512KiB'
  | '512KiB-1MiB'
  | '1-2MiB'
  | '2-4MiB'
  | '4-8MiB'
  | '8-16MiB'
  | '16-32MiB'
  | '32-64MiB'
  | '64-128MiB'
  | '128-256MiB'
  | '256-512MiB'
  | '512MiB+';

/** A coarse count: `'0'`, `'1'`, `'2-9'`, `'10-99'`, `'100-999'`, `'1000+'`. @public */
export type CountBucket = '0' | '1' | '2-9' | '10-99' | '100-999' | '1000+';

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
        readonly pagesBucket: CountBucket;
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
export type EditRejectionOrigin = 'command' | 'input';

/** An edit, a command or a tracked change was refused. @public */
export interface EditRejectedDiagnostic extends DiagnosticBase {
  readonly kind: 'edit.rejected';
  readonly code: EditDiagnosticCode;
  /** `'command'` for `exec(...)`, `'input'` for typing, clipboard, drag and pointer edits. */
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
  | FontFailedDiagnostic;

/** The `kind` of every {@link EditorDiagnostic}. @public */
export type EditorDiagnosticKind = EditorDiagnostic['kind'];
