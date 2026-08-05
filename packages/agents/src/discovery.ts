/**
 * getChanges() and getComments() — discover tracked changes and comments in a document.
 */

import type {
  DocumentBody,
  Run,
  Comment,
  Footnote,
  Endnote,
  Paragraph,
} from '@docx-editor.dev/core/headless';
import type {
  RevisionIndex,
  RevisionIndexEntry,
  RevisionStory,
} from '@docx-editor.dev/core/headless';
import type { ReviewChange, ReviewComment, ChangeFilter, CommentFilter } from './types';
import { getParagraphPlainText } from './textSearch';
import {
  getRunText,
  getTrackedChangeText,
  isTrackedChange,
  forEachParagraph,
  forEachNoteParagraph,
  getParagraphAtIndex,
} from './utils';

/** The footnote/endnote stores a change walk can reach beyond the body. */
export interface ChangeNotes {
  footnotes?: Footnote[];
  endnotes?: Endnote[];
}

function sameAuthoredTriple(
  a: { id: number; author: string; date?: string },
  b: { id: string; author: string; date?: string }
): boolean {
  return String(a.id) === b.id && a.author === b.author && (a.date ?? null) === (b.date ?? null);
}

function trackedTextInParagraph(
  para: Paragraph,
  type: ReviewChange['type'],
  address: { id: string; author: string; date?: string }
): string {
  let text = '';
  for (const item of para.content) {
    if (!isTrackedChange(item) || item.type !== type) continue;
    if (!sameAuthoredTriple(item.info, address)) continue;
    text += getTrackedChangeText(item.content);
  }
  return text;
}

function contextForParagraph(para: Paragraph): string {
  return getParagraphPlainText(para);
}

function changeIdentityKey(
  change: Pick<
    ReviewChange,
    'type' | 'id' | 'author' | 'date' | 'paragraphIndex' | 'noteType' | 'noteId'
  >
): string {
  return `${change.noteType ?? 'body'}:${change.noteId ?? ''}:${change.paragraphIndex}:${change.type}:${change.id}:${change.author}:${change.date ?? ''}`;
}

function authoredTripleKey(
  story: RevisionStory,
  paragraphIndex: number,
  type: ReviewChange['type'],
  address: { id: string; author: string; date?: string }
): string {
  const noteType = story.kind === 'body' ? undefined : story.kind;
  const noteId = story.kind === 'body' ? undefined : story.noteId;
  return `${noteType ?? 'body'}:${noteId ?? ''}:${paragraphIndex}:${type}:${Number.parseInt(address.id, 10) || address.id}:${address.author}:${address.date ?? ''}`;
}
function changeFromIndexEntry(
  entry: RevisionIndexEntry,
  body: DocumentBody,
  notes?: ChangeNotes
): ReviewChange | null {
  const { ref, syntheticId, paragraphIndex, revisionRef } = entry;
  const story = ref.story;
  let para: Paragraph | undefined;
  let context = '';

  if (story.kind === 'body') {
    try {
      para = getParagraphAtIndex(body, paragraphIndex);
      context = contextForParagraph(para);
    } catch {
      return null;
    }
  } else if (story.kind === 'footnote') {
    const note = notes?.footnotes?.find((fn) => fn.id === story.noteId);
    if (!note) return null;
    forEachNoteParagraph(note, (candidate, i) => {
      if (i === paragraphIndex) para = candidate;
    });
    if (!para) return null;
    context = contextForParagraph(para);
  } else {
    const note = notes?.endnotes?.find((en) => en.id === story.noteId);
    if (!note) return null;
    forEachNoteParagraph(note, (candidate, i) => {
      if (i === paragraphIndex) para = candidate;
    });
    if (!para) return null;
    context = contextForParagraph(para);
  }

  const text = trackedTextInParagraph(para, ref.type, ref.address);
  return {
    id: syntheticId,
    type: ref.type,
    author: ref.address.author,
    date: ref.address.date ?? null,
    text,
    context,
    paragraphIndex,
    revisionRef,
    ...(story.kind === 'body' ? {} : { noteId: story.noteId, noteType: story.kind }),
  };
}

/**
 * Collect all tracked changes from the document body, and — when the filter
 * opts in — from footnote/endnote bodies as well.
 */
export function getChanges(
  body: DocumentBody,
  filter?: ChangeFilter,
  notes?: ChangeNotes,
  revisionIndex?: RevisionIndex
): ReviewChange[] {
  const fromIndex = revisionIndex
    ? revisionIndex.entries
        .map((entry) => changeFromIndexEntry(entry, body, notes))
        .filter((change): change is ReviewChange => change !== null)
    : [];

  const indexedTriples = new Set(
    revisionIndex!.entries.map((entry) =>
      authoredTripleKey(entry.ref.story, entry.paragraphIndex, entry.ref.type, entry.ref.address)
    )
  );
  const legacy = collectLegacyChanges(body, filter, notes).filter(
    (change) => !indexedTriples.has(changeIdentityKey(change))
  );

  // New proposals are absent from the parse-time index; merge them with indexed revisions.
  const changes = revisionIndex ? [...fromIndex, ...legacy] : legacy;

  return changes.filter((change) => {
    if (change.noteType === 'footnote' && !filter?.includeFootnotes) return false;
    if (change.noteType === 'endnote' && !filter?.includeEndnotes) return false;
    if (filter?.author && change.author !== filter.author) return false;
    if (filter?.type && change.type !== filter.type) return false;
    return true;
  });
}

