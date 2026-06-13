/**
 * Change operations — accept, reject, propose insertion/deletion/replacement.
 */

import type {
  DocumentBody,
  Paragraph,
  Run,
  Insertion,
  Deletion,
  ParagraphContent,
  Footnote,
  Endnote,
} from '@eigenpal/docx-editor-core/headless';
import type {
  ProposeReplacementOptions,
  ProposeInsertionOptions,
  ProposeDeletionOptions,
  ReviewChange,
  AcceptChangesOptions,
} from './types';
import type { ChangeNotes } from './discovery';
import { ChangeNotFoundError } from './errors';
import { isolateMatchedText } from './textSearch';
import {
  isTrackedChange,
  getParagraphAtIndex,
  forEachParagraph,
  forEachNoteParagraph,
  type TrackedChangeItem,
} from './utils';

// ============================================================================
// ACCEPT / REJECT
// ============================================================================

/**
 * Accept a tracked change.
 *
 * Pass a numeric revision id to accept a change in the document **body** (the
 * historical signature). Pass a {@link ReviewChange} from `getChanges` to accept
 * a change wherever it lives — a change carrying `noteType`/`noteId` is resolved
 * inside that footnote/endnote (the `notes` arg supplies the note stores). A
 * `ReviewChange` with no `noteType` resolves in the body, like the numeric form.
 *
 * Insertion: keep text, remove wrapper. Deletion: remove text and wrapper.
 */
export function acceptChange(
  body: DocumentBody,
  target: number | ReviewChange,
  notes?: ChangeNotes
): void {
  if (!processChange(body, target, 'accept', notes)) {
    throw new ChangeNotFoundError(typeof target === 'number' ? target : target.id);
  }
}

/**
 * Reject a tracked change. See {@link acceptChange} for body-vs-note targeting.
 * Insertion: remove text and wrapper. Deletion: keep text, remove wrapper.
 */
export function rejectChange(
  body: DocumentBody,
  target: number | ReviewChange,
  notes?: ChangeNotes
): void {
  if (!processChange(body, target, 'reject', notes)) {
    throw new ChangeNotFoundError(typeof target === 'number' ? target : target.id);
  }
}

/**
 * Accept all tracked changes in the body. Pass `{ includeFootnotes,
 * includeEndnotes }` (and the `notes` stores) to also resolve changes inside
 * note bodies. Returns the total count processed.
 */
export function acceptAll(
  body: DocumentBody,
  opts?: AcceptChangesOptions,
  notes?: ChangeNotes
): number {
  return processAllChanges(body, 'accept', opts, notes);
}

/**
 * Reject all tracked changes. See {@link acceptAll} for note opt-in.
 */
export function rejectAll(
  body: DocumentBody,
  opts?: AcceptChangesOptions,
  notes?: ChangeNotes
): number {
  return processAllChanges(body, 'reject', opts, notes);
}

/**
 * Accept/reject every tracked-change item in a paragraph that matches `match`.
 * Iterates backward so splice doesn't shift unprocessed indices. Returns the
 * number of items processed. Shared by the body walk and the note walk.
 */
function processParagraph(
  para: Paragraph,
  mode: 'accept' | 'reject',
  match: (item: TrackedChangeItem) => boolean
): number {
  let count = 0;
  for (let i = para.content.length - 1; i >= 0; i--) {
    const item = para.content[i];
    if (isTrackedChange(item) && match(item)) {
      applyChangeAtIndex(para, i, item, mode);
      count++;
    }
  }
  return count;
}

/** Resolve a single change — in the body, or in a note when `target` carries `noteType`/`noteId`. */
function processChange(
  body: DocumentBody,
  target: number | ReviewChange,
  mode: 'accept' | 'reject',
  notes?: ChangeNotes
): boolean {
  // Note-intent: any ReviewChange carrying `noteType` routes to the note path —
  // including a malformed one missing `noteId`, which then fails loud (note not
  // found → ChangeNotFoundError) rather than silently resolving in the body.
  if (typeof target !== 'number' && target.noteType) {
    const list = target.noteType === 'footnote' ? notes?.footnotes : notes?.endnotes;
    const note =
      target.noteId !== undefined ? list?.find((n) => n.id === target.noteId) : undefined;
    if (!note) return false;
    return processChangeInNote(note, target.id, mode);
  }
  const id = typeof target === 'number' ? target : target.id;
  return processChangeById(body, id, mode);
}

/**
 * Process all tracked changes in a single pass (O(M) where M = total paragraphs),
 * across the body and — when opted in — footnote/endnote bodies.
 */
function processAllChanges(
  body: DocumentBody,
  mode: 'accept' | 'reject',
  opts?: AcceptChangesOptions,
  notes?: ChangeNotes
): number {
  let count = 0;
  forEachParagraph(body, (para) => {
    count += processParagraph(para, mode, () => true);
  });
  if (opts?.includeFootnotes && notes?.footnotes) {
    for (const fn of notes.footnotes) {
      forEachNoteParagraph(fn, (para) => {
        count += processParagraph(para, mode, () => true);
      });
    }
  }
  if (opts?.includeEndnotes && notes?.endnotes) {
    for (const en of notes.endnotes) {
      forEachNoteParagraph(en, (para) => {
        count += processParagraph(para, mode, () => true);
      });
    }
  }
  return count;
}

