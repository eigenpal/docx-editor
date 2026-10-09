// Body paragraph flow inputs that come from the layout options alone, and the placement inputs
// a body paragraph's break reads from the region it lands in.

import type { OoxmlElement } from '@docx-editor.dev/core/store';
import type { BodyAnchorFrameBase } from './body-flow-helpers.ts';
import type { InlineDrawingLayoutContext } from './drawing-layout.ts';
import { ownBandKeyInputs } from './drawing-placement-exclusion.ts';
import { bodyParagraphBreakKey } from './paragraph-break-request.ts';
import type { ExclusionZone } from './drawing-exclusion.ts';
import type { ParagraphFlowOptions } from './paragraph-flow-options.ts';
import type { SemanticLayoutOptions } from './semantic-layout-options.ts';
import { styleSeparatorRanges } from './style-separator-group.ts';

/** The flow options a body paragraph takes straight from the layout options. */
export function bodyParagraphOptionFlow(
  paragraph: OoxmlElement,
  options: SemanticLayoutOptions
): Partial<ParagraphFlowOptions> {
  return {
    ...(options.projectLink ? { projectLink: options.projectLink } : {}),
    ...(options.projectFieldLink ? { projectFieldLink: options.projectFieldLink } : {}),
    showFieldCodes: options.showFieldCodes,
    fieldCodeRanges: styleSeparatorRanges(paragraph, options.fieldCodeRanges),
    tocLinkStyleRanges: styleSeparatorRanges(paragraph, options.tocLinkStyleRanges),
    ...(options.documentProperties ? { documentProperties: options.documentProperties } : {}),
    ...(options.noteMarks ? { noteMarks: options.noteMarks } : {}),
  };
}

/**
 * Where a body paragraph lands: its start, the start its anchors measure from, the sheet's
 * frames for page- and margin-framed anchors, the region bottom, its spacing above, and the
 * page zones it wraps around.
 */
export function bodyParagraphPlacementFlow(placement: {
  readonly paragraphStartY: number;
  readonly anchorParagraphStartY: number;
  readonly anchorFrameBase: BodyAnchorFrameBase;
  readonly regionBottomY: number;
  readonly paragraphSpaceBefore: number;
  readonly pageExclusionZones: readonly ExclusionZone[];
  readonly suppressChrome: boolean;
}): Partial<ParagraphFlowOptions> {
  return {
    paragraphStartY: placement.paragraphStartY,
    anchorParagraphStartY: placement.anchorParagraphStartY,
    anchorFrameBase: placement.anchorFrameBase,
    regionBottomY: placement.regionBottomY,
    ...(placement.paragraphSpaceBefore > 0
      ? { paragraphSpaceBefore: placement.paragraphSpaceBefore }
      : {}),
    ...(placement.pageExclusionZones.length > 0
      ? { pageExclusionZones: placement.pageExclusionZones }
      : {}),
    ...(placement.suppressChrome ? { suppressEmptyPlaceholderLine: true } : {}),
  };
}

/**
 * The break cache key of a body paragraph at one placement.
 *
 * `entry.key` already folds the content, the cascade props, the tab stops, and the
 * list/textbox/drawing/REF tokens: `prepareBlock` memo-validates each per pass, and `refFields`
 * is one frozen projection per pass, so nothing here can drift from the prepass. Its list token
 * stays, so renumbering invalidates the marker's tab advance. Only what varies per PLACEMENT
 * joins here; the common path must stay `entry.key` BY IDENTITY, because retention names the
 * prepass keys (suffixed and off-prepass-width keys are transient by design) and V8 caches the
 * shared string's hash. A paragraph with its own spacing-dependent band adds that band's
 * position inputs (see `ownBandKeyInputs`).
 */
export function bodyParagraphCacheKey(
  entry: { readonly key: string; readonly paragraph: OoxmlElement },
  drawings: InlineDrawingLayoutContext | undefined,
  placement: {
    readonly exclusionToken: string;
    readonly paragraphStartY: number;
    readonly anchorParagraphStartY: number;
    readonly paragraphSpaceBefore: number;
    readonly regionBottomY: number;
    readonly columnIndex: number;
    readonly startOffset: number;
    /** The page's left margin and number, for a band framed horizontally to the page. */
    readonly frameMarginLeft?: number;
    readonly pageNumber?: number;
  }
): string {
  return bodyParagraphBreakKey(entry.key, {
    ...placement,
    ...ownBandKeyInputs(entry.paragraph, drawings),
  });
}
