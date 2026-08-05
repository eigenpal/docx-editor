/**
 * Change operations — accept, reject, propose insertion/deletion/replacement.
 */

import type {
  Document,
  DocumentBody,
  Paragraph,
  Run,
  Insertion,
  Deletion,
  ParagraphContent,
  Footnote,
  Endnote,
} from '@docx-editor.dev/core/headless';
import type { RevisionIndex } from '@docx-editor.dev/core/headless';
import { headlessContextOf, recordResolution } from '@docx-editor.dev/core/headless';
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

function resolveTarget(
  doc: Document,
  target: number | ReviewChange,
  notes?: ChangeNotes
): { entry: NonNullable<ReturnType<RevisionIndex['entryBySyntheticId']>> } | null {
  const index = headlessContextOf(doc)?.revisionIndex;
  if (!index) return null;
  if (typeof target !== 'number') {
    if (target.revisionRef) {
      const entry = index.entryByRevisionRef(target.revisionRef);
      return entry ? { entry } : null;
    }
    const story =
      target.noteType && target.noteId !== undefined
        ? ({ kind: target.noteType, noteId: target.noteId } as const)
        : ({ kind: 'body' } as const);
    const match = index.entries.find(
      (entry) =>
        entry.syntheticId === target.id &&
        entry.ref.type === target.type &&
        (entry.ref.story.kind === 'body'
          ? story.kind === 'body'
          : story.kind !== 'body' &&
            entry.ref.story.noteId === (story as { noteId: number }).noteId)
    );
    return match ? { entry: match } : null;
  }
  const bodyMatches = index.entries.filter(
    (entry) => entry.syntheticId === target && entry.ref.story.kind === 'body'
  );
  if (bodyMatches.length === 1) return { entry: bodyMatches[0]! };
  if (bodyMatches.length > 1) return { entry: bodyMatches[0]! };
  if (notes) {
    for (const change of index.entries) {
      if (change.syntheticId !== target) continue;
      if (change.ref.story.kind === 'footnote' || change.ref.story.kind === 'endnote') {
        return { entry: change };
      }
    }
  }
  return null;
}

function applyLegacyResolution(
  doc: Document,
  body: DocumentBody,
  entry: NonNullable<ReturnType<RevisionIndex['entryBySyntheticId']>>,
  mode: 'accept' | 'reject',
  notes?: ChangeNotes,
  processedRefs: Set<string> = new Set()
): boolean {
  if (processedRefs.has(entry.revisionRef)) return false;
  processedRefs.add(entry.revisionRef);
  const { ref, paragraphIndex } = entry;
  const story = ref.story;
  const targets: Array<{ para: Paragraph; match: (item: TrackedChangeItem) => boolean }> = [];

  const matchItem = (item: TrackedChangeItem): boolean =>
    item.type === ref.type &&
    String(item.info.id) === ref.address.id &&
    item.info.author === ref.address.author &&
    (item.info.date ?? null) === (ref.address.date ?? null);

  if (story.kind === 'body') {
    forEachParagraph(body, (para, index) => {
      if (index === paragraphIndex) targets.push({ para, match: matchItem });
    });
  } else if (story.kind === 'footnote') {
    const note = notes?.footnotes?.find((fn) => fn.id === story.noteId);
    if (!note) return false;
    forEachNoteParagraph(note, (para, index) => {
      if (index === paragraphIndex) targets.push({ para, match: matchItem });
    });
  } else {
    const note = notes?.endnotes?.find((en) => en.id === story.noteId);
    if (!note) return false;
    forEachNoteParagraph(note, (para, index) => {
      if (index === paragraphIndex) targets.push({ para, match: matchItem });
    });
  }

  if (targets.length === 0) return false;
  let count = 0;
  for (const target of targets) {
    count += processParagraph(target.para, mode, target.match);
  }

  if (ref.moveName !== undefined) {
    const revisionIndex = headlessContextOf(doc)?.revisionIndex;
    if (revisionIndex) {
      for (const paired of revisionIndex.entriesByMoveName(ref.story, ref.moveName)) {
        if (paired.revisionRef === entry.revisionRef) continue;
        if (applyLegacyResolution(doc, body, paired, mode, notes, processedRefs)) count += 1;
      }
    }
  }

  return count > 0;
}

