/**
 * getChanges() and getComments() — discover tracked changes and comments in a document.
 */

import type { DocumentBody, Run, Comment } from '@eigenpal/docx-core/headless';
import type { ReviewChange, ReviewComment, ChangeFilter, CommentFilter } from './types';
import { getParagraphPlainText } from './textSearch';
import { getRunText, getTrackedChangeText, isTrackedChange, forEachParagraph } from './utils';

/**
 * Collect all tracked changes from the document body.
 */
export function getChanges(body: DocumentBody, filter?: ChangeFilter): ReviewChange[] {
  const grouped = new Map<number, ReviewChange>();

  forEachParagraph(body, (para, paragraphIndex) => {
    let context: string | null = null;

    for (const item of para.content) {
      if (isTrackedChange(item)) {
        if (context === null) context = getParagraphPlainText(para);
        const text = getTrackedChangeText(item.content);
        const id = item.info.id;

        const existing = grouped.get(id);
        if (existing && existing.paragraphIndex === paragraphIndex) {
          existing.text += text;
        } else {
          grouped.set(id, {
            id,
            type: item.type,
            author: item.info.author,
            date: item.info.date ?? null,
            text,
            context,
            paragraphIndex,
          });
        }
      }
    }
  });

  const changes = Array.from(grouped.values());

  return changes.filter((c) => {
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
        // Vanilla view: only deletion / moveFrom contribute to the anchored
        // text. Insertion / moveTo aren't in the doc yet, so an agent reading
        // the comment shouldn't see their text in the anchored snippet.
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
