// Bytes opened ahead of their mount by the open scheduler's `prepare` task.
//
// Keyed by the exact bytes object, and taken once: a session is live editing state, so two
// mounts must never share one. An entry whose mount never comes dies with its bytes.

import { openTreeSession, type OpenTreeSessionResult } from '@docx-editor.dev/core/binding';
import type { ReviewModuleContribution } from '../contracts/modules.ts';
import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import type { OoxmlElement } from '../store/package/ooxml-tree.ts';
import { findNode } from '@docx-editor.dev/core/store';
import { warmResolverGlyphFontFamilies } from './resolver-glyph-font-families.ts';

/** About how long one font warm-up step runs, in milliseconds. */
const FONT_WARM_STEP_MS = 40;
/** Body blocks scanned per warm-up call, between deadline checks. */
const FONT_WARM_BATCH = 16;

const prepared = new WeakMap<Uint8Array, OpenTreeSessionResult>();

/** Open `bytes` now with the review model the mount will pass, and return the result. */
export function prepareOpen(
  bytes: Uint8Array,
  review: { readonly reviewModel?: ReviewModuleContribution }
): OpenTreeSessionResult {
  const opened = openTreeSession(
    bytes,
    review.reviewModel ? { reviewModel: review.reviewModel } : {}
  );
  prepared.set(bytes, opened);
  return opened;
}

/**
 * The mount options for a prepared open of `bytes`, or nothing. Removes the entry. A prepared
 * open is a large one, so its first layout also runs in slices after the mount.
 */
export function takePreparedOpen(bytes: Uint8Array): {
  readonly openedSession?: OpenTreeSessionResult;
  readonly progressiveOpen?: boolean;
} {
  const openedSession = prepared.get(bytes);
  if (openedSession === undefined) return {};
  prepared.delete(bytes);
  return { openedSession, progressiveOpen: true };
}

export {
  continueProgressiveOpen as continueOpen,
  progressiveOpenPending as stillOpening,
} from './surface-progressive-open.ts';

type Step = () => void | Promise<unknown> | Step;

/**
 * The prepare steps after the parse, each in a task of its own: scan `session`'s body for
 * font families about {@link FONT_WARM_STEP_MS} at a time, start the font work, then build
 * the reads the mount would otherwise build in its own task (the node index, the review
 * items). The last step returns the font work for the mount to wait on. A long document's
 * scan and reads took seconds in one task. Stops when `current()` no longer holds, because a
 * newer open replaced this one.
 */
export function openSteps(
  session: TreeDocxSessionView,
  current: () => boolean,
  startFonts: () => void | Promise<unknown>
): Step {
  const body = session.part().root.children.find((child) => child.kind === 'body');
  const blocks = body?.kind === 'body' ? (body.children as readonly OoxmlElement[]) : [];
  let index = 0;
  let fonts: void | Promise<unknown> = undefined;
  const reads: (() => void)[] = [
    () => void findNode(session.part(), ''),
    () => void session.reviewItems(),
  ];
  const step: Step = () => {
    if (!current()) return;
    if (index < blocks.length) {
      const deadline = performance.now() + FONT_WARM_STEP_MS;
      while (index < blocks.length && performance.now() < deadline) {
        warmResolverGlyphFontFamilies(session, blocks.slice(index, index + FONT_WARM_BATCH));
        index += FONT_WARM_BATCH;
      }
      if (index < blocks.length) return step;
      fonts = startFonts();
      return step;
    }
    const read = reads.shift();
    if (!read) return fonts;
    read();
    return step;
  };
  return step;
}