// ============================================================================
// ACCEPT / REJECT
// ============================================================================

export function acceptChange(
  doc: Document,
  body: DocumentBody,
  target: number | ReviewChange,
  notes?: ChangeNotes
): void {
  if (!processChange(doc, body, target, 'accept', notes)) {
    throw new ChangeNotFoundError(typeof target === 'number' ? target : target.id);
  }
}

export function rejectChange(
  doc: Document,
  body: DocumentBody,
  target: number | ReviewChange,
  notes?: ChangeNotes
): void {
  if (!processChange(doc, body, target, 'reject', notes)) {
    throw new ChangeNotFoundError(typeof target === 'number' ? target : target.id);
  }
}

export function acceptAll(
  doc: Document,
  body: DocumentBody,
  opts?: AcceptChangesOptions,
  notes?: ChangeNotes
): number {
  return processAllChanges(doc, body, 'accept', opts, notes);
}

export function rejectAll(
  doc: Document,
  body: DocumentBody,
  opts?: AcceptChangesOptions,
  notes?: ChangeNotes
): number {
  return processAllChanges(doc, body, 'reject', opts, notes);
}

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

function processChange(
  doc: Document,
  body: DocumentBody,
  target: number | ReviewChange,
  mode: 'accept' | 'reject',
  notes?: ChangeNotes
): boolean {
  const resolved = resolveTarget(doc, target, notes);
  if (resolved) {
    const applied = applyLegacyResolution(doc, body, resolved.entry, mode, notes);
    if (applied) recordResolution(doc, resolved.entry.ref, mode);
    return applied;
  }

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

function processAllChanges(
  doc: Document,
  body: DocumentBody,
  mode: 'accept' | 'reject',
  opts?: AcceptChangesOptions,
  notes?: ChangeNotes
): number {
  const index = headlessContextOf(doc)?.revisionIndex;
  if (index) {
    let count = 0;
    for (const entry of index.entries) {
      if (entry.ref.story.kind === 'footnote' && !opts?.includeFootnotes) continue;
      if (entry.ref.story.kind === 'endnote' && !opts?.includeEndnotes) continue;
      if (
        entry.ref.story.kind !== 'body' &&
        entry.ref.story.kind !== 'footnote' &&
        entry.ref.story.kind !== 'endnote'
      ) {
        continue;
      }
      if (
        entry.ref.story.kind === 'body' ||
        (entry.ref.story.kind === 'footnote' && opts?.includeFootnotes) ||
        (entry.ref.story.kind === 'endnote' && opts?.includeEndnotes)
      ) {
        if (applyLegacyResolution(doc, body, entry, mode, notes)) {
          recordResolution(doc, entry.ref, mode);
          count += 1;
        }
      }
    }
    return count;
  }

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

function processChangeById(body: DocumentBody, id: number, mode: 'accept' | 'reject'): boolean {
  let found = false;
  forEachParagraph(body, (para) => {
    if (processParagraph(para, mode, (item) => item.info.id === id) > 0) found = true;
    if (found) return false;
  });
  return found;
}

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
    const runs = item.content as ParagraphContent[];
    para.content.splice(index, 1, ...runs);
  } else {
    para.content.splice(index, 1);
  }
}

// ============================================================================
// PROPOSE CHANGES
// ============================================================================

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
    content: matchedContent as (Run | import('@docx-editor.dev/core/headless').Hyperlink)[],
  };

  const insertion: Insertion = {
    type: 'insertion',
    info: { id: baseId + 1, author, date: now },
    content: [{ type: 'run', content: [{ type: 'text', text: replaceWith }] } as Run],
  };

  para.content.splice(startIndex, endIndex - startIndex + 1, deletion, insertion);
}

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
    content: matchedContent as (Run | import('@docx-editor.dev/core/headless').Hyperlink)[],
  };

  para.content.splice(startIndex, endIndex - startIndex + 1, deletion);
}

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
  revisionIdCache.set(body, next + 1);
  return next;
}
