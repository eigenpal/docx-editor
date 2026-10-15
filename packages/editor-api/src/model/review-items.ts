/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The bridge from the editor's review queue to this object model.
//
// A review surface lists cards by `key` (`editor.getReviewItems()`, `useReview().items`); this
// object model reaches tracked changes through ranges and collections. These functions turn one
// key into the `Range` its item covers, so a caller continues with standard members:
// `getReviewItemRange(context, item.key).revisions`.
//
// INFRASTRUCTURE, NOT AN OFFICE MEMBER. Office.js has no review queue and no key for a revision,
// so this lives beside the object model as a free function rather than as a method on `Document`
// or `RevisionCollection`. It follows the `get…` / `get…OrNullObject` convention so a stale key
// reads the way any other missing item does.

import { Range } from './range.ts';
import {
  fail,
  hydratedSpans,
  internalsOf,
  type ContextInternals,
  type RequestContext,
} from '../runtime/model-support.ts';

function reviewItemRange(context: RequestContext, key: string, nullable: boolean): Range {
  const target = nullable ? 'getReviewItemRangeOrNullObject' : 'getReviewItemRange';
  const internals =
    typeof context === 'object' && context !== null
      ? (internalsOf(context) as ContextInternals | undefined)
      : undefined;
  if (!internals) fail({ code: 'InvalidArgument', target });
  if (typeof key !== 'string' || key.length === 0) fail({ code: 'InvalidArgument', target });
  // A custom node's card has no tracked change or comment behind it.
  if (key.startsWith('custom-')) fail({ code: 'NotSupported', target });
  internals.assertUsable(target);
  const found = Range.promised(context, target, nullable);
  internals.queue.push({
    sort: 'read',
    label: target,
    plan: () => ({ op: 'getReviewItemRange', key }),
    settle: (value) => {
      const [span] = hydratedSpans(value, target);
      if (span) found.hydrateAddress({ kind: 'span', span });
      else if (nullable) found.hydrateNull();
      else fail({ code: 'ItemNotFound', target });
    },
  });
  return found;
}

/**
 * The range a review item covers, by the key the editor's review queue gives it.
 *
 * Pass the `key` of an item from `editor.getReviewItems()` or `useReview().items`. A tracked
 * change resolves to the characters it covers. A paired replacement key resolves to one range
 * over both its deletion and its insertion. A comment or reply resolves to the range its thread
 * is anchored to. The range is a snapshot like any other, so read it in the same run as the key.
 *
 * Read {@link Range.revisions} on the result to reach the tracked changes as `Revision` objects.
 * A key that names nothing in the document, such as one whose change was already accepted,
 * fails the sync with `ItemNotFound`. Use {@link getReviewItemRangeOrNullObject} to test for that
 * instead. A custom node's key refuses with `NotSupported` at the call.
 *
 * This is a DocxEditor addition. Office.js has no review queue and no key for a revision.
 *
 * @param context - The request context of the current `run()`.
 * @param key - The review item's `key`.
 * @returns A range that becomes addressable at the next `context.sync()`.
 *
 * @example Accept the change a review card shows
 * ```ts
 * import { getReviewItemRange } from '@docx-editor.dev/editor-api/browser';
 *
 * await runtime.run(async (context) => {
 *   const revisions = getReviewItemRange(context, item.key).revisions;
 *   revisions.load('items/type,items/author');
 *   await context.sync();
 *
 *   for (const revision of revisions.items) revision.accept();
 *   await context.sync();
 * });
 * ```
 *
 * @public
 */
export function getReviewItemRange(context: RequestContext, key: string): Range {
  return reviewItemRange(context, key, false);
}

/**
 * The range a review item covers, or a null object when the key names nothing.
 *
 * The same lookup as {@link getReviewItemRange}. A key that names nothing in the document
 * answers a range whose `isNullObject` is `true` after the sync, instead of failing it.
 *
 * This is a DocxEditor addition. Office.js has no review queue and no key for a revision.
 *
 * @param context - The request context of the current `run()`.
 * @param key - The review item's `key`.
 * @returns A range whose `isNullObject` is known after the next `context.sync()`.
 *
 * @example Skip a card whose change another reviewer already resolved
 * ```ts
 * import { getReviewItemRangeOrNullObject } from '@docx-editor.dev/editor-api/browser';
 *
 * await runtime.run(async (context) => {
 *   const range = getReviewItemRangeOrNullObject(context, item.key);
 *   range.load('text');
 *   await context.sync();
 *
 *   if (range.isNullObject) return;
 *   console.log(range.text);
 * });
 * ```
 *
 * @public
 */
export function getReviewItemRangeOrNullObject(context: RequestContext, key: string): Range {
  return reviewItemRange(context, key, true);
}
