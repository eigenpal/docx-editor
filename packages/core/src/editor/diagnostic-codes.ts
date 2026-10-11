/**
 * Internal refusal reasons → public {@link DiagnosticCode}s.
 *
 * The internal reasons (`TreeOpRejection`, `OoxmlPackageRejection`, the surface's refusal
 * sentences) are free to change; the public codes are not. This table is the one place the two
 * meet. Only the RESULT of a lookup leaves the engine: a raw reason can be a sentence, and a
 * package `detail` can name parts of the file, so neither is ever copied into a diagnostic.
 */
import type {
  DocumentOpenDiagnosticCode,
  EditDiagnosticCode,
  FontDiagnosticCode,
  ReviewDiagnosticCode,
} from '../contracts/diagnostics.ts';
import type { EditorFontErrorCode } from '../contracts/editor.ts';
import type { ExecErrorCode } from '../contracts/types.ts';
import type {
  RevisionBatchSkipReason,
  StoryTargetRejection,
  TreeOpRejection,
} from '@docx-editor.dev/core/store';
import type { TreeBindingRejection, TreeSessionRejection } from '@docx-editor.dev/core/binding';
import { FORMS_WRITE_REASON, TRACKED_CHANGES_AUTHOR_REASON } from './command-protection.ts';
import {
  COMMENTS_PROTECTION_REASON,
  FORMS_PROTECTION_SUGGESTING_REASON,
  PRO_COLLABORATION_REASON,
  PRO_REVIEW_REASON,
  READ_ONLY_PROTECTION_REASON,
  SUGGESTING_AUTHOR_REASON,
} from './opening-editing-mode.ts';
import { COLLABORATION_FIELD_RESULTS_REFUSAL } from './field-results-scope.ts';
import { FIELD_CODE_INPUT_REFUSAL } from './surface-field-code-input.ts';
import {
  LOCKED_CONTENT_BREAK_REFUSAL,
  LOCKED_SECTION_BREAK_REFUSAL,
  SUGGESTED_BREAK_REFUSAL,
  TABLE_CELL_BREAK_REFUSAL,
} from './surface-section-breaks.ts';

/**
 * Every open refusal the session can return, by type: a new store reason fails the type check
 * here until it has a public code.
 */
const OPEN_CODES: Readonly<
  Record<Exclude<TreeSessionRejection, 'too-large'> | 'unsupported', DocumentOpenDiagnosticCode>
> = {
  unsupported: 'open.unsupported-source',
  'inflate-error': 'open.zip-corrupt',
  'bad-name': 'open.zip-invalid-entry-name',
  'too-many-entries': 'open.zip-entry-limit',
  'parse-error': 'open.xml-malformed',
  'missing-root': 'open.xml-malformed',
  'multiple-roots': 'open.xml-malformed',
  'invalid-name': 'open.xml-malformed',
  'invalid-namespace': 'open.xml-malformed',
  'undeclared-prefix': 'open.xml-malformed',
  'duplicate-expanded-attribute': 'open.xml-malformed',
  'dtd-forbidden': 'open.xml-dtd-forbidden',
  'entity-forbidden': 'open.xml-dtd-forbidden',
  'too-deep': 'open.xml-depth-limit',
  'too-many-elements': 'open.xml-element-limit',
  'invalid-limits': 'open.invalid-limits',
  'no-content-types': 'open.content-types-invalid',
  'bad-content-types': 'open.content-types-invalid',
  'no-main-document': 'open.missing-main-document',
  'no-main-document-tree': 'open.missing-main-document',
  'bad-relationship-target': 'open.relationships-invalid',
  'duplicate-relationship-id': 'open.relationships-invalid',
  'too-many-relationships': 'open.relationship-limit',
  'too-many-xml-parts': 'open.part-limit',
};

/**
 * The public code for a refused open. `too-large` is the one reason two layers share: the
 * archive reports it WITH the limit it crossed, a single XML part reports it without one.
 */
export function openDiagnosticCode(reason: string, limit?: string): DocumentOpenDiagnosticCode {
  if (reason === 'too-large') {
    if (limit === 'zip.maxRatio') return 'open.zip-ratio-limit';
    return limit === 'zip.maxTotalBytes' ? 'open.zip-size-limit' : 'open.xml-part-size-limit';
  }
  return own<DocumentOpenDiagnosticCode>(OPEN_CODES, reason) ?? 'open.failed';
}

/** Reasons the surface and the facade write themselves, beside the store's. */
type SurfaceRejectionToken =
  | 'automation-structural-tracking-unsupported'
  | 'unsupported-story'
  | 'experimental-collaboration-body-text-only'
  | 'review-module-required'
  | 'no-document'
  | 'table-insert-refused'
  | 'table-of-contents-refused'
  | 'refresh-in-progress';

