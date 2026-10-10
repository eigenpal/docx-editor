/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/pro/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The review hooks' `adopt`, shared so the React and Vue twins cannot drift.

import type { Editor, ReviewItemPlacement } from '@docx-editor.dev/core/contracts/editor';

/**
 * Who and when an adopted change records.
 *
 * @public
 */
export interface ReviewAdoptOptions {
  /** The author to record. Defaults to the editor's `author`, the person reviewing. */
  readonly author?: string;
  /** The date to record. Omit it to keep each change's own date. */
  readonly date?: Date;
}

/**
 * Attribute the revision items among `items` to the reviewer, or to `options.author`.
 * One command, so every change moves in one undo step. Comment items are not changes.
 */
export function adoptReviewItems(
  editor: Editor | null,
  items: ReviewItemPlacement | readonly ReviewItemPlacement[],
  options: ReviewAdoptOptions = {}
): boolean {
  const list: readonly ReviewItemPlacement[] = Array.isArray(items)
    ? items
    : [items as ReviewItemPlacement];
  const keys = list.flatMap((item) => (item.kind === 'revision' ? [item.key] : []));
  const { author, date } = options;
  if (!editor || keys.length === 0) return false;
  if (date !== undefined && (!(date instanceof Date) || Number.isNaN(date.getTime()))) return false;
  return editor.exec({
    type: 'setReviewChangesAuthor',
    keys,
    ...(author === undefined ? {} : { author }),
    ...(date === undefined ? {} : { date: date.toISOString() }),
  }).ok;
}
