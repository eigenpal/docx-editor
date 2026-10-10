// The internal seam a large open uses to finish its first layout in slices.
//
// The surface mounts with a layout of only the first body blocks. Each step lays out more of
// the body, resuming from the previous pass, until the limit no longer cuts anything; the
// last step publishes the normal full layout. Kept off the public surface contract, like
// `surface-measurement.ts`.

import { drainLayoutSteps, type LayoutSteps } from '../layout/layout-steps.ts';

const steps = new WeakMap<object, (budgetMs: number) => boolean>();
let stepCount = 0;

/** @internal How many opening steps have run, for tests that must see the slicing. */
export function progressiveOpenStepCount(): number {
  return stepCount;
}

/** Register `surface`'s opening step. */
export function registerProgressiveOpen(
  surface: object,
  step: (budgetMs: number) => boolean
): void {
  steps.set(surface, step);
}

/**
 * Advance `surface`'s opening layout for about `budgetMs`. True once the full layout is
 * published, and for a surface that opened without slicing.
 */
export function continueProgressiveOpen(surface: object, budgetMs: number): boolean {
  const step = steps.get(surface);
  if (!step) return true;
  stepCount += 1;
  const done = step(budgetMs);
  if (done) steps.delete(surface);
  return done;
}

/** Whether `surface` is still laying out its opening slices. */
export function progressiveOpenPending(surface: object): boolean {
  return steps.has(surface);
}

/** The work a sliced opening aims to do per slice, in milliseconds. */
const OPENING_SLICE_MS = 40;

/** What the slices need from the surface that is opening. */
export interface OpeningSlicesHost {
  now(): number;
  destroyed(): boolean;
  /** The body block limit of the opening, or null once a full layout ran. */
  limit(): number | null;
  setLimit(limit: number): void;
  bodyBlockCount(): number | undefined;
  /** A prefix layout to `limit` body blocks, as steps that may pause inside a long table. */
  prefixPass(limit: number): LayoutSteps<unknown>;
  /** The normal full layout, resumed from the last prefix; it ends the opening. */
  finish(): void;
}

/**
 * Lay a mounted surface's body out in slices of about {@link OPENING_SLICE_MS}: each slice
 * extends the prefix and resumes from the previous one, and a prefix pass pauses between the
 * rows of a long table instead of laying it out in one task. Marks `container` while it runs,
 * so the loading overlay shows the document muted.
 *
 * Answers a function that finishes a paused prefix pass at once. Any other layout of the same
 * session must call it first, because the paused pass holds that session mid-flow.
 */
export function startOpeningSlices(
  surface: object,
  container: HTMLElement,
  host: OpeningSlicesHost,
  firstGrowth: number
): () => void {
  let growth = firstGrowth;
  let pass: LayoutSteps<unknown> | null = null;
  let passWork = 0;
  const finishPaused = (): void => {
    const paused = pass;
    pass = null;
    if (paused) drainLayoutSteps(paused);
  };
  const step = (budgetMs: number): boolean => {
    const deadline = host.now() + budgetMs;
    while (host.limit() !== null && !host.destroyed()) {
      if (!pass) {
        const limit = host.limit()!;
        const total = host.bodyBlockCount();
        if (total !== undefined && limit >= total) {
          host.finish();
          return true;
        }
        host.setLimit(limit + growth);
        pass = host.prefixPass(limit + growth);
        passWork = 0;
      }
      const began = host.now();
      let done = false;
      do done = pass.next().done === true;
      while (!done && host.now() < deadline);
      passWork += host.now() - began;
      if (!done) return false;
      pass = null;
      // Size the next slice from this one's cost per block.
      const msPerBlock = Math.max(passWork, 1) / growth;
      growth = Math.min(4096, Math.max(16, Math.round(OPENING_SLICE_MS / msPerBlock)));
      if (host.now() >= deadline) return false;
    }
    return true;
  };
  container.removeAttribute('data-docx-opening-preview');
  if (host.limit() !== null) {
    container.setAttribute('data-docx-opening-preview', '');
    registerProgressiveOpen(surface, (budgetMs) => {
      const done = step(budgetMs);
      if (done) container.removeAttribute('data-docx-opening-preview');
      return done;
    });
  }
  return finishPaused;
}
