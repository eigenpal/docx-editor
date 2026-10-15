/*
Copyright (c) 2026 EigenPal, Inc. All rights reserved.
Licensed under the EigenPal Pro Evaluation License 1.0 — see packages/editor-api/LICENSE.md.
Production use requires a commercial agreement: licensing@eigenpal.com
*/
// The bridge from the editor's review queue to this object model.
//
// A review surface lists cards by `key` (`editor.getReviewItems()`, `useReview().items`); this
// object model reaches tracked changes through ranges and collections. These functions turn one
// key into the revisions its card stands for, or into the `Range` its item covers.
//
// INFRASTRUCTURE, NOT AN OFFICE MEMBER. Office.js has no review queue and no key for a revision,
// so these live beside the object model as free functions rather than as methods on `Document`
// or `RevisionCollection`. The range lookup follows the `get…` / `get…OrNullObject` convention so
// a stale key reads the way any other missing item does.

import { Range } from './range.ts';
import { RevisionCollection } from './review.ts';
import {
  ObjectPath,
  fail,
  hydratedSpans,
  internalsOf,
  type ContextInternals,
  type RequestContext,
} from '../runtime/model-support.ts';

/** The context's internals after the checks every bridge call makes at the call. */
function admitted(
  context: RequestContext,
  key: string,
  target: string,
  refused: readonly string[]
): ContextInternals {
  const internals =
    typeof context === 'object' && context !== null
      ? (internalsOf(context) as ContextInternals | undefined)
      : undefined;
  if (!internals) fail({ code: 'InvalidArgument', target });
  if (typeof key !== 'string' || key.length === 0) fail({ code: 'InvalidArgument', target });
  if (refused.some((prefix) => key.startsWith(prefix))) fail({ code: 'NotSupported', target });
  internals.assertUsable(target);
  return internals;
}

function reviewItemRange(context: RequestContext, key: string, nullable: boolean): Range {
  const target = nullable ? 'getReviewItemRangeOrNullObject' : 'getReviewItemRange';
  // A custom node's card has no tracked change or comment behind it.
  const internals = admitted(context, key, target, ['custom-']);
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
 * The tracked changes a review card stands for, by the key the editor's review queue gives it.
 *
 * Pass the `key` of a revision item from `editor.getReviewItems()` or `useReview().items`. The
 * collection holds that change only, or the deletion and the insertion of a paired replacement.
 * Unlike {@link Range.revisions} on the card's range, it never holds a nested or adjacent change
 * by another author.
 *
 * A key that names nothing in the document, such as one whose change was already resolved,
 * loads an empty collection, and `acceptAll()` or `rejectAll()` on it refuses with
 * `InvalidObjectPath`. A comment or custom node key refuses with `NotSupported` at the call.
 * `resolve()` and `setAuthor()` refuse with `NotSupported` on this collection.
 *
 * This is a DocxEditor addition. Office.js has no review queue and no key for a revision.
 *
 * @param context - The request context of the current `run()`.
 * @param key - The review item's `key`.
 * @returns The change or changes that the key names.
 *
 * @example Accept the change a review card shows
 * ```ts
 * import { getReviewItemRevisions } from '@docx-editor.dev/editor-api/browser';
 *
 * const key = item.key; // From useReview().items or editor.getReviewItems().
 * await runtime.run(async (context) => {
 *   getReviewItemRevisions(context, key).acceptAll();
 *   await context.sync();
 * });
 * ```
 *
 * @public
 */
export function getReviewItemRevisions(context: RequestContext, key: string): RevisionCollection {
  const target = 'getReviewItemRevisions';
  const internals = admitted(context, key, target, ['custom-', 'comment-']);
  return RevisionCollection.ofReviewKey(
    context,
    target,
    ObjectPath.of('document', internals.roots().document),
    key
  );
}

/**
 * The range a review item covers, by the key the editor's review queue gives it.
 *
 * Pass the `key` of an item from `editor.getReviewItems()` or `useReview().items`. A tracked
 * change resolves to the characters it covers. A paired replacement key resolves to one range
 * over both its deletion and its insertion. A comment or reply resolves to the range its thread
 * is anchored to. The range is a snapshot like any other.
 *
 * To act on the card's own change, use {@link getReviewItemRevisions}. {@link Range.revisions} on
 * this range also lists nested or adjacent changes that the range overlaps.
 *
 * A key that names nothing in the document, such as one whose change was already accepted, or a
 * comment with no anchor in the document, fails the sync with `ItemNotFound`. Use
 * {@link getReviewItemRangeOrNullObject} to test for that instead. A custom node's key refuses
 * with `NotSupported` at the call.
 *
 * This is a DocxEditor addition. Office.js has no review queue and no key for a revision.
 *
 * @param context - The request context of the current `run()`.
 * @param key - The review item's `key`.
 * @returns A range that becomes addressable at the next `context.sync()`.
 *
 * @example Read the words a comment card is about
 * ```ts
 * import { getReviewItemRange } from '@docx-editor.dev/editor-api/browser';
 *
 * const key = item.key; // From useReview().items or editor.getReviewItems().
 * const text = await runtime.run(async (context) => {
 *   const range = getReviewItemRange(context, key);
 *   range.load('text');
 *   await context.sync();
 *   return range.text;
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
 * const key = item.key; // From useReview().items or editor.getReviewItems().
 * await runtime.run(async (context) => {
 *   const range = getReviewItemRangeOrNullObject(context, key);
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
