// Textbox story layout.
//
// A text-box drawing (`wps:wsp` → `wps:txbx` → `w:txbxContent`) carries a STORY: ordinary
// paragraphs flowed inside the drawing's declared extent — same shape as a footnote story
// ({@link layoutNoteStory}), but bounded by the box instead of the page. The extent is
// authoritative: content that does not fit clips with a named fallback reason, never grows
// the box.
//
// PAGE / NUMPAGES / SECTIONPAGES fields inside the story project through the same
// `pageContext` path the host story uses, so a footer whose page number lives inside an
// anchored text box evaluates per page exactly like a direct footer field. Cached field
// result text is never trusted.
//
// Line / fragment ids are namespaced by drawing node id so the body's incremental
// convergence counter never moves because a textbox changed. All bounds are explicit:
// nesting depth, fragment count, and the extent clip all fail closed with reasons.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { DrawingProjection } from '../store/package/drawing-projection.ts';
import { emuToPoints } from './drawing-layout.ts';
import type { FieldPageContext } from './field-projection.ts';
import type { ParagraphLayoutCache } from './layout-cache.ts';
import type { PendingLine } from './paragraph-flow.ts';
import type { RevisionDisplayMode } from './revision-projection.ts';
import { flowBlocksInBox } from './semantic-table-layout.ts';
import type { BlockFragmentRecord, TextMeasurer } from './semantic-records.ts';
import type { StyleCascadeTable } from './style-cascade.ts';
import { textboxStoryBlocks } from './story-roots.ts';

/** Hard ceiling on textbox-in-textbox story descent (mirrors `MAX_TABLE_NESTING`'s role). */
export const MAX_TEXTBOX_STORY_NESTING = 4;

/** Hard ceiling on fragments emitted for one textbox story. */
export const MAX_TEXTBOX_STORY_FRAGMENTS = 256;

/**
 * Why textbox story layout stopped short.
 *
 * Every one is a BOUND rather than a bug: nesting depth, fragment counts and the extent all
 * come from a file. Falling back with a reason keeps the drawing rendered (clipped) instead
 * of failing the layout pass.
 */
export type TextboxStoryFallbackReason =
  | 'textbox-nesting-limit'
  | 'textbox-fragment-limit'
  /** Flowed content is taller than the extent; trailing fragments were dropped. */
  | 'textbox-height-clip';

/**
 * One text box's story laid out inside its extent, in content-box-relative coordinates.
 *
 * Fragments origin at the content box's top-left; paint places the content box at
 * `drawing origin + contentOffset` and clips to the extent.
 */
export interface TextboxStoryLayout {
  /** Content-box-relative fragments (origin at the content box's top-left). */
  readonly fragments: readonly BlockFragmentRecord[];
  /** Height the blocks flow to (points), before vertical anchoring. */
  readonly flowHeight: number;
  /** Offset of the content box inside the drawing extent: insets plus vertical anchoring. */
  readonly contentOffset: Readonly<{ x: number; y: number }>;
  /** Content box width (extent minus horizontal insets). */
  readonly contentWidth: number;
  /** Content box height (extent minus vertical insets). */
  readonly contentHeight: number;
  /** Solid fill of the hosting shape, painted behind the story; null for no fill. */
  readonly fillHex: string | null;
  /** Solid outline of the hosting shape; null for no outline. */
  readonly strokeHex: string | null;
  /** Outline width in points; 0 when absent. */
  readonly strokeWidthPt: number;
  /** True when layout hit a named bound and returned a truncated / empty story. */
  readonly fallbackReason?: TextboxStoryFallbackReason;
}

export interface TextboxStoryLayoutOptions {
  readonly measurer: TextMeasurer;
  readonly producer: string;
  readonly cache?: ParagraphLayoutCache<readonly PendingLine[]>;
  readonly styleCascade?: StyleCascadeTable;
  readonly defaultTabStopPt?: number;
  /** Host story's page-field context; PAGE-family fields inside the story project against it. */
  readonly pageContext?: FieldPageContext;
  readonly displayMode?: RevisionDisplayMode;
  /** Story nesting depth; a textbox laid out from inside another textbox passes depth + 1. */
  readonly depth?: number;
  /**
   * Inline drawing context for the part the text box lives in.
   *
   * A picture inside `w:txbxContent` is an ordinary inline drawing of the HOST part — same
   * relationships, same resources — so the host's context is the right one. Scoped to inline
   * drawings: an anchored drawing inside a text box would need frame and exclusion semantics
   * against the box, which is a separate question.
   */
  readonly inlineDrawingLayout?: import('./drawing-layout.ts').InlineDrawingLayoutContext;
  /** Per-paragraph projection + resource token for the break cache key. */
  readonly drawingTokenForParagraph?: (
    paragraph: import('@docx-editor.dev/core/store').OoxmlNode
  ) => string;
}

