/**
 * Comment operations — addComment, replyTo
 */

import type { DocumentBody, Paragraph, Comment, Run } from '@eigenpal/docx-core/headless';
import type { AddCommentOptions, ReplyOptions } from './types';
import { CommentNotFoundError } from './errors';
import { findTextInParagraph } from './textSearch';
import { getParagraphAtIndex } from './utils';

/**
 * Add a comment to a paragraph. Returns the new comment ID.
 */
export function addComment(body: DocumentBody, options: AddCommentOptions): number {
  const { paragraphIndex, author, text, search } = options;
  const para = getParagraphAtIndex(body, paragraphIndex);

  const existingIds = (body.comments ?? []).map((c) => c.id);
  const newId = existingIds.length > 0 ? Math.max(...existingIds) + 1 : 1;

  const comment: Comment = {
    id: newId,
    author,
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'run', content: [{ type: 'text', text }] } as Run],
        formatting: {},
      } as Paragraph,
    ],
  };

  if (!body.comments) {
    body.comments = [];
  }
  body.comments.push(comment);

  if (search) {
    const result = findTextInParagraph(para, search, paragraphIndex);
    // Insert end marker after end item, then start marker before start item
    para.content.splice(result.endRunIndex + 1, 0, { type: 'commentRangeEnd', id: newId });
    para.content.splice(result.startRunIndex, 0, { type: 'commentRangeStart', id: newId });
  } else {
    para.content.unshift({ type: 'commentRangeStart', id: newId });
    para.content.push({ type: 'commentRangeEnd', id: newId });
  }

  return newId;
}

/**
 * Reply to an existing comment. Returns the reply's comment ID.
 */
export function replyTo(body: DocumentBody, commentId: number, options: ReplyOptions): number {
  const comments = body.comments ?? [];
  const parent = comments.find((c) => c.id === commentId);
  if (!parent) {
    throw new CommentNotFoundError(commentId);
  }

  const existingIds = comments.map((c) => c.id);
  const newId = Math.max(...existingIds) + 1;

  const reply: Comment = {
    id: newId,
    author: options.author,
    date: new Date().toISOString(),
    parentId: commentId,
    content: [
      {
        type: 'paragraph',
        content: [{ type: 'run', content: [{ type: 'text', text: options.text }] } as Run],
        formatting: {},
      } as Paragraph,
    ],
  };

  comments.push(reply);
  return newId;
}
