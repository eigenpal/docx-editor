// Stable, record-only traversal for exporters and other non-DOM consumers.

import type {
  LineRecord,
  PageRecord,
  ParagraphFragmentRecord,
  SemanticLayout,
  SourceRange,
  StyleSpanRecord,
} from './semantic-records.ts';
import type { AnchoredDrawingRecord } from './drawing-layout.ts';
import { headerFooterAnchoredDrawingOrigin } from './header-footer-drawing-origin.ts';
import { iterateEveryStoryOrderScans } from './document-order.ts';
import { lineSegments } from './line-segments.ts';
import {
  iterateSemanticStories,
  iterateStoryParagraphFragments,
  paragraphFragmentsOfBlocks,
  type SemanticFillHostVisit,
  type SemanticRootStoryKind,
  type SemanticStoryKind,
  type SemanticStoryVisit,
  type StoryParagraphFragmentContext,
} from './semantic-record-queries.ts';

export {
  forEachSemanticDrawing,
  forEachSemanticStory,
  forEachStoryParagraphFragment,
  iterateSemanticFillHosts,
  iterateSemanticPaintHosts,
  MAX_STORY_DRAWING_WALK_DEPTH,
  type SemanticDrawingVisit,
  type SemanticDrawingLayer,
  type SemanticFillHostVisit,
  type SemanticRootStoryKind,
  type SemanticStoryKind,
  type SemanticStoryVisit,
  type StoryDrawingContext,
  type StoryDrawingHost,
  type StoryParagraphFragmentContext,
} from './semantic-record-queries.ts';

/** One span in the engine's published story order. @public */
export interface SemanticSpanVisit {
  readonly page: PageRecord;
  readonly story: SemanticStoryKind;
  /** Root story from which textbox descent began; equal to `story` outside textboxes. */
  readonly rootStory: SemanticRootStoryKind;
  /** Precise root host and absolute origin for story-relative geometry. */
  readonly root: SemanticStoryVisit;
  /** Absolute origin of the immediate root or textbox story containing this span. */
  readonly storyOrigin: Readonly<{ x: number; y: number }>;
  /** Absolute laid-out span bounds in page-stack coordinates. */
  readonly absoluteBox: import('./semantic-records.ts').LayoutBox;
  /** Owning note scope/area where applicable; null for body and page furniture. */
  readonly noteScopeId: string | null;
  readonly noteAreaKind: SemanticStoryVisit['noteAreaKind'];
  /** Zero outside a textbox, otherwise its bounded nesting depth. */
  readonly textboxDepth: number;
  /** Immediate textbox-owning anchor, or null in the root story. */
  readonly textboxOwner: AnchoredDrawingRecord | null;
  /** Root-to-leaf textbox owners, preserving anchor identity for future exporters. */
  readonly textboxPath: readonly AnchoredDrawingRecord[];
  /** Enclosing published fragment; use paragraphId for the authored span owner. */
  readonly paragraph: ParagraphFragmentRecord;
  /** Authored paragraph owning this span, including spans merged into another fragment. */
  readonly paragraphId: string;
  readonly line: LineRecord;
  readonly span: StyleSpanRecord;
  /**
   * Model address for authored text. Projected atoms intentionally return null even though
   * their geometry record carries a range used internally by layout.
   */
  readonly sourceRange: SourceRange | null;
}

/** Return the model address exporters may use, excluding layout-projected atoms. @public */
export function exportSourceRangeOf(span: StyleSpanRecord): SourceRange | null {
  return span.projected === true ? null : span.range;
}

function* iterateParagraphFragmentSpans(
  root: SemanticStoryVisit,
  fragment: ParagraphFragmentRecord,
  context: StoryParagraphFragmentContext,
  paragraphOrder: ReadonlyMap<string, number>
): Generator<SemanticSpanVisit> {
  const { page, story, noteScopeId, noteAreaKind } = root;
  const { textboxDepth, textboxOwner, textboxPath, storyOrigin } = context;
  const visitStoryKind = textboxDepth === 0 ? story : 'textbox';
  for (const line of fragment.lines) {
    const segments = [...lineSegments(line)].sort(
      (left, right) =>
        (paragraphOrder.get(left.paragraphId) ?? Number.MAX_SAFE_INTEGER) -
        (paragraphOrder.get(right.paragraphId) ?? Number.MAX_SAFE_INTEGER)
    );
    for (const segment of segments) {
      for (const span of segment.spans) {
        yield {
          page,
          story: visitStoryKind,
          rootStory: story,
          root,
          storyOrigin,
          absoluteBox: Object.freeze({
            x: storyOrigin.x + span.box.x,
            y: storyOrigin.y + span.box.y,
            width: span.box.width,
            height: span.box.height,
          }),
          noteScopeId,
          noteAreaKind,
          textboxDepth,
          textboxOwner,
          textboxPath,
          paragraph: fragment,
          paragraphId: segment.paragraphId,
          line,
          span,
          sourceRange: exportSourceRangeOf(span),
        };
      }
    }
  }
}