/** Exhaustive over the store, binding and story reasons, like {@link OPEN_CODES}. */
const EDIT_CODES: Readonly<
  Record<
    TreeOpRejection | TreeBindingRejection | StoryTargetRejection | SurfaceRejectionToken,
    EditDiagnosticCode
  >
> = {
  // Store (`TreeOpRejection`).
  locked: 'edit.protected-content',
  bound: 'edit.protected-content',
  'drawing-locked': 'edit.protected-content',
  'not-adjacent-siblings': 'edit.cross-structure-join',
  'indivisible-content': 'edit.indivisible-content',
  'field-structure': 'edit.field-structure',
  'field-result-unsupported': 'edit.field-structure',
  'carries-section-mark': 'edit.section-mark',
  'table-has-merge': 'edit.table-structure-unsupported',
  'row-hides-cell': 'edit.table-structure-unsupported',
  'unknown-grid-column': 'edit.table-structure-unsupported',
  'cross-cell-drawing': 'edit.table-structure-unsupported',
  trackedDrawingDeletionUnsupported: 'edit.tracked-drawing-delete-unsupported',
  packageTransactionRequired: 'edit.tracked-structure-unsupported',
  'automation-structural-tracking-unsupported': 'edit.tracked-structure-unsupported',
  'unsupported-revision': 'edit.revision-unsupported',
  'unknown-revision': 'edit.stale-target',
  'resource-limit': 'edit.resource-limit',
  'fragment-too-deep': 'edit.resource-limit',
  'fragment-resource-budget': 'edit.resource-limit',
  'fragment-invalid-block': 'edit.unsupported-content',
  unsupported: 'edit.unsupported-content',
  'unsupported-property': 'edit.unsupported-content',
  'unsupported-node': 'edit.unsupported-content',
  'not-a-picture-drawing': 'edit.unsupported-content',
  'unknown-op': 'edit.invalid-argument',
  'invalid-range': 'edit.invalid-argument',
  'offset-out-of-range': 'edit.invalid-argument',
  'splits-surrogate-pair': 'edit.invalid-argument',
  'invalid-text': 'edit.invalid-argument',
  'invalid-property-value': 'edit.invalid-argument',
  'invalid-drawing-value': 'edit.invalid-argument',
  'not-a-list-paragraph': 'edit.invalid-argument',
  typeMismatch: 'edit.invalid-argument',
  invalidArgs: 'edit.invalid-argument',
  'unknown-paragraph': 'edit.stale-target',
  'not-a-paragraph': 'edit.stale-target',
  'unknown-block': 'edit.stale-target',
  'not-a-block': 'edit.stale-target',
  'block-required': 'edit.stale-target',
  'unknown-part': 'edit.stale-target',
  'unknown-content-control': 'edit.stale-target',
  'not-a-content-control': 'edit.stale-target',
  'unknown-control': 'edit.stale-target',
  'unknown-table': 'edit.stale-target',
  'unknown-row': 'edit.stale-target',
  'unknown-drawing': 'edit.stale-target',
  'not-a-drawing': 'edit.stale-target',
  'tree-invariant': 'edit.internal-invariant',
  'package-invariant': 'edit.internal-invariant',
  'duplicate-property-container': 'edit.internal-invariant',
  // Binding (`TreeBindingRejection`): the browser moved the DOM in a way no op explains.
  'paragraph-count-unexplained': 'edit.unmapped-change',
  'paragraph-reordered': 'edit.unmapped-change',
  'unknown-paragraph-id': 'edit.unmapped-change',
  'unknown-content-moved': 'edit.unmapped-change',
  'split-not-clean': 'edit.unmapped-change',
  'join-not-clean': 'edit.unmapped-change',
  // Story targets (`StoryTargetRejection`).
  'unknown-scope': 'edit.unsupported-story',
  'dangling-relationship': 'edit.unsupported-story',
  'wrong-relationship-type': 'edit.unsupported-story',
  'external-relationship': 'edit.unsupported-story',
  'missing-part': 'edit.unsupported-story',
  'bad-relationship-target': 'edit.unsupported-story',
  'not-a-story-part': 'edit.unsupported-story',
  'too-many-story-stores': 'edit.resource-limit',
  'unsupported-story': 'edit.unsupported-story',
  'experimental-collaboration-body-text-only': 'edit.unsupported-story',
  // Surface and facade tokens.
  'review-module-required': 'edit.review-module-required',
  'no-document': 'edit.stale-target',
  'table-insert-refused': 'edit.table-insert-refused',
  'table-of-contents-refused': 'edit.table-of-contents-refused',
  'refresh-in-progress': 'edit.refresh-in-progress',
};

