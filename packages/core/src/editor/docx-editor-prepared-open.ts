// Bytes opened ahead of their mount by the open scheduler's `prepare` task.
//
// Keyed by the exact bytes object, and taken once: a session is live editing state, so two
// mounts must never share one. An entry whose mount never comes dies with its bytes.

import { openTreeSession, type OpenTreeSessionResult } from '@docx-editor.dev/core/binding';
import type { ReviewModuleContribution } from '../contracts/modules.ts';
import type { TreeDocxSessionView } from '../binding/tree-session-contract.ts';
import type { OoxmlElement, OoxmlNode } from '../store/package/ooxml-tree.ts';
import { nodeIndexSteps } from '../store/package/ooxml-edit.ts';
import {
  warmResolverGlyphFontFamilies,
  warmResolverGlyphFontTableRows,
} from './resolver-glyph-font-families.ts';
import { warmLayoutNodeDigests } from '../layout/layout-cache.ts';

/** About how long one font warm-up step runs, in milliseconds. */
const FONT_WARM_STEP_MS = 40;
/** Body blocks scanned per warm-up call, between deadline checks. */
const FONT_WARM_BATCH = 16;
/** Rows of one table scanned per warm-up call, between deadline checks. */
const FONT_WARM_ROWS = 32;

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
 * font families about {@link FONT_WARM_STEP_MS} at a time, start the font work, digest the
 * body for layout keys the same way (a table row by row), then build the reads the mount
 * would otherwise build in its own task (the node index, the review items). The last step
 * returns the font work for the mount to wait on. A long document's scan, hashing, and reads
 * took seconds in one task. Stops when `current()` no longer holds, because a newer open
 * replaced this one.
 */
export function openSteps(
  session: TreeDocxSessionView,
  current: () => boolean,
  startFonts: () => void | Promise<unknown>
): Step {
  const body = session.part().root.children.find((child) => child.kind === 'body');
  const blocks = body?.kind === 'body' ? (body.children as readonly OoxmlElement[]) : [];
  // A table's rows come before the table, so its own digest only joins theirs.
  const digests: OoxmlNode[] = [];
  for (const block of blocks) {
    if (block.kind === 'table') for (const row of block.children) digests.push(row);
    digests.push(block);
  }
  // Font work, in calls a deadline can fall between: plain blocks in batches, a table a few
  // rows at a time and then as a whole (its rows are cached by then).
  const fontCalls: (() => void)[] = [];
  for (let start = 0; start < blocks.length; ) {
    const block = blocks[start]!;
    if (block.kind === 'table') {
      for (let row = 0; row < block.children.length; row += FONT_WARM_ROWS) {
        const from = row;
        fontCalls.push(() => {
          warmResolverGlyphFontTableRows(session, block, from, from + FONT_WARM_ROWS);
        });
      }
      fontCalls.push(() => warmResolverGlyphFontFamilies(session, [block]));
      start += 1;
      continue;
    }
    let end = start;
    while (end < blocks.length && end - start < FONT_WARM_BATCH && blocks[end]!.kind !== 'table')
      end += 1;
    const batch = blocks.slice(start, end);
    fontCalls.push(() => warmResolverGlyphFontFamilies(session, batch));
    start = end;
  }
  let scanned = 0;
  let digested = 0;
  let fontsStarted = false;
  let fonts: void | Promise<unknown> = undefined;
  const indexStep = nodeIndexSteps(session.part().root);
  // Each read answers true once done; the node index takes several steps on a long part.
  const reads: (() => boolean)[] = [
    () => indexStep(FONT_WARM_STEP_MS),
    () => {
      session.reviewItems();
      return true;
    },
  ];
  const step: Step = () => {
    if (!current()) return;
    const deadline = performance.now() + FONT_WARM_STEP_MS;
    if (!fontsStarted) {
      while (scanned < fontCalls.length && performance.now() < deadline) fontCalls[scanned++]!();
      if (scanned < fontCalls.length) return step;
      fontsStarted = true;
      fonts = startFonts();
      return step;
    }
    if (digested < digests.length) {
      while (digested < digests.length && performance.now() < deadline) {
        warmLayoutNodeDigests(digests.slice(digested, digested + FONT_WARM_BATCH));
        digested += FONT_WARM_BATCH;
      }
      return step;
    }
    const read = reads[0];
    if (!read) return fonts;
    if (read()) reads.shift();
    return step;
  };
  return step;
}