function* iterateStorySpans(
  root: SemanticStoryVisit,
  paragraphOrder: ReadonlyMap<string, number>
): Generator<SemanticSpanVisit> {
  const { page, story, host } = root;
  const rootDrawingOrigin =
    story === 'header' || story === 'footer'
      ? (drawing: AnchoredDrawingRecord) =>
          headerFooterAnchoredDrawingOrigin(drawing, root.origin, {
            x: page.box.x,
            y: page.box.y,
          })
      : undefined;
  for (const [block, textboxContext] of iterateStoryParagraphFragments(
    host,
    root.origin,
    rootDrawingOrigin
  )) {
    yield* iterateParagraphFragmentSpans(root, block, textboxContext, paragraphOrder);
  }
}

/**
 * Yield spans that belong to one fill host, without descending into nested textboxes.
 *
 * Nested textbox spans are visited when that nested host is walked. Mixed-line segments
 * sort with the same paragraph-order map {@link iterateSemanticSpans} uses.
 * @public
 */
export function* iterateSemanticFillHostSpans(
  host: SemanticFillHostVisit,
  paragraphOrder: ReadonlyMap<string, number>
): Generator<SemanticSpanVisit> {
  const context: StoryParagraphFragmentContext = {
    storyOrigin: host.storyOrigin,
    textboxDepth: host.textboxDepth,
    textboxOwner: host.textboxOwner,
    textboxPath: host.textboxPath,
  };
  for (const fragment of paragraphFragmentsOfBlocks(host.fragments, true)) {
    yield* iterateParagraphFragmentSpans(host.root, fragment, context, paragraphOrder);
  }
}

/** Cooperative pause during paragraph-order preparation. @public */
export interface SemanticTraversalCheckpoint {
  readonly kind: 'checkpoint';
}

const SEMANTIC_TRAVERSAL_CHECKPOINT: SemanticTraversalCheckpoint = Object.freeze({
  kind: 'checkpoint',
});

/** Number of scanned paragraph-order lines and segments between checkpoints. @public */
export const SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH = 256;

/** True when a span walk item is a cooperative checkpoint rather than a visit. @public */
export function isSemanticTraversalCheckpoint(
  value: SemanticSpanVisit | SemanticTraversalCheckpoint
): value is SemanticTraversalCheckpoint {
  return 'kind' in value && value.kind === 'checkpoint';
}

/**
 * Build the paragraph-order map used to sort mixed-line segments.
 *
 * Yields {@link SemanticTraversalCheckpoint} after every
 * {@link SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH} steps so one `.next()` cannot
 * allocate the complete map. A cold cache counts scanned lines and segments,
 * including duplicate ids. A warm {@link everyStoryOrder} cache performs no
 * line or segment scan; this generator checkpoints the cached unique ids.
 * The generator's return value is the finished map.
 * @public
 */
export function* iterateSemanticParagraphOrder(
  layout: SemanticLayout
): Generator<SemanticTraversalCheckpoint, ReadonlyMap<string, number>> {
  const paragraphOrder = new Map<string, number>();
  let prepared = 0;
  for (const step of iterateEveryStoryOrderScans(layout)) {
    if (step !== null && !paragraphOrder.has(step)) {
      paragraphOrder.set(step, paragraphOrder.size);
    }
    prepared += 1;
    if (prepared % SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH === 0) {
      yield SEMANTIC_TRAVERSAL_CHECKPOINT;
    }
  }
  return paragraphOrder;
}

/**
 * Yield every published span in page/story order without consulting the source package.
 *
 * Resumable: the walk pauses between visits and does not collect them into an array.
 * Paragraph order is prepared incrementally and yields {@link SemanticTraversalCheckpoint}
 * after every {@link SEMANTIC_TRAVERSAL_CHECKPOINT_BATCH} scanned lines and segments so
 * one `.next()` cannot build the complete map. {@link forEachSemanticSpan} skips
 * checkpoints and preserves the published span order.
 * @public
 */
export function* iterateSemanticSpans(
  layout: SemanticLayout
): Generator<SemanticSpanVisit | SemanticTraversalCheckpoint> {
  const orderWalk = iterateSemanticParagraphOrder(layout);
  let orderStep = orderWalk.next();
  while (!orderStep.done) {
    yield orderStep.value;
    orderStep = orderWalk.next();
  }
  const paragraphOrder = orderStep.value;
  for (const story of iterateSemanticStories(layout)) {
    yield* iterateStorySpans(story, paragraphOrder);
  }
}

/**
 * Visit every published span in page/story order without consulting the source package.
 * @public
 */
export function forEachSemanticSpan(
  layout: SemanticLayout,
  visitor: (visit: SemanticSpanVisit) => void
): void {
  for (const item of iterateSemanticSpans(layout)) {
    if (isSemanticTraversalCheckpoint(item)) continue;
    visitor(item);
  }
}