/** The surface's own refusal sentences. Matched by identity of the constant, never by parsing. */
const EDIT_SENTENCES: ReadonlyMap<string, EditDiagnosticCode> = new Map([
  ['the document is open for viewing', 'edit.read-only'],
  ['the document is read-only', 'edit.read-only'],
  ['this content is locked', 'edit.protected-content'],
  [READ_ONLY_PROTECTION_REASON, 'edit.read-only'],
  [COMMENTS_PROTECTION_REASON, 'edit.protected-content'],
  [FORMS_WRITE_REASON, 'edit.protected-content'],
  [FORMS_PROTECTION_SUGGESTING_REASON, 'edit.protected-content'],
  [SUGGESTING_AUTHOR_REASON, 'edit.suggesting-needs-author'],
  [TRACKED_CHANGES_AUTHOR_REASON, 'edit.suggesting-needs-author'],
  [PRO_REVIEW_REASON, 'edit.review-module-required'],
  [PRO_COLLABORATION_REASON, 'edit.unsupported-content'],
  [COLLABORATION_FIELD_RESULTS_REFUSAL, 'edit.unsupported-story'],
  [FIELD_CODE_INPUT_REFUSAL, 'edit.field-structure'],
  [SUGGESTED_BREAK_REFUSAL, 'edit.tracked-structure-unsupported'],
  [TABLE_CELL_BREAK_REFUSAL, 'edit.section-mark'],
  [LOCKED_SECTION_BREAK_REFUSAL, 'edit.protected-content'],
  [LOCKED_CONTENT_BREAK_REFUSAL, 'edit.protected-content'],
  ['An external document refresh is in progress.', 'edit.refresh-in-progress'],
  ['invalid note scope id', 'edit.stale-target'],
  ['note not found', 'edit.stale-target'],
]);

const EXEC_CODES: Readonly<Record<ExecErrorCode, EditDiagnosticCode>> = {
  notFound: 'edit.stale-target',
  ambiguous: 'edit.invalid-argument',
  locked: 'edit.protected-content',
  bound: 'edit.protected-content',
  typeMismatch: 'edit.invalid-argument',
  kindMismatch: 'edit.invalid-argument',
  outOfBounds: 'edit.invalid-argument',
  unsupported: 'edit.unsupported-content',
  invalidArgs: 'edit.invalid-argument',
};

/**
 * The public code for a refused edit. A raw reason the table does not know, such as a
 * sentence written at one call site, falls back to the `exec` result code and then to
 * `edit.refused`. The raw text never leaves this function.
 */
export function editDiagnosticCode(reason: string, execCode?: ExecErrorCode): EditDiagnosticCode {
  // `unsupported-revision:<kind>` carries the revision kind after the colon.
  const token = reason.startsWith('unsupported-revision:') ? 'unsupported-revision' : reason;
  return (
    own<EditDiagnosticCode>(EDIT_CODES, token) ??
    EDIT_SENTENCES.get(reason) ??
    (execCode ? own<EditDiagnosticCode>(EXEC_CODES, execCode) : undefined) ??
    'edit.refused'
  );
}

const REVIEW_CODES: Readonly<Record<RevisionBatchSkipReason, ReviewDiagnosticCode>> = {
  'unsupported-revision': 'review.revision-unsupported',
  'incomplete-group': 'review.incomplete-group',
  'retained-structure': 'review.retained-structure',
  'unknown-revision': 'review.stale-revision',
};

/** The public code for a skipped tracked change, or null for a reason with no public code. */
export function reviewDiagnosticCode(reason: string): ReviewDiagnosticCode | null {
  return own<ReviewDiagnosticCode>(REVIEW_CODES, reason) ?? null;
}

const FONT_CODES: Readonly<Record<EditorFontErrorCode, FontDiagnosticCode>> = {
  wasmUnavailable: 'font.shaper-unavailable',
  initializationFailed: 'font.shaper-unavailable',
  missing: 'font.missing',
  forbidden: 'font.load-failed',
  overLimit: 'font.size-limit',
  malformed: 'font.malformed',
  fontFaceLoadFailed: 'font.load-failed',
  loadFailed: 'font.load-failed',
  missingFont: 'font.missing',
  hashMismatch: 'font.integrity-mismatch',
  hashInvalid: 'font.integrity-mismatch',
  metadataMismatch: 'font.integrity-mismatch',
  fontMismatch: 'font.integrity-mismatch',
  unsupportedFaceIndex: 'font.unsupported-face',
  unsupportedFace: 'font.unsupported-face',
};

/** The public code for a font failure. Unknown codes count as a failed load. */
export function fontDiagnosticCode(code: string | undefined): FontDiagnosticCode {
  return (
    (code !== undefined ? own<FontDiagnosticCode>(FONT_CODES, code) : undefined) ??
    'font.load-failed'
  );
}

/** Own-property lookup, so a reason such as `constructor` cannot reach `Object.prototype`. */
function own<T>(table: object, key: string): T | undefined {
  return Object.hasOwn(table, key) ? (table as Record<string, T>)[key] : undefined;
}
