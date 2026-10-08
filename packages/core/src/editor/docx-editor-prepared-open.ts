// Bytes opened ahead of their mount by the open scheduler's `prepare` task.
//
// Keyed by the exact bytes object, and taken once: a session is live editing state, so two
// mounts must never share one. An entry whose mount never comes dies with its bytes.

import { openTreeSession, type OpenTreeSessionResult } from '@docx-editor.dev/core/binding';
import type { ReviewModuleContribution } from '../contracts/modules.ts';

const prepared = new WeakMap<Uint8Array, OpenTreeSessionResult>();

/** Open `bytes` now with the review model the mount will pass. */
export function prepareOpen(
  bytes: Uint8Array,
  review: { readonly reviewModel?: ReviewModuleContribution }
): void {
  prepared.set(
    bytes,
    openTreeSession(bytes, review.reviewModel ? { reviewModel: review.reviewModel } : {})
  );
}

/** The mount option for a prepared open of `bytes`, or nothing. Removes the entry. */
export function takePreparedOpen(bytes: Uint8Array): {
  readonly openedSession?: OpenTreeSessionResult;
} {
  const openedSession = prepared.get(bytes);
  if (openedSession === undefined) return {};
  prepared.delete(bytes);
  return { openedSession };
}