/**
 * Find and process a tracked change by revision id in the document body.
 * Processes ALL items with matching id within the first paragraph that contains
 * it (a revision can span multiple items), then stops — the body's established
 * semantics.
 */
function processChangeById(body: DocumentBody, id: number, mode: 'accept' | 'reject'): boolean {
  let found = false;
  forEachParagraph(body, (para) => {
    if (processParagraph(para, mode, (item) => item.info.id === id) > 0) found = true;
    // Stop traversal once we've found and processed the change
    if (found) return false;
  });
  return found;
}

/**
 * Process a tracked change by revision id inside a single note. Unlike the body
 * path, this scans ALL of the note's paragraphs (a note is a small, bounded
 * scope, and a revision can span its paragraphs) — matching what `getChanges`
 * accumulates for that change.
 */
function processChangeInNote(
  note: Footnote | Endnote,
  id: number,
  mode: 'accept' | 'reject'
): boolean {
  let found = false;
  forEachNoteParagraph(note, (para) => {
    if (processParagraph(para, mode, (item) => item.info.id === id) > 0) found = true;
  });
  return found;
}

function applyChangeAtIndex(
  para: Paragraph,
  index: number,
  item: TrackedChangeItem,
  mode: 'accept' | 'reject'
) {
  const keepContent =
    (item.type === 'insertion' && mode === 'accept') ||
    (item.type === 'deletion' && mode === 'reject') ||
    (item.type === 'moveTo' && mode === 'accept') ||
    (item.type === 'moveFrom' && mode === 'reject');

  if (keepContent) {
    // Unwrap: replace the tracked change wrapper with its content runs
    const runs = item.content as ParagraphContent[];
    para.content.splice(index, 1, ...runs);
  } else {
    // Remove: delete the tracked change and its content
    para.content.splice(index, 1);
  }
}

// ============================================================================
// PROPOSE CHANGES
// ============================================================================

/**
 * Propose a text replacement as a tracked change (deletion + insertion).
 */
export function proposeReplacement(body: DocumentBody, options: ProposeReplacementOptions): void {
  const { paragraphIndex, search, author = 'AI', replaceWith } = options;
  const para = getParagraphAtIndex(body, paragraphIndex);

  const { startIndex, endIndex } = isolateMatchedText(para, search, paragraphIndex);

  const now = new Date().toISOString();
  const baseId = nextRevisionId(body);

  const matchedContent = para.content.slice(startIndex, endIndex + 1);

  const deletion: Deletion = {
    type: 'deletion',
    info: { id: baseId, author, date: now },
    content: matchedContent as (Run | import('@eigenpal/docx-editor-core/headless').Hyperlink)[],
  };

  const insertion: Insertion = {
    type: 'insertion',
    info: { id: baseId + 1, author, date: now },
    content: [{ type: 'run', content: [{ type: 'text', text: replaceWith }] } as Run],
  };

  para.content.splice(startIndex, endIndex - startIndex + 1, deletion, insertion);
}

/**
 * Propose an insertion as a tracked change.
 */
export function proposeInsertion(body: DocumentBody, options: ProposeInsertionOptions): void {
  const { paragraphIndex, author = 'AI', insertText, position = 'after', search } = options;
  const para = getParagraphAtIndex(body, paragraphIndex);

  const now = new Date().toISOString();
  const id = nextRevisionId(body);

  const insertion: Insertion = {
    type: 'insertion',
    info: { id, author, date: now },
    content: [{ type: 'run', content: [{ type: 'text', text: insertText }] } as Run],
  };

  if (search) {
    const { startIndex, endIndex } = isolateMatchedText(para, search, paragraphIndex);
    const insertAt = position === 'after' ? endIndex + 1 : startIndex;
    para.content.splice(insertAt, 0, insertion);
  } else {
    if (position === 'before') {
      para.content.unshift(insertion);
    } else {
      para.content.push(insertion);
    }
  }
}

/**
 * Propose a deletion as a tracked change.
 */
export function proposeDeletion(body: DocumentBody, options: ProposeDeletionOptions): void {
  const { paragraphIndex, search, author = 'AI' } = options;
  const para = getParagraphAtIndex(body, paragraphIndex);

  const { startIndex, endIndex } = isolateMatchedText(para, search, paragraphIndex);

  const now = new Date().toISOString();
  const id = nextRevisionId(body);

  const matchedContent = para.content.slice(startIndex, endIndex + 1);

  const deletion: Deletion = {
    type: 'deletion',
    info: { id, author, date: now },
    content: matchedContent as (Run | import('@eigenpal/docx-editor-core/headless').Hyperlink)[],
  };

  para.content.splice(startIndex, endIndex - startIndex + 1, deletion);
}

// ============================================================================
// HELPERS
// ============================================================================

/** Cached max revision ID per body — avoids O(N) scan on every proposal. */
const revisionIdCache = new WeakMap<DocumentBody, number>();

function nextRevisionId(body: DocumentBody): number {
  let maxId = revisionIdCache.get(body);
  if (maxId === undefined) {
    maxId = 0;
    forEachParagraph(body, (para) => {
      for (const item of para.content) {
        if (isTrackedChange(item)) {
          maxId = Math.max(maxId!, item.info.id);
        }
      }
    });
  }
  const next = maxId + 1;
  // Reserve both next and next+1 (replacement uses two IDs)
  revisionIdCache.set(body, next + 1);
  return next;
}
