// The internal seam a large open uses to finish its first layout in slices.
//
// The surface mounts with a layout of only the first body blocks. Each step lays out more of
// the body, resuming from the previous pass, until the limit no longer cuts anything; the
// last step publishes the normal full layout. Kept off the public surface contract, like
// `surface-measurement.ts`.

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