function collectLegacyChanges(
  body: DocumentBody,
  filter?: ChangeFilter,
  notes?: ChangeNotes
): ReviewChange[] {
  const grouped = new Map<string, ReviewChange>();
  const collect = (
    para: Paragraph,
    paragraphIndex: number,
    location: { noteId?: number; noteType?: 'footnote' | 'endnote' }
  ): void => {
    let context: string | null = null;
    for (const item of para.content) {
      if (isTrackedChange(item)) {
        if (context === null) context = getParagraphPlainText(para);
        const text = getTrackedChangeText(item.content);
        const id = item.info.id;
        const key = `${location.noteType ?? 'body'}:${location.noteId ?? ''}:${paragraphIndex}:${item.type}:${id}:${item.info.author}:${item.info.date ?? ''}`;
        const existing = grouped.get(key);
        if (existing) {
          existing.text += text;
        } else {
          grouped.set(key, {
            id,
            type: item.type,
            author: item.info.author,
            date: item.info.date ?? null,
            text,
            context,
            paragraphIndex,
            revisionRef: key,
            ...(location.noteId !== undefined ? { noteId: location.noteId } : {}),
            ...(location.noteType !== undefined ? { noteType: location.noteType } : {}),
          });
        }
      }
    }
  };

  forEachParagraph(body, (para, paragraphIndex) => collect(para, paragraphIndex, {}));
  if (filter?.includeFootnotes && notes?.footnotes) {
    for (const fn of notes.footnotes) {
      forEachNoteParagraph(fn, (para, i) =>
        collect(para, i, { noteId: fn.id, noteType: 'footnote' })
      );
    }
  }
  if (filter?.includeEndnotes && notes?.endnotes) {
    for (const en of notes.endnotes) {
      forEachNoteParagraph(en, (para, i) =>
        collect(para, i, { noteId: en.id, noteType: 'endnote' })
      );
    }
  }

  return Array.from(grouped.values()).filter((c) => {
    if (filter?.author && c.author !== filter.author) return false;
    if (filter?.type && c.type !== filter.type) return false;
    return true;
  });
}

/**
 * Collect all comments from the document body.
 */
export function getComments(body: DocumentBody, filter?: CommentFilter): ReviewComment[] {
  const comments = body.comments ?? [];
  if (comments.length === 0) return [];

  const anchoredTextMap = buildAnchoredTextMap(body);

  const topLevel: Comment[] = [];
  const repliesByParent = new Map<number, Comment[]>();

  for (const c of comments) {
    if (c.parentId !== undefined) {
      const existing = repliesByParent.get(c.parentId) ?? [];
      existing.push(c);
      repliesByParent.set(c.parentId, existing);
    } else {
      topLevel.push(c);
    }
  }

  const result: ReviewComment[] = topLevel.map((c) => {
    const anchor = anchoredTextMap.get(c.id);
    const replies = (repliesByParent.get(c.id) ?? []).map((r) => ({
      id: r.id,
      author: r.author,
      date: r.date ?? null,
      text: getCommentText(r),
    }));

    return {
      id: c.id,
      author: c.author,
      date: c.date ?? null,
      text: getCommentText(c),
      anchoredText: anchor?.text ?? '',
      paragraphIndex: anchor?.paragraphIndex ?? -1,
      replies,
      done: c.done ?? false,
    };
  });

  return result.filter((c) => {
    if (filter?.author && c.author !== filter.author) return false;
    if (filter?.done !== undefined && c.done !== filter.done) return false;
    return true;
  });
}

function getCommentText(comment: Comment): string {
  return comment.content.map((para) => getParagraphPlainText(para)).join('\n');
}

interface AnchorInfo {
  text: string;
  paragraphIndex: number;
}

function buildAnchoredTextMap(body: DocumentBody): Map<number, AnchorInfo> {
  const result = new Map<number, AnchorInfo>();
  const openRanges = new Map<number, { paragraphIndex: number; parts: string[] }>();

  forEachParagraph(body, (para, paragraphIndex) => {
    for (const item of para.content) {
      if (item.type === 'commentRangeStart') {
        openRanges.set(item.id, { paragraphIndex, parts: [] });
      } else if (item.type === 'commentRangeEnd') {
        const open = openRanges.get(item.id);
        if (open) {
          result.set(item.id, { text: open.parts.join(''), paragraphIndex: open.paragraphIndex });
          openRanges.delete(item.id);
        }
      } else if (item.type === 'run') {
        const text = getRunText(item);
        for (const open of openRanges.values()) {
          open.parts.push(text);
        }
      } else if (item.type === 'hyperlink') {
        const text = item.children
          .filter((c): c is Run => c.type === 'run')
          .map(getRunText)
          .join('');
        for (const open of openRanges.values()) {
          open.parts.push(text);
        }
      } else if (isTrackedChange(item)) {
        if (item.type === 'insertion' || item.type === 'moveTo') continue;
        const text = getTrackedChangeText(item.content);
        for (const open of openRanges.values()) {
          open.parts.push(text);
        }
      }
    }
  });

  return result;
}