/** Stable line-id namespace for one textbox story. */
export function textboxLineIdPrefix(drawingNodeId: string): string {
  return `txbx-${drawingNodeId}`;
}

/**
 * Lay a drawing's textbox story out inside its extent.
 *
 * Returns null when the projection carries no textbox story. Never throws: bound hits
 * produce a truncated layout with a named {@link TextboxStoryFallbackReason}.
 */
export function layoutTextboxStory(
  projection: DrawingProjection,
  options: TextboxStoryLayoutOptions
): TextboxStoryLayout | null {
  const story = projection.textboxStory;
  if (!story) return null;

  const extentWidth = emuToPoints(projection.extentEmu.cx);
  const extentHeight = emuToPoints(projection.extentEmu.cy);
  const insetLeft = emuToPoints(story.insetsEmu.left);
  const insetRight = emuToPoints(story.insetsEmu.right);
  const insetTop = emuToPoints(story.insetsEmu.top);
  const insetBottom = emuToPoints(story.insetsEmu.bottom);
  const contentWidth = Math.max(1, extentWidth - insetLeft - insetRight);
  const contentHeight = Math.max(0, extentHeight - insetTop - insetBottom);
  const strokeWidthPt = emuToPoints(story.strokeWidthEmu);

  const chrome = {
    fillHex: story.fillHex,
    strokeHex: story.strokeHex,
    strokeWidthPt,
    contentWidth,
    contentHeight,
  };

  const depth = options.depth ?? 0;
  if (depth >= MAX_TEXTBOX_STORY_NESTING) {
    return {
      fragments: [],
      flowHeight: 0,
      contentOffset: { x: insetLeft, y: insetTop },
      ...chrome,
      fallbackReason: 'textbox-nesting-limit',
    };
  }

  const blocks: readonly OoxmlElement[] = textboxStoryBlocks(story.content, options.displayMode);
  const prefix = textboxLineIdPrefix(projection.drawingNodeId);
  let lineCounter = 0;

  const flow = flowBlocksInBox(blocks, 0, contentWidth, 0, 0, {
    measurer: options.measurer,
    cache: options.cache,
    producer: `${options.producer}|txbx:${projection.drawingNodeId}`,
    nextLineId: () => `${prefix}-line-${lineCounter++}`,
    styleCascade: options.styleCascade,
    ...(options.pageContext ? { pageContext: options.pageContext } : {}),
    ...(options.defaultTabStopPt !== undefined
      ? { defaultTabStopPt: options.defaultTabStopPt }
      : {}),
    ...(options.displayMode ? { displayMode: options.displayMode } : {}),
    ...(options.inlineDrawingLayout ? { inlineDrawingLayout: options.inlineDrawingLayout } : {}),
    ...(options.drawingTokenForParagraph
      ? { drawingTokenForParagraph: options.drawingTokenForParagraph }
      : {}),
  });

  let fragments = flow.blocks;
  let flowHeight = flow.bottom;
  let fallbackReason: TextboxStoryFallbackReason | undefined;

  if (fragments.length > MAX_TEXTBOX_STORY_FRAGMENTS) {
    fragments = fragments.slice(0, MAX_TEXTBOX_STORY_FRAGMENTS);
    const last = fragments[fragments.length - 1];
    flowHeight = last ? last.box.y + last.box.height : 0;
    fallbackReason = 'textbox-fragment-limit';
  }

  // Word clips overflow at the box. Keep fragments that START inside the content height so a
  // partially visible line still paints (the container clips precisely); drop fully-below ones.
  if (flowHeight > contentHeight + 0.001) {
    const kept = fragments.filter((fragment) => fragment.box.y < contentHeight - 0.001);
    if (kept.length < fragments.length) {
      fragments = kept;
      fallbackReason = fallbackReason ?? 'textbox-height-clip';
    }
  }

  // Vertical anchoring positions the flowed content inside the box; overflow pins to the top
  // (offsets never go negative, matching Word's clip-from-top behaviour).
  const slack = Math.max(0, contentHeight - flowHeight);
  const anchorOffset =
    story.verticalAnchor === 'center' ? slack / 2 : story.verticalAnchor === 'bottom' ? slack : 0;

  return {
    fragments,
    flowHeight,
    contentOffset: { x: insetLeft, y: insetTop + anchorOffset },
    ...chrome,
    ...(fallbackReason ? { fallbackReason } : {}),
  };
}
