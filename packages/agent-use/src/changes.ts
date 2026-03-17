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
} from '@eigenpal/docx-core/headless';
import type {
  ProposeReplacementOptions,
  ProposeInsertionOptions,
  ProposeDeletionOptions,
} from './types';
import { ChangeNotFoundError } from './errors';
import { isolateMatchedText } from './textSearch';
import {
  isTrackedChange,
  getParagraphAtIndex,
  forEachParagraph,
  type TrackedChangeItem,
} from './utils';

// ============================================================================
// ACCEPT / REJECT
// ============================================================================

/**
 * Accept a tracked change by ID.
 * Insertion: keep text, remove wrapper.
 * Deletion: remove text and wrapper.
 */
export function acceptChange(body: DocumentBody, id: number): void {
  if (!processChangeById(body, id, 'accept')) {
    throw new ChangeNotFoundError(id);
  }
}

/**
 * Reject a tracked change by ID.
 * Insertion: remove text and wrapper.
 * Deletion: keep text, remove wrapper.
 */
export function rejectChange(body: DocumentBody, id: number): void {
  if (!processChangeById(body, id, 'reject')) {
    throw new ChangeNotFoundError(id);
  }
}

/**
 * Accept all tracked changes. Returns count.
 */
export function acceptAll(body: DocumentBody): number {
  return processAllChanges(body, 'accept');
}

/**
 * Reject all tracked changes. Returns count.
 */
export function rejectAll(body: DocumentBody): number {
  return processAllChanges(body, 'reject');
}

/**
 * Process all tracked changes in a single pass (O(M) where M = total paragraphs).
 * Iterates backward within each paragraph so splice doesn't shift unprocessed indices.
 */
function processAllChanges(body: DocumentBody, mode: 'accept' | 'reject'): number {
  let count = 0;
  forEachParagraph(body, (para) => {
    for (let i = para.content.length - 1; i >= 0; i--) {
      const item = para.content[i];
      if (isTrackedChange(item)) {
        applyChangeAtIndex(para, i, item, mode);
        count++;
      }
    }
  });
  return count;
}

/**
 * Find and process a tracked change by revision ID.
 * Processes ALL content items with matching ID (a revision can span multiple items).
 */
function processChangeById(body: DocumentBody, id: number, mode: 'accept' | 'reject'): boolean {
  let found = false;
  forEachParagraph(body, (para) => {
    // Iterate backward so splicing doesn't shift unprocessed indices
    for (let i = para.content.length - 1; i >= 0; i--) {
      const item = para.content[i];
      if (isTrackedChange(item) && item.info.id === id) {
        applyChangeAtIndex(para, i, item, mode);
        found = true;
      }
    }
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
  const { paragraphIndex, search, author, replaceWith } = options;
  const para = getParagraphAtIndex(body, paragraphIndex);

  const { startIndex, endIndex } = isolateMatchedText(para, search, paragraphIndex);

  const now = new Date().toISOString();
  const baseId = nextRevisionId(body);

  const matchedContent = para.content.slice(startIndex, endIndex + 1);

  const deletion: Deletion = {
    type: 'deletion',
    info: { id: baseId, author, date: now },
    content: matchedContent as (Run | import('@eigenpal/docx-core/headless').Hyperlink)[],
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
  const { paragraphIndex, author, insertText, position = 'after', search } = options;
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
  const { paragraphIndex, search, author } = options;
  const para = getParagraphAtIndex(body, paragraphIndex);

  const { startIndex, endIndex } = isolateMatchedText(para, search, paragraphIndex);

  const now = new Date().toISOString();
  const id = nextRevisionId(body);

  const matchedContent = para.content.slice(startIndex, endIndex + 1);

  const deletion: Deletion = {
    type: 'deletion',
    info: { id, author, date: now },
    content: matchedContent as (Run | import('@eigenpal/docx-core/headless').Hyperlink)[],
  };

  para.content.splice(startIndex, endIndex - startIndex + 1, deletion);
}

// ============================================================================
// HELPERS
// ============================================================================

function nextRevisionId(body: DocumentBody): number {
  let maxId = 0;
  forEachParagraph(body, (para) => {
    for (const item of para.content) {
      if (isTrackedChange(item)) {
        maxId = Math.max(maxId, item.info.id);
      }
    }
  });
  return maxId + 1;
}
