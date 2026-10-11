// The growing prefix a large open lays out in separate tasks (`bodyBlockLimit`).
//
// Each pass lays out the first N body blocks and resumes from the last pass through the
// session's checkpoints, so later passes only place the blocks the limit added. The count
// recorded here tells the caller when a limit no longer cuts anything.

import type { LayoutSession } from './layout-session.ts';

const bodyBlockCounts = new WeakMap<LayoutSession, number>();

/**
 * `all` cut to `bodyBlockLimit`, recording the uncut count on the session. List numbering
 * still resolves over `all`: a number depends only on the paragraphs before it, so the items
 * are the same, and one resolution serves every prefix instead of a new one per pass.
 */
export function limitBodyBlocks<T>(
  all: readonly T[],
  options: { readonly bodyBlockLimit?: number; readonly session?: LayoutSession }
): { readonly blocks: readonly T[]; readonly all: readonly T[] } {
  if (options.session) bodyBlockCounts.set(options.session, all.length);
  const limit = options.bodyBlockLimit;
  return { blocks: limit === undefined || limit >= all.length ? all : all.slice(0, limit), all };
}

/** The body block count the last pass on `session` saw, or undefined before any pass. */
export function bodyBlockCountOf(session: LayoutSession): number | undefined {
  return bodyBlockCounts.get(session);
}
