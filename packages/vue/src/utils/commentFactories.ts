/**
 * Pure factories for building `Comment` objects. Decoupled from Vue
 * reactivity so they can be unit-tested and reused.
 */

import type { Comment } from '@eigenpal/docx-editor-core/types/document';

/**
 * Build a `Comment` with an id one past the current max id in
 * `existingComments`. Pass an empty array for the first comment in a
 * fresh document.
 */
export function createComment(
  existingComments: Comment[],
  text: string,
  author: string,
  parentId?: number
): Comment {
  const maxId = existingComments.reduce((max, comment) => Math.max(max, comment.id), 0);
  return {
    id: maxId + 1,
    author,
    date: new Date().toISOString(),
    content: [
      {
        type: 'paragraph',
        properties: {},
        content: [{ type: 'run', properties: {}, content: [{ type: 'text', text }] }],
      },
    ] as unknown as Comment['content'],
    ...(parentId != null ? { parentId } : {}),
  };
}
