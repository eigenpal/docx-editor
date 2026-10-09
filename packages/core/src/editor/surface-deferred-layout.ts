// The pages after the screen, laid out after the commit that moved them.
//
// One edit near the top of a long document can move every later page: a paragraph that turns
// into a list item wraps one more line, and everything below shifts. Laying out hundreds of
// shifted pages inside the commit took most of a second. Here the commit runs the same pass
// as steps (`layout-steps.ts`) and stops once it has completed the pages the reader can see.
// It publishes those pages with the previous layout's pages after them, and finishes the same
// pass in short tasks, then publishes the real layout. Until then a page after the screen can
// show where its content stood before the edit.
//
// A newer edit drops the paused pass and restores the session to its state before that pass,
// then lays out from there; any other layout first finishes the paused pass. A document whose
// pass finishes within its budget, or that never reports pages (several sections, notes),
// lays out exactly as before.

import { drainLayoutSteps, type LayoutProgress, type LayoutSteps } from '../layout/layout-steps.ts';
import type { SemanticLayout } from '../layout/semantic-records.ts';

/** The foreground budget before a pass may hand its later pages to the background. */
let foregroundMs = 40;
/** Background slice length, in milliseconds. */
const BACKGROUND_SLICE_MS = 40;
/** Fewer pages than this left after the screen are cheaper to finish now. */
const MIN_DEFERRED_PAGES = 8;

let pageAfterViewForTest: number | null = null;

/** @internal Test hook: defer after `page`, with a foreground budget of `budgetMs`. */
export function setDeferredLayoutForTest(page: number | null, budgetMs = 40): () => void {
  const previous = [pageAfterViewForTest, foregroundMs] as const;
  pageAfterViewForTest = page;
  foregroundMs = budgetMs;
  return () => {
    [pageAfterViewForTest, foregroundMs] = previous;
  };
}

export interface DeferredLayoutHost {
  now(): number;
  /** The first page index the commit may leave to the background, or undefined for none. */
  pageAfterView(): number | undefined;
  /** The layout on screen now. */
  current(): SemanticLayout | null;
  /** The model revision now; a finished pass for an older one is not published. */
  revision(): number;
  /** Publish a finished layout of the current revision. */
  publish(layout: SemanticLayout): void;
  /** Save the layout session's state before a pass; the answer puts it back. */
  snapshot(): () => void;
}

export interface DeferredLayout {
  /** Lay out `steps` for `revision`: the finished layout, or an interim one. */
  run(steps: LayoutSteps<SemanticLayout>, revision: number): SemanticLayout;
  /** Finish a deferred pass now. Its layout is published only if still current. */
  finish(): void;
  /**
   * Drop a deferred pass and put the session back as it was before the pass, so a newer
   * edit lays out from there instead of first paying for the rest of an outdated pass.
   */
  abandon(): void;
  /** Whether a pass is still finishing in the background. */
  pending(): boolean;
  /** Drop a deferred pass without finishing it: for teardown only. */
  cancel(): void;
}

function queueTask(run: () => void): void {
  if (typeof MessageChannel === 'function') {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      run();
    };
    channel.port2.postMessage(null);
    return;
  }
  setTimeout(run, 0);
}

export function createDeferredLayout(host: DeferredLayoutHost): DeferredLayout {
  let paused: {
    readonly steps: LayoutSteps<SemanticLayout>;
    readonly revision: number;
    readonly restore: () => void;
  } | null = null;

  const settle = (layout: SemanticLayout, revision: number): void => {
    if (host.revision() === revision) host.publish(layout);
  };

  const drive = (): void => {
    const pass = paused;
    if (!pass) return;
    const deadline = host.now() + BACKGROUND_SLICE_MS;
    for (;;) {
      const next = pass.steps.next();
      if (next.done) {
        paused = null;
        settle(next.value, pass.revision);
        return;
      }
      if (host.now() >= deadline) break;
    }
    queueTask(drive);
  };

  return {
    run(steps, revision) {
      const restore = host.snapshot();
      const deadline = host.now() + foregroundMs;
      const after = pageAfterViewForTest ?? host.pageAfterView();
      const previous = host.current();
      let progress: LayoutProgress | null = null;
      for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
        if (next.value) progress = next.value;
        if (
          after === undefined ||
          !progress?.finalize ||
          progress.pages.length <= after ||
          host.now() < deadline ||
          !previous ||
          previous.pages.length - progress.pages.length < MIN_DEFERRED_PAGES
        )
          continue;
        // The completed pages, then the previous layout's pages after them, until the pass
        // ends. Each keeps the index it is painted at.
        const pages = [...progress.pages, ...previous.pages.slice(progress.pages.length)];
        paused = { steps, revision, restore };
        queueTask(drive);
        return progress.finalize(pages);
      }
    },
    finish() {
      const pass = paused;
      if (!pass) return;
      paused = null;
      settle(drainLayoutSteps(pass.steps), pass.revision);
    },
    abandon() {
      const pass = paused;
      if (!pass) return;
      paused = null;
      pass.restore();
    },
    pending: () => paused !== null,
    cancel() {
      paused = null;
    },
  };
}
